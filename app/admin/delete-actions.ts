"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { MANAGEMENT_LOGOS_BUCKET } from "@/lib/data/management";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import { listFolder, removeFiles, removeFolder } from "@/lib/storage-admin";

/**
 * Deleting a strata, or an account, from the Super Admin console (0047).
 * Each is two steps: a preview (the database's dry run: how many rows each
 * table loses, and the files), then the delete, confirmed by typing the
 * Strata Plan number or the email address. Rows go through the database
 * (platform_delete_strata / platform_delete_person, service role only);
 * the stored files are removed here afterwards. Nothing in Stripe changes.
 */

const AVATARS_BUCKET = "avatars";
const STRATA_PLANS_BUCKET = "strata-plans";

export interface DeletePlanRow {
  table: string;
  rows: number;
}

type Fail = { ok: false; error: string };

const label = (table: string) => table.replace(/^public\./, "").replace(/_/g, " ");

function toPlan(rows: Array<{ tbl: string; n: number }> | null): DeletePlanRow[] {
  return (rows ?? []).map((r) => ({ table: label(r.tbl), rows: Number(r.n) })).sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
}

/** The database's own words for a refusal (an active subscription, a member still in a strata). */
function refusal(message: string | undefined, fallback: string) {
  return message && !/permission|function/i.test(message) ? message : fallback;
}

/** A strata's stored files: its documents (and its Strata Plan), and its management logo. */
async function strataFiles(corpId: string) {
  const admin = createAdminClient();
  const { data: corp } = await admin.from("strata_corporations").select("source_document_id").eq("strata_plan_number", corpId).maybeSingle();
  const { data: docs } = await admin
    .from("documents")
    .select("storage_path")
    .or(`corporation_id.eq.${corpId}${corp?.source_document_id ? `,id.eq.${corp.source_document_id}` : ""}`);
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, path: string) => byBucket.set(bucket, (byBucket.get(bucket) ?? new Set()).add(path));
  for (const d of docs ?? []) {
    const sp = d.storage_path as string | null;
    if (!sp) continue;
    const slash = sp.indexOf("/");
    if (slash > 0) add(sp.slice(0, slash), sp.slice(slash + 1));
  }
  for (const [bucket] of [[DOCUMENTS_BUCKET], [MANAGEMENT_LOGOS_BUCKET]]) {
    for (const path of await listFolder(admin, bucket, corpId)) add(bucket, path);
  }
  return byBucket;
}

const countFiles = (m: Map<string, Set<string>>) => [...m.values()].reduce((n, s) => n + s.size, 0);

export async function previewStrataDelete(corpId: string): Promise<{ ok: true; plan: DeletePlanRow[]; files: number } | Fail> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Only platform staff can do this." };
  const { data, error } = await createAdminClient().rpc("platform_delete_strata", { p_corporation_id: corpId, p_dry: true });
  if (error) return { ok: false, error: refusal(error.message, "Couldn't work out what would be deleted.") };
  try {
    return { ok: true, plan: toPlan(data), files: countFiles(await strataFiles(corpId)) };
  } catch (err) {
    console.error("[previewStrataDelete]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't list the strata's files." };
  }
}

export async function deleteStrata(corpId: string, typed: string): Promise<{ ok: true; rows: number; files: number } | Fail> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Only platform staff can do this." };
  if (typed.trim().toUpperCase() !== corpId.toUpperCase()) return { ok: false, error: `Type ${corpId} to confirm.` };
  const admin = createAdminClient();
  let files: Map<string, Set<string>>;
  try {
    files = await strataFiles(corpId);
  } catch (err) {
    console.error("[deleteStrata] files", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't list the strata's files, so nothing was deleted." };
  }
  const { data, error } = await admin.rpc("platform_delete_strata", { p_corporation_id: corpId, p_dry: false });
  if (error) return { ok: false, error: refusal(error.message, "Couldn't delete the strata.") };
  let removed = 0;
  try {
    for (const [bucket, paths] of files) removed += await removeFiles(admin, bucket, [...paths]);
  } catch (err) {
    console.error("[deleteStrata] storage", err instanceof Error ? err.message : err);
    return { ok: false, error: "The strata's records are deleted, but some of its files couldn't be removed. Check Storage in Supabase." };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, rows: toPlan(data).reduce((n, r) => n + r.rows, 0), files: removed };
}

async function findAccount(email: string) {
  const { data } = await createAdminClient().from("profiles").select("id, full_name, email").eq("email", email.trim().toLowerCase()).maybeSingle();
  return data as { id: string; full_name: string | null; email: string } | null;
}

/** Plans the account uploaded that no remaining document still points at. */
async function orphanPlans(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const paths = await listFolder(admin, STRATA_PLANS_BUCKET, userId);
  if (!paths.length) return [];
  const { data } = await admin
    .from("documents")
    .select("storage_path")
    .in("storage_path", paths.map((p) => `${STRATA_PLANS_BUCKET}/${p}`));
  const used = new Set((data ?? []).map((d) => d.storage_path as string));
  return paths.filter((p) => !used.has(`${STRATA_PLANS_BUCKET}/${p}`));
}

export async function previewAccountDelete(
  email: string
): Promise<{ ok: true; name: string; email: string; plan: DeletePlanRow[]; files: number } | Fail> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Only platform staff can do this." };
  const account = await findAccount(email);
  if (!account) return { ok: false, error: "There's no account with that email address." };
  const { data, error } = await createAdminClient().rpc("platform_delete_person", { p_user_id: account.id, p_dry: true });
  if (error) return { ok: false, error: refusal(error.message, "Couldn't work out what would be deleted.") };
  try {
    const admin = createAdminClient();
    const files = (await listFolder(admin, AVATARS_BUCKET, account.id)).length + (await orphanPlans(account.id)).length;
    return { ok: true, name: account.full_name || account.email, email: account.email, plan: toPlan(data), files };
  } catch (err) {
    console.error("[previewAccountDelete]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't list the account's files." };
  }
}

export async function deleteAccount(email: string, typed: string): Promise<{ ok: true } | Fail> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Only platform staff can do this." };
  const account = await findAccount(email);
  if (!account) return { ok: false, error: "There's no account with that email address." };
  if (typed.trim().toLowerCase() !== account.email.toLowerCase()) return { ok: false, error: `Type ${account.email} to confirm.` };
  const admin = createAdminClient();
  let plans: string[];
  try {
    plans = await orphanPlans(account.id);
  } catch (err) {
    console.error("[deleteAccount] files", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't list the account's files, so nothing was deleted." };
  }
  const { error } = await admin.rpc("platform_delete_person", { p_user_id: account.id, p_dry: false });
  if (error) return { ok: false, error: refusal(error.message, "Couldn't delete the account.") };
  try {
    await removeFolder(admin, AVATARS_BUCKET, account.id);
    await removeFiles(admin, STRATA_PLANS_BUCKET, plans);
  } catch (err) {
    console.error("[deleteAccount] storage", err instanceof Error ? err.message : err);
  }
  const { error: authError } = await admin.auth.admin.deleteUser(account.id);
  if (authError && !/not found/i.test(authError.message)) {
    console.error("[deleteAccount] auth", authError.message);
    return { ok: false, error: "The account's records are deleted, but its sign-in couldn't be removed. Try again." };
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
}
