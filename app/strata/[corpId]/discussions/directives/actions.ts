"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { suggestDirectiveWording } from "@/lib/directives/wording";
import { IS_DEMO, demoLimitFail, type DemoLimitFail } from "@/lib/demo";
import { logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";

/**
 * Directives (0097). The database decides who may do what
 * (create_directive, update_directive, set_directive_status); these actions
 * tidy the input and pass its reasons on.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

export interface DirectiveInput {
  title: string;
  detail: string;
  assigneeKind: "none" | "manager" | "person";
  assigneeUserId: string | null;
  dueDate: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN = [
  "Only those who run meetings",
  "The manager can mark",
  "Say what needs to be done",
  "Choose who",
  "can't be assigned",
  "isn't available",
  "Choose done",
  "Keep the note",
];

function reason(message: string, fallback: string) {
  if (!KNOWN.some((k) => message.includes(k))) {
    if (message) console.error("[directives]", message);
    return fallback;
  }
  return message.replace(/^[a-z_]+: /, "");
}

function clean(input: DirectiveInput): DirectiveInput | string {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title) return "Say what needs to be done.";
  const kind = (["none", "manager", "person"] as const).includes(input.assigneeKind) ? input.assigneeKind : "none";
  const userId = kind === "person" && typeof input.assigneeUserId === "string" && UUID.test(input.assigneeUserId) ? input.assigneeUserId : null;
  if (kind === "person" && !userId) return "Choose who it's assigned to.";
  const due = typeof input.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : null;
  return { title, detail: String(input.detail ?? "").trim().slice(0, 4000), assigneeKind: kind, assigneeUserId: userId, dueDate: due };
}

function refresh(corpId: string) {
  revalidatePath(`/strata/${corpId}/discussions/directives`);
}

export async function addDirective(corpId: string, input: DirectiveInput): Promise<Ok<{ id: string }> | Fail> {
  const d = clean(input);
  if (typeof d === "string") return { ok: false, error: d };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_directive", {
    p_corporation_id: corpId,
    p_title: d.title,
    p_detail: d.detail,
    p_assignee_kind: d.assigneeKind,
    p_assignee_user_id: d.assigneeUserId,
    p_due_date: d.dueDate,
  });
  if (error || !data) return { ok: false, error: reason(error?.message ?? "", "Couldn't add the directive.") };
  await logDemoActivity({ kind: "directive.added", detail: { title: d.title } });
  refresh(corpId);
  return { ok: true, id: data as string };
}

export async function editDirective(corpId: string, id: string, input: DirectiveInput): Promise<Ok | Fail> {
  if (!UUID.test(id)) return { ok: false, error: "That directive isn't available." };
  const d = clean(input);
  if (typeof d === "string") return { ok: false, error: d };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_directive", {
    p_directive_id: id,
    p_title: d.title,
    p_detail: d.detail,
    p_assignee_kind: d.assigneeKind,
    p_assignee_user_id: d.assigneeUserId,
    p_due_date: d.dueDate,
  });
  if (error) return { ok: false, error: reason(error.message, "Couldn't save the directive.") };
  refresh(corpId);
  return { ok: true };
}

export async function setDirectiveStatus(corpId: string, id: string, status: "open" | "done" | "cancelled", note?: string): Promise<Ok | Fail> {
  if (!UUID.test(id)) return { ok: false, error: "That directive isn't available." };
  if (!["open", "done", "cancelled"].includes(status)) return { ok: false, error: "Choose done, cancelled, or open." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_directive_status", { p_directive_id: id, p_status: status, p_note: String(note ?? "").trim().slice(0, 2000) || null });
  if (error) return { ok: false, error: reason(error.message, "Couldn't update the directive.") };
  await logDemoActivity({ kind: `directive.${status}`, detail: { id } });
  refresh(corpId);
  return { ok: true };
}

/**
 * Suggest clearer wording for a directive (a Stratasphere subscription):
 * what to do, by whom, by when, and any limit. Nothing is saved.
 */
export async function suggestWording(
  corpId: string,
  input: { title: string; detail: string }
): Promise<Ok<{ title: string; detail: string }> | Fail | DemoLimitFail> {
  const access = await getStrataAccess(corpId);
  if (!access?.canRunMeetings) return { ok: false, error: "Only those who run meetings can add or change a directive." };
  if (!access.subscribed) return { ok: false, error: "Suggested wording comes with a Stratasphere subscription." };
  if (!String(input.title ?? "").trim()) return { ok: false, error: "Write what needs to be done first." };
  if (IS_DEMO && !(await takeDemoAllowance("motions"))) {
    await logDemoActivity({ kind: "limit", detail: { reason: "directive wording" } });
    return demoLimitFail();
  }
  const r = await suggestDirectiveWording(access.corpId, String(input.title).slice(0, 300), String(input.detail ?? "").slice(0, 4000));
  if (!r.ok && IS_DEMO) await refundDemoAllowance("motions");
  return r;
}
