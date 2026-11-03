import { NextResponse } from "next/server";
import { DISCUSSION_FILES_BUCKET } from "@/lib/discussions/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A discussion's attachment (0070). The row is read as the signed-in
 * person, so the database's council rules decide (a recused member gets
 * the motion's files but not the comments'); then a short-lived link from
 * the private bucket.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ corpId: string; discussionId: string; fileId: string }> }) {
  const { corpId, discussionId, fileId } = await params;
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("discussion_files")
    .select("storage_path, file_name, discussion_id")
    .eq("id", fileId)
    .eq("discussion_id", discussionId)
    .maybeSingle();
  if (!file || !file.storage_path.startsWith(`${corpId}/${discussionId}/`)) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createAdminClient()
    .storage.from(DISCUSSION_FILES_BUCKET)
    .createSignedUrl(file.storage_path, 60 * 5, { download: file.file_name });
  if (error || !data) return new NextResponse("Couldn't prepare the file.", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
