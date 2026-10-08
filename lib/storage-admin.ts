import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Removing stored files with the service role, for deletes that also
 * remove database rows (the demo site's clean-up, the Super Admin
 * console's deletes). Server only.
 */

/** Every file path under a folder in a bucket, however deep. */
export async function listFolder(admin: SupabaseClient, bucket: string, folder: string): Promise<string[]> {
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
  return paths;
}

/** Removes these files from a bucket. Returns how many were removed. */
export async function removeFiles(admin: SupabaseClient, bucket: string, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
    if (error) throw new Error(`Removing files from ${bucket}: ${error.message}`);
  }
  return paths.length;
}

/** Every file under a folder in a bucket. Returns how many were removed. */
export async function removeFolder(admin: SupabaseClient, bucket: string, folder: string): Promise<number> {
  return removeFiles(admin, bucket, await listFolder(admin, bucket, folder));
}
