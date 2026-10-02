"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MANAGEMENT_LOGOS_BUCKET } from "@/lib/data/management";
import { imageSize, LOGO_TYPES, MAX_LOGO_BYTES, MAX_MANAGERS, type ManagementDetails } from "@/lib/management";

/**
 * The Management tab: the strata's Admin or Manager edits the management
 * company's details and logo (0024). RLS on strata_management enforces
 * the same rule; the role check here also guards the Storage calls,
 * which use the service role.
 */
type Fail = { ok: false; error: string };
type Done = { ok: true } | Fail;

async function requireManager(corpId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("has_corporation_role", { target_corporation_id: corpId, target_roles: ["admin", "manager"] });
  return data === true ? { supabase, user } : null;
}

const notAllowed: Fail = { ok: false, error: "Only this strata's Admin or Manager can change the management details." };
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function saveManagementDetails(corpId: string, input: Omit<ManagementDetails, "logoPath">): Promise<Done> {
  const auth = await requireManager(corpId);
  if (!auth) return notAllowed;
  const email = clip(input.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That company email doesn't look right." };
  const managers = (input.managers ?? [])
    .slice(0, MAX_MANAGERS)
    .map((m) => ({ name: clip(m.name, 120), title: clip(m.title, 120), phone: clip(m.phone, 60), email: clip(m.email, 200) }))
    .filter((m) => m.name || m.title || m.phone || m.email);
  if (managers.some((m) => !m.name)) return { ok: false, error: "Give each manager a name, or remove the row." };
  if (managers.some((m) => m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email))) {
    return { ok: false, error: "One of the manager emails doesn't look right." };
  }
  const { error } = await auth.supabase.from("strata_management").upsert(
    {
      corporation_id: corpId,
      company_name: clip(input.companyName, 200) || null,
      address: clip(input.address, 300) || null,
      phone: clip(input.phone, 60) || null,
      email: email || null,
      website: clip(input.website, 300) || null,
      managers,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    },
    { onConflict: "corporation_id" }
  );
  if (error) {
    console.error("[saveManagementDetails]", error.message);
    return { ok: false, error: "Couldn't save the management details. Please try again." };
  }
  revalidatePath(`/strata/${corpId}/management`);
  return { ok: true };
}

export async function createLogoUpload(
  corpId: string,
  file: { name: string; type: string; size: number }
): Promise<{ ok: true; path: string; token: string } | Fail> {
  if (!(await requireManager(corpId))) return notAllowed;
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "Use a PNG or JPEG image for the logo." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "The logo must be 2 MB or smaller." };
  const path = `${corpId}/${randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  const { data, error } = await createAdminClient().storage.from(MANAGEMENT_LOGOS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[createLogoUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload. Please try again." };
  }
  return { ok: true, path, token: data.token };
}

/** After the browser uploads the logo: point the details at it, and remove the old one. */
export async function setLogo(corpId: string, path: string): Promise<Done> {
  const auth = await requireManager(corpId);
  if (!auth) return notAllowed;
  const [folder, file, ...rest] = path.split("/");
  if (folder !== corpId || !file || rest.length) return { ok: false, error: "That upload doesn't belong to this strata." };
  const admin = createAdminClient();
  const { data: listed } = await admin.storage.from(MANAGEMENT_LOGOS_BUCKET).list(folder, { search: file });
  if (!listed?.some((o) => o.name === file)) return { ok: false, error: "The logo didn't finish uploading. Please try again." };
  // The signed upload doesn't check the content, so check it here.
  const { data: blob } = await admin.storage.from(MANAGEMENT_LOGOS_BUCKET).download(path);
  if (!blob || !imageSize(new Uint8Array(await blob.arrayBuffer()))) {
    await admin.storage.from(MANAGEMENT_LOGOS_BUCKET).remove([path]);
    return { ok: false, error: "That file isn't a PNG or JPEG image." };
  }

  const { data: current } = await auth.supabase.from("strata_management").select("logo_path").eq("corporation_id", corpId).maybeSingle();
  const { error } = await auth.supabase
    .from("strata_management")
    .upsert({ corporation_id: corpId, logo_path: path, updated_at: new Date().toISOString(), updated_by: auth.user.id }, { onConflict: "corporation_id" });
  if (error) return { ok: false, error: "Couldn't save the logo. Please try again." };
  if (current?.logo_path && current.logo_path !== path) await admin.storage.from(MANAGEMENT_LOGOS_BUCKET).remove([current.logo_path]);
  revalidatePath(`/strata/${corpId}/management`);
  return { ok: true };
}

export async function removeLogo(corpId: string): Promise<Done> {
  const auth = await requireManager(corpId);
  if (!auth) return notAllowed;
  const { data: current } = await auth.supabase.from("strata_management").select("logo_path").eq("corporation_id", corpId).maybeSingle();
  if (!current?.logo_path) return { ok: true };
  const { error } = await auth.supabase
    .from("strata_management")
    .update({ logo_path: null, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq("corporation_id", corpId);
  if (error) return { ok: false, error: "Couldn't remove the logo." };
  await createAdminClient().storage.from(MANAGEMENT_LOGOS_BUCKET).remove([current.logo_path]);
  revalidatePath(`/strata/${corpId}/management`);
  return { ok: true };
}
