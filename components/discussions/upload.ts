"use client";

import { createDiscussionUploads, registerDiscussionFiles } from "@/app/strata/[corpId]/discussions/actions";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "discussion-files";

/** Uploads files to a discussion's motion (commentId null) or to a comment. Null when they're all in. */
export async function uploadDiscussionFiles(corpId: string, discussionId: string, commentId: string | null, files: File[]): Promise<string | null> {
  if (files.length === 0) return null;
  const started = await createDiscussionUploads(corpId, discussionId, commentId, files.map((f) => ({ name: f.name, size: f.size })));
  if (!started.ok) return started.error;
  const storage = createClient().storage.from(BUCKET);
  for (const [i, ticket] of started.tickets.entries()) {
    const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, files[i], { contentType: files[i].type || undefined });
    if (error) return `${files[i].name} didn't upload: ${error.message}`;
  }
  const done = await registerDiscussionFiles(
    corpId,
    discussionId,
    commentId,
    started.tickets.map((t, i) => ({ path: t.path, name: files[i].name, size: files[i].size, type: files[i].type }))
  );
  return done.ok ? null : done.error;
}
