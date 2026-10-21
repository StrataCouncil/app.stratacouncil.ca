import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { createDocumentUploads, registerDocuments } from "@/app/strata/[corpId]/documents/actions";

/**
 * The browser side of adding files to a strata's documents: upload each
 * to storage with a signed ticket, then register them in a folder (which
 * files and indexes them). Shared by Upload and Import from Google Drive.
 */
export async function uploadToStrataDocuments(
  corpId: string,
  category: string,
  files: File[],
  onStatus: (status: string) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tickets = await createDocumentUploads(
    corpId,
    files.map((f) => ({ name: f.name, size: f.size }))
  );
  if (!tickets.ok) return tickets;

  const storage = createClient().storage.from(DOCUMENTS_BUCKET);
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ticket = tickets.tickets[i];
    onStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
    const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (error) return { ok: false, error: `${file.name} didn't upload. Please try again.` };
    uploaded.push({ path: ticket.path, name: file.name, size: file.size, type: file.type });
  }

  onStatus("Saving…");
  return registerDocuments(corpId, category, uploaded);
}
