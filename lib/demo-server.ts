import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoLanding } from "@/lib/demo";
import { MANAGEMENT_LOGOS_BUCKET } from "@/lib/data/management";
import { buildDemoStrata } from "@/lib/demo-kit/build";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The demo site's side of a visitor (lib/demo.ts): opening a personal
 * link, and the nightly clean-up. Runs only with DEMO_MODE=true, against
 * the demo database, with the service role (the visitor isn't signed in
 * yet when their link is opened, and the clean-up runs with no one signed
 * in). demo_visitors is service-role only (supabase/demo/demo.sql).
 */

export interface DemoVisitorRow {
  id: string;
  token: string;
  full_name: string;
  email: string;
  expires_at: string;
  user_id: string | null;
  corporation_id: string | null;
  setup_started_at: string | null;
  first_opened_at: string | null;
  landing: DemoLanding;
}

export type OpenDemoResult =
  | { ok: true; corporationId: string; email: string; userId: string; landing: DemoLanding }
  | { ok: false; reason: "unknown" | "expired" | "busy" };

/** Profile photos (app/account/actions.ts), filed under the person's id. */
const AVATARS_BUCKET = "avatars";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Everything a link needs before its visitor can be signed in: their
 * account (named, and stamped with when it stops working, which the
 * middleware checks on every request) and their own strata. Opening the
 * link again, or on another device, reuses both. If two requests open
 * the link at once (an email client checking the link, a double click),
 * one sets up and the other waits for it.
 */
export async function openDemoLink(token: string): Promise<OpenDemoResult> {
  const admin = createAdminClient();
  const { data: visitor, error: lookupError } = await admin
    .from("demo_visitors")
    .select("id, token, full_name, email, expires_at, user_id, corporation_id, setup_started_at, first_opened_at, landing")
    .eq("token", token)
    .maybeSingle<DemoVisitorRow>();
  if (lookupError) {
    console.error("[openDemoLink] lookup:", lookupError.message);
    return { ok: false, reason: "busy" };
  }
  if (!visitor) return { ok: false, reason: "unknown" };
  if (Date.parse(visitor.expires_at) <= Date.now()) return { ok: false, reason: "expired" };

  // Ready once the strata is made and filled (setup_started_at cleared).
  const isReady = (v: DemoVisitorRow | null) => Boolean(v?.corporation_id && v.user_id && !v.setup_started_at);
  let ready = isReady(visitor) ? visitor : null;
  if (!ready) {
    const { data: claimed, error: claimError } = await admin.rpc("demo_claim_setup", { p_visitor_id: visitor.id });
    if (claimError) {
      console.error("[openDemoLink] claim:", claimError.message);
      return { ok: false, reason: "busy" };
    }
    if (claimed === true) {
      let corporationId: string | null = null;
      try {
        // A strata from a setup that was cut off is started again.
        if (visitor.corporation_id) await discardStrata(admin, visitor.id, visitor.corporation_id);
        const userId = await visitorAccount(admin, visitor);
        const { data, error } = await admin.rpc("demo_create_strata", {
          p_visitor_id: visitor.id,
          p_user_id: userId,
        });
        if (error || !data) throw new Error(error?.message ?? "no strata");
        corporationId = data as string;
        await buildDemoStrata(admin, corporationId);
        await admin.from("demo_visitors").update({ setup_started_at: null }).eq("id", visitor.id);
        ready = { ...visitor, user_id: userId, corporation_id: corporationId, setup_started_at: null };
      } catch (err) {
        console.error("[openDemoLink] setup failed:", err instanceof Error ? err.message : err);
        if (corporationId) await discardStrata(admin, visitor.id, corporationId).catch(() => undefined);
        await admin.rpc("demo_claim_setup", { p_visitor_id: visitor.id, p_release: true });
        return { ok: false, reason: "busy" };
      }
    } else {
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(750);
        const { data } = await admin
          .from("demo_visitors")
          .select("id, token, full_name, email, expires_at, user_id, corporation_id, setup_started_at, first_opened_at, landing")
          .eq("id", visitor.id)
          .single<DemoVisitorRow>();
        if (isReady(data)) ready = data;
      }
      if (!ready) return { ok: false, reason: "busy" };
    }
  } else {
    // A later visit: make sure the account still carries this link's day.
    await stampAccount(admin, ready.user_id!, visitor);
  }

  const now = new Date().toISOString();
  await admin
    .from("demo_visitors")
    .update({ first_opened_at: visitor.first_opened_at ?? now, last_opened_at: now })
    .eq("id", visitor.id);
  return {
    ok: true,
    corporationId: ready.corporation_id!,
    email: visitor.email,
    userId: ready.user_id!,
    landing: visitor.landing === "training" ? "training" : "strata",
  };
}

function stampAccount(admin: SupabaseClient, userId: string, visitor: DemoVisitorRow) {
  return admin.auth.admin.updateUserById(userId, {
    app_metadata: { demo_visitor_id: visitor.id, demo_expires_at: visitor.expires_at },
    user_metadata: { full_name: visitor.full_name },
  });
}

