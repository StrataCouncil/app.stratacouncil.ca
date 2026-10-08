"use server";

import { revalidatePath } from "next/cache";
import { APP_URL } from "@/lib/app-url";
import { IS_DEMO } from "@/lib/demo";
import { MailtrapSendError, sendTransactionalEmail } from "@/lib/email/mailtrap";
import { notifyUser } from "@/lib/email/notify";
import { corporationInviteEmail, joinRequestApprovedEmail } from "@/lib/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_RE, isCorporationRole } from "@/lib/strata";
import { isStrataAdmin } from "@/lib/auth/strata-admin";

/**
 * Server Actions behind Council & Roles (doc01 §1, §3). Authorization is
 * RLS (0005) and the admin-checking RPCs (0010) — every write here goes
 * through the signed-in user's own client, so a non-admin calling these
 * directly gets a database refusal, not a silent success.
 *
 * The one exception is invites: `auth.admin.generateLink()` and looking up
 * whether the invitee already has an account both need the service-role
 * client, so `sendInvite`/`resendInvite` confirm the caller is admin first
 * (`requireAdmin`) before touching it — the same pattern billing/actions.ts
 * uses.
 */

export type ActionResult = { ok: true; notice?: string } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function dbError(error: { message: string; code?: string }, fallback: string): ActionResult {
  console.error("[roster-actions]", error.code, error.message);
  // RAISE EXCEPTION messages from the 0010 functions (and the BC bylaw
  // trigger in 0002) are written for the user; Postgres/PostgREST
  // internals aren't.
  if (error.code === "P0001") return fail(error.message);
  return fail(fallback);
}

async function requireAdmin(corporationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (await isStrataAdmin(supabase, corporationId)) ? { supabase, user } : null;
}

function refresh(corporationId: string) {
  revalidatePath(`/strata/${corporationId}`);
  revalidatePath(`/strata/${corporationId}/council`);
}

// ── Invites ────────────────────────────────────────────────────────────

/**
 * Mints the one-click link for an invite. `generateLink` signs the
 * invitee in when clicked: type 'invite' for an address with no account
 * yet (it creates the auth user, and 0001's trigger creates the profile),
 * 'magiclink' for an existing account. Nothing is sent by Supabase —
 * generateLink only returns the token; we email it ourselves.
 */
async function mintAcceptLink(params: { email: string; inviteId: string; hasAccount: boolean }) {
  const admin = createAdminClient();

  // No name is passed for a new account: the invitee gives their own on
  // the /welcome step right after clicking (doc01 §4a) — full_name is
  // theirs to set, and it locks once they complete a training module.
  const generate = (type: "invite" | "magiclink") =>
    admin.auth.admin.generateLink({ type, email: params.email });

  let result = await generate(params.hasAccount ? "magiclink" : "invite");
  // An auth user can exist without our having seen a profile for it (e.g.
  // an earlier invite created it a moment ago) — 'invite' then refuses.
  if (result.error && !params.hasAccount) {
    result = await generate("magiclink");
  }
  if (result.error || !result.data.user) {
    throw new Error(result.error?.message ?? "generateLink returned no user");
  }

  const url = new URL("/auth/confirm", APP_URL);
  url.searchParams.set("token_hash", result.data.properties.hashed_token);
  url.searchParams.set("type", result.data.properties.verification_type);
  url.searchParams.set("next", `/invite/${params.inviteId}`);

  return { userId: result.data.user.id, acceptUrl: url.toString() };
}

async function emailInvite(params: {
  to: string;
  acceptUrl: string;
  corporationId: string;
  inviterName: string;
}) {
  const admin = createAdminClient();
  const { data: corp } = await admin
    .from("strata_corporations")
    .select("legal_name, building_name")
    .eq("strata_plan_number", params.corporationId)
    .single();

  const { subject, html, text } = corporationInviteEmail({
    acceptUrl: params.acceptUrl,
    corporationName: corp?.building_name || corp?.legal_name || params.corporationId,
    inviterName: params.inviterName,
  });
  await sendTransactionalEmail({ to: params.to, subject, html, text });
}

async function findProfileByEmail(email: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return data;
}

