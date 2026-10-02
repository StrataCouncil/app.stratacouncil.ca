import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Signed links for profile pictures in the private `avatars` bucket, one
 * batch per page. Callers have already confirmed, through RLS, that the
 * viewer may see these people (they share a strata, or a Super Admin).
 */
export async function signAvatarPaths(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data, error } = await createAdminClient().storage.from("avatars").createSignedUrls(unique, 60 * 60);
  if (error) {
    console.error("[signAvatarPaths]", error.message);
    return out;
  }
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}