/**
 * The visitor's account, named as the link was. An address that already
 * has an account here is from an earlier day not yet cleaned up (or
 * someone a visitor invited): clean up what's expired, then use it.
 */
async function visitorAccount(admin: SupabaseClient, visitor: DemoVisitorRow): Promise<string> {
  const create = () =>
    admin.auth.admin.createUser({
      email: visitor.email,
      email_confirm: true,
      user_metadata: { full_name: visitor.full_name },
      app_metadata: { demo_visitor_id: visitor.id, demo_expires_at: visitor.expires_at },
    });
  let { data, error } = await create();
  if (error && /already|exists|registered/i.test(error.message)) {
    await wipeExpiredVisitors();
    ({ data, error } = await create());
  }
  if (data?.user) return data.user.id;
  if (error && !/already|exists|registered/i.test(error.message)) throw error;

  const { data: profile } = await admin.from("profiles").select("id").eq("email", visitor.email.toLowerCase()).maybeSingle();
  if (!profile) throw new Error("The address has an account but no profile.");
  const { data: cast } = await admin.from("demo_cast").select("user_id").eq("user_id", profile.id).maybeSingle();
  if (cast) throw new Error("That address belongs to one of the fictional people.");
  await stampAccount(admin, profile.id, visitor);
  await admin.from("profiles").update({ full_name: visitor.full_name }).eq("id", profile.id);
  return profile.id;
}

/**
 * The nightly clean-up (and a quick one whenever a link is opened):
 * every visitor whose link has expired loses their strata and their
 * account, along with anyone they invited. The visitor rows themselves
 * (name, email, link) go 7 days after the link expired.
 */
export async function wipeExpiredVisitors(): Promise<{ wiped: number; failed: number; forgotten: number }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: expired } = await admin
    .from("demo_visitors")
    .select("id, user_id, corporation_id")
    .lte("expires_at", now)
    .is("wiped_at", null)
    .limit(200);

  let wiped = 0;
  let failed = 0;
  for (const v of expired ?? []) {
    try {
      await wipeVisitor(admin, v);
      await admin.from("demo_visitors").update({ wiped_at: new Date().toISOString() }).eq("id", v.id);
      wiped++;
    } catch (err) {
      failed++;
      console.error("[wipeExpiredVisitors]", v.id, err instanceof Error ? err.message : err);
    }
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: gone } = await admin.from("demo_visitors").delete().lte("expires_at", weekAgo).not("wiped_at", "is", null).select("id");
  return { wiped, failed, forgotten: gone?.length ?? 0 };
}

/** A strata's rows and its stored files (documents, the management logo). */
async function deleteStrata(admin: SupabaseClient, corporationId: string) {
  await removeFolder(admin, DOCUMENTS_BUCKET, corporationId);
  await removeFolder(admin, MANAGEMENT_LOGOS_BUCKET, corporationId);
  const { error } = await admin.rpc("demo_delete_strata", { p_corporation_id: corporationId });
  if (error) throw new Error(error.message);
}

/** A half-made strata, so its visitor's setup can start again. */
async function discardStrata(admin: SupabaseClient, visitorId: string, corporationId: string) {
  await deleteStrata(admin, corporationId);
  await admin.from("demo_visitors").update({ corporation_id: null }).eq("id", visitorId);
}

/** Every file under a folder in a bucket, however deep. */
async function removeFolder(admin: SupabaseClient, bucket: string, folder: string) {
  const paths: string[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`Listing ${bucket}/${prefix}: ${error.message}`);
      for (const entry of data ?? []) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) paths.push(path);
        else await walk(path);
      }
      if (!data || data.length < 1000) break;
    }
  };
  await walk(folder);
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
    if (error) throw new Error(`Removing files from ${bucket}: ${error.message}`);
  }
}

async function wipeVisitor(admin: SupabaseClient, v: { user_id: string | null; corporation_id: string | null }) {
  const people = new Set<string>();
  if (v.user_id) people.add(v.user_id);
  if (v.corporation_id) {
    const { data: members, error: membersError } = await admin.rpc("demo_strata_people", { p_corporation_id: v.corporation_id });
    if (membersError) throw new Error(membersError.message);
    for (const id of (members ?? []) as string[]) people.add(id);
    await deleteStrata(admin, v.corporation_id);
  }
  // Someone else's still-open link may use the same account (the same
  // address, invited by another visitor): leave it until that one ends.
  if (people.size === 0) return;
  const { data: active } = await admin
    .from("demo_visitors")
    .select("user_id")
    .gt("expires_at", new Date().toISOString())
    .in("user_id", [...people]);
  for (const a of active ?? []) people.delete(a.user_id);

  for (const userId of people) {
    await removeFolder(admin, AVATARS_BUCKET, userId);
    const { error } = await admin.rpc("demo_delete_person", { p_user_id: userId });
    if (error) throw new Error(error.message);
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError && !/not found/i.test(authError.message)) throw new Error(authError.message);
  }
}
