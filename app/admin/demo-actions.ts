"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { DEMO_VISITOR_COLUMNS, demoDatabase, toDemoVisitor, type DemoVisitor } from "@/lib/data/demo-visitors";
import { IS_DEMO, demoDayLabel, endOfDemoDay, newDemoToken, type DemoLanding } from "@/lib/demo";
import { MailtrapSendError, sendTransactionalEmail } from "@/lib/email/mailtrap";
import { demoInviteEmail } from "@/lib/email/templates";
import { EMAIL_RE } from "@/lib/strata";

/**
 * Personal demo links (lib/demo.ts), made from the live site's Super
 * Admin console: the person's name and email go into the demo database,
 * the link is emailed to them, and it's shown here too. A link works until
 * midnight Pacific on the day it was made.
 */

export type DemoLinkResult =
  | { ok: true; visitor: DemoVisitor; emailed: boolean; reused: boolean; notice: string }
  | { ok: false; error: string };

const NOT_CONNECTED =
  "The demo site isn't connected yet. Add DEMO_SUPABASE_URL and DEMO_SUPABASE_SERVICE_ROLE_KEY to this project in Vercel.";

async function staffName() {
  const ctx = await requireSuperAdmin();
  if (!ctx || IS_DEMO) return null;
  const { data } = await ctx.supabase.from("profiles").select("full_name").eq("id", ctx.user.id).single();
  return (data?.full_name as string) || "Super Admin";
}

async function emailLink(visitor: DemoVisitor): Promise<string | null> {
  try {
    await sendTransactionalEmail({
      to: visitor.email,
      ...demoInviteEmail({
        fullName: visitor.fullName,
        link: visitor.link,
        landing: visitor.landing,
        dayLabel: demoDayLabel(new Date(visitor.expiresAt)),
      }),
    });
    return null;
  } catch (error) {
    console.error("[demo link] email failed:", error instanceof MailtrapSendError ? error.body : error);
    return "The link is ready, but the email didn't send. Copy the link and send it yourself, or try Resend.";
  }
}

/**
 * Makes a link and emails it. Someone who already has a link that still
 * works today gets that one again (one demo strata per person per day),
 * opening wherever this one was asked to.
 */
export async function createDemoLink(input: { fullName: string; email: string; landing: DemoLanding }): Promise<DemoLinkResult> {
  const creator = await staffName();
  if (!creator) return { ok: false, error: "Only platform staff can make demo links." };
  const db = demoDatabase();
  if (!db) return { ok: false, error: NOT_CONNECTED };

  const fullName = input.fullName.trim().replace(/\s+/g, " ").slice(0, 120);
  const email = input.email.trim().toLowerCase();
  if (!fullName) return { ok: false, error: "Enter the person's name." };
  if (!EMAIL_RE.test(email) || email.length > 320) return { ok: false, error: "Enter a valid email address." };
  const landing: DemoLanding = input.landing === "training" ? "training" : "strata";

  const { data: existing } = await db
    .from("demo_visitors")
    .select(DEMO_VISITOR_COLUMNS)
    .eq("email", email)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let visitor: DemoVisitor;
  if (existing) {
    visitor = toDemoVisitor(existing);
    if (visitor.landing !== landing) {
      await db.from("demo_visitors").update({ landing }).eq("id", visitor.id);
      visitor = { ...visitor, landing };
    }
  } else {
    const { data, error } = await db
      .from("demo_visitors")
      .insert({
        token: newDemoToken(),
        full_name: fullName,
        email,
        landing,
        expires_at: endOfDemoDay().toISOString(),
        created_by_name: creator,
      })
      .select(DEMO_VISITOR_COLUMNS)
      .single();
    if (error || !data) {
      console.error("[createDemoLink]", error?.message);
      return { ok: false, error: "Couldn't make the link. Check that the demo database is set up (the Demo database GitHub Action)." };
    }
    visitor = toDemoVisitor(data);
  }

  const emailError = await emailLink(visitor);
  revalidatePath("/admin");
  const reused = Boolean(existing);
  return {
    ok: true,
    visitor,
    emailed: !emailError,
    reused,
    notice:
      emailError ??
      (reused
        ? `${visitor.email} already had a link for today, so we emailed that one again.`
        : `Emailed to ${visitor.email}. It works until midnight tonight (Pacific).`),
  };
}

export async function resendDemoLink(visitorId: string): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  if (!(await staffName())) return { ok: false, error: "Only platform staff can do this." };
  const db = demoDatabase();
  if (!db) return { ok: false, error: NOT_CONNECTED };
  const { data } = await db.from("demo_visitors").select(DEMO_VISITOR_COLUMNS).eq("id", visitorId).maybeSingle();
  if (!data) return { ok: false, error: "That link no longer exists." };
  const visitor = toDemoVisitor(data);
  if (!visitor.active) return { ok: false, error: "That link has ended. Make a new one." };
  const emailError = await emailLink(visitor);
  return emailError ? { ok: false, error: emailError } : { ok: true, notice: `Emailed to ${visitor.email} again.` };
}

/**
 * Ends a link now (sent to the wrong address, say). The visitor is
 * signed out on their next click, and their strata goes in the next
 * clean-up.
 */
export async function endDemoLink(visitorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await staffName())) return { ok: false, error: "Only platform staff can do this." };
  const db = demoDatabase();
  if (!db) return { ok: false, error: NOT_CONNECTED };
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("demo_visitors")
    .update({ expires_at: now })
    .eq("id", visitorId)
    .gt("expires_at", now)
    .select("id, user_id")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't end the link." };
  if (data?.user_id) {
    const { error: authError } = await db.auth.admin.updateUserById(data.user_id, {
      app_metadata: { demo_visitor_id: data.id, demo_expires_at: now },
    });
    if (authError) console.error("[endDemoLink]", authError.message);
  }
  revalidatePath("/admin");
  return { ok: true };
}
