"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The one real write AccountSettings makes in this pass — phone has no
 * verification requirement (unlike email, doc01 §7 item 26, still open),
 * so it's a plain authenticated update to the signed-in user's own
 * `profiles` row. RLS's "update own profile" policy (0005_rls.sql) is
 * the actual authorization check here; this just supplies the auth.uid()
 * context via the request-scoped client.
 */
export async function updatePhone(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const phone = String(formData.get("phone") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({ phone: phone || null })
    .eq("id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/account");
}

const AVATARS_BUCKET = "avatars";
const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Profile photo. Stored in the private `avatars` bucket (0017) under the
 * user's own id and shown through short-lived signed URLs. Written with
 * the service role because signed-in users can only update their own
 * name and phone on `profiles` (0016).
 */
export async function uploadAvatar(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo." };
  const ext = AVATAR_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a JPEG, PNG or WebP image." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "That photo is over 5 MB." };

  const admin = createAdminClient();
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(AVATARS_BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) {
    console.error("[uploadAvatar]", upErr.message);
    return { ok: false, error: "Couldn't save the photo. Try again." };
  }

  const { data: old } = await admin.from("profiles").select("avatar_path").eq("id", user.id).single();
  const { error } = await admin.from("profiles").update({ avatar_path: path }).eq("id", user.id);
  if (error) {
    console.error("[uploadAvatar] profile", error.message);
    await admin.storage.from(AVATARS_BUCKET).remove([path]);
    return { ok: false, error: "Couldn't save the photo. Try again." };
  }
  if (old?.avatar_path) await admin.storage.from(AVATARS_BUCKET).remove([old.avatar_path]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAvatar(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  const { data: old } = await admin.from("profiles").select("avatar_path").eq("id", user.id).single();
  const { error } = await admin.from("profiles").update({ avatar_path: null }).eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't remove the photo. Try again." };
  if (old?.avatar_path) await admin.storage.from(AVATARS_BUCKET).remove([old.avatar_path]);
  revalidatePath("/", "layout");
  return { ok: true };
}