export async function sendInvite(corporationId: string, rawEmail: string): Promise<ActionResult> {
  const ctx = await requireAdmin(corporationId);
  if (!ctx) return fail("Only this strata's admin can send invites.");
  const { supabase, user } = ctx;

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.");

  const existingProfile = await findProfileByEmail(email);
  if (existingProfile) {
    const { data: membership } = await supabase
      .from("corporation_memberships")
      .select("status")
      .eq("corporation_id", corporationId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();
    if (membership?.status === "active") {
      return fail("That person is already a member of this strata.");
    }
  }

  // Invite row first: RLS ("admin manages invites") is the real gate, and
  // the pending-invite unique index (0010) catches duplicates.
  const { data: invite, error: inviteError } = await supabase
    .from("corporation_invites")
    .insert({ corporation_id: corporationId, invited_email: email, invited_by: user.id })
    .select("id")
    .single();
  if (inviteError) {
    if (inviteError.code === "23505") return fail("That email already has a pending invite.");
    return dbError(inviteError, "Couldn't create the invite.");
  }

  let link: { userId: string; acceptUrl: string };
  try {
    link = await mintAcceptLink({
      email,
      inviteId: invite.id,
      hasAccount: Boolean(existingProfile),
    });
  } catch (error) {
    console.error("[sendInvite] generateLink failed:", error);
    await supabase.from("corporation_invites").delete().eq("id", invite.id);
    return fail("Couldn't create a sign-in link for that address. Nothing was sent; please try again.");
  }

  // Shows the person on the roster as "Invited" until they click through.
  const { error: membershipError } = await supabase
    .from("corporation_memberships")
    .upsert(
      {
        user_id: link.userId,
        corporation_id: corporationId,
        status: "invited",
        invited_by: user.id,
      },
      { onConflict: "user_id,corporation_id" }
    );
  if (membershipError) {
    console.error("[sendInvite] membership upsert failed:", membershipError.message);
  }

  refresh(corporationId);

  const { data: inviter } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  try {
    await emailInvite({
      to: email,
      acceptUrl: link.acceptUrl,
      corporationId,
      inviterName: inviter?.full_name || "Your strata's admin",
    });
  } catch (error) {
    console.error(
      "[sendInvite] email failed:",
      error instanceof MailtrapSendError ? error.body : error
    );
    return fail("The invite was saved, but the email didn't send. Use Resend to try again.");
  }

  // The demo (lib/demo.ts) emails no one: the invite just waits as pending.
  return { ok: true, notice: IS_DEMO ? `Invite saved for ${email}. It's pending (this is the demo, so no email was sent).` : `Invite sent to ${email}.` };
}

export async function resendInvite(corporationId: string, inviteId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(corporationId);
  if (!ctx) return fail("Only this strata's admin can resend invites.");
  const { supabase, user } = ctx;

  const { data: invite } = await supabase
    .from("corporation_invites")
    .select("id, invited_email, status")
    .eq("id", inviteId)
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!invite || invite.status !== "pending") return fail("That invite is no longer pending.");
  refresh(corporationId);

  // A re-sent invite gets a fresh 7 days (0017).
  const { error: renewError } = await supabase
    .from("corporation_invites")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", inviteId);
  if (renewError) return dbError(renewError, "Couldn't renew the invite.");

  const profile = await findProfileByEmail(invite.invited_email);
  const { data: inviter } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  try {
    const link = await mintAcceptLink({
      email: invite.invited_email,
      inviteId,
      hasAccount: Boolean(profile),
    });
    await emailInvite({
      to: invite.invited_email,
      acceptUrl: link.acceptUrl,
      corporationId,
      inviterName: inviter?.full_name || "Your strata's admin",
    });
  } catch (error) {
    console.error("[resendInvite] failed:", error instanceof MailtrapSendError ? error.body : error);
    return fail("Couldn't resend the invite. Please try again.");
  }

  return {
    ok: true,
    notice: IS_DEMO ? `Still pending for ${invite.invited_email} (this is the demo, so no email was sent).` : `Invite re-sent to ${invite.invited_email}.`,
  };
}

