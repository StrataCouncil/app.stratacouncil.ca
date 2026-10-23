import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import {
  createDocumentUploads,
  findIdenticalDocuments,
  registerDocuments,
  type IdenticalDocument,
} from "@/app/strata/[corpId]/documents/actions";
import { sha256Hex } from "@/lib/fingerprint";

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

/** A chosen file that's already in Documents, and the copy that's there. */
export interface AlreadyInDocuments {
  file: File;
  existing: IdenticalDocument;
}

/**
 * Which of these files are already in the strata's Documents, matched on
 * their contents (lib/fingerprint.ts), not their names. A check that
 * can't run (a file can't be read) finds nothing rather than blocking.
 */
export async function findAlreadyInDocuments(corpId: string, files: File[]): Promise<AlreadyInDocuments[]> {
  try {
    const hashes = await Promise.all(files.map(async (f) => sha256Hex(await f.arrayBuffer())));
    const found = await findIdenticalDocuments(corpId, hashes);
    const byHash = new Map(found.map((d) => [d.sha256, d]));
    return files.flatMap((file, i) => {
      const existing = byHash.get(hashes[i]);
      return existing ? [{ file, existing }] : [];
    });
  } catch {
    return [];
  }
}