export async function revokeInvite(corporationId: string, inviteId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: invite, error } = await supabase
    .from("corporation_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("corporation_id", corporationId)
    .eq("status", "pending")
    .select("invited_email")
    .maybeSingle();
  if (error) return dbError(error, "Couldn't revoke the invite.");
  if (!invite) return fail("That invite is no longer pending, or you aren't this strata's admin.");

  // Take the "Invited" placeholder row off the roster. Only touches an
  // 'invited' row — never someone who has since become active.
  const profile = await findProfileByEmail(invite.invited_email);
  if (profile) {
    await supabase
      .from("corporation_memberships")
      .update({ status: "removed" })
      .eq("corporation_id", corporationId)
      .eq("user_id", profile.id)
      .eq("status", "invited");
  }

  refresh(corporationId);
  return { ok: true };
}

// ── Join requests ──────────────────────────────────────────────────────

export async function resolveJoinRequest(
  corporationId: string,
  requestId: string,
  approve: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_corporation_join_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) return dbError(error, "Couldn't update that request. Only this strata's admin can.");

  // "An approval notification is what brings the requester back in"
  // (doc03 Stage 4). The RPC succeeding is what proved the caller is admin.
  if (approve) {
    const [{ data: request }, { data: corp }] = await Promise.all([
      supabase.from("corporation_join_requests").select("requested_by").eq("id", requestId).single(),
      supabase
        .from("strata_corporations")
        .select("legal_name, building_name")
        .eq("strata_plan_number", corporationId)
        .single(),
    ]);
    if (request) {
      await notifyUser(
        request.requested_by,
        joinRequestApprovedEmail({
          corporationName: corp?.building_name || corp?.legal_name || corporationId,
          openUrl: new URL(`/strata/${corporationId}`, APP_URL).toString(),
        })
      );
    }
  }

  refresh(corporationId);
  return { ok: true };
}

// ── Members ────────────────────────────────────────────────────────────

export async function saveMemberRoles(
  corporationId: string,
  userId: string,
  roles: string[]
): Promise<ActionResult> {
  if (!roles.every(isCorporationRole)) return fail("Unknown role.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_corporation_member_roles", {
    p_corporation_id: corporationId,
    p_user_id: userId,
    p_roles: roles,
  });
  if (error) return dbError(error, "Couldn't save roles.");
  refresh(corporationId);
  return { ok: true };
}

export async function setMeetingPermission(
  corporationId: string,
  userId: string,
  value: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("corporation_memberships")
    .update({ can_run_meetings: value })
    .eq("corporation_id", corporationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("user_id");
  if (error) return dbError(error, "Couldn't update meeting permissions.");
  if (!data?.length) return fail("Only this strata's admin can change meeting permissions.");
  refresh(corporationId);
  return { ok: true };
}

/**
 * The "Billing" switch beside a member (0046): when on, they can use the
 * strata's Billing alongside the admin. Only the admin can change it (the
 * update matches nothing for anyone else).
 */
export async function setBillingPermission(corporationId: string, userId: string, value: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("corporation_memberships")
    .update({ can_manage_billing: value })
    .eq("corporation_id", corporationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("user_id");
  if (error) return dbError(error, "Couldn't change billing access.");
  if (!data?.length) return fail("Only this strata's admin can change who has billing.");
  refresh(corporationId);
  revalidatePath(`/strata/${corporationId}`, "layout");
  return { ok: true };
}

/** Tie a member to their strata lot (council members need one). Admin only. */
export async function setMemberLot(
  corporationId: string,
  userId: string,
  lotNumber: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_lot", {
    p_corporation_id: corporationId,
    p_user_id: userId,
    p_lot_number: lotNumber || null,
  });
  if (error) return dbError(error, "Couldn't set that member's strata lot.");
  refresh(corporationId);
  revalidatePath(`/strata/${corporationId}/lots`);
  return { ok: true };
}

export async function removeMember(corporationId: string, userId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_corporation_member", {
    p_corporation_id: corporationId,
    p_user_id: userId,
  });
  if (error) return dbError(error, "Couldn't remove that member.");
  refresh(corporationId);
  return { ok: true };
}
