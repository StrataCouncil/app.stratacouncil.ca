import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

/**
 * Text out of an uploaded or fetched file. Runs entirely on our own
 * servers — nothing is sent anywhere to read it.
 *
 * Scanned PDFs (no text layer) come back as `needs_text` rather than being
 * sent to an AI model to read: that would hand the raw, unstripped page
 * images to a third party, which the PII rule doesn't allow.
 */
export type Extraction =
  | { status: "ok"; text: string }
  | { status: "needs_text" }
  | { status: "unsupported"; reason: string };

/** Fewer characters than this from a multi-page PDF means there's no real text layer. */
const MIN_TEXT_PER_PAGE = 40;

export async function extractDocumentText(bytes: Uint8Array, fileName: string, mimeType?: string | null): Promise<Extraction> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const mime = (mimeType ?? "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const cleaned = normalize(text);
    if (cleaned.replace(/\s/g, "").length < Math.max(100, totalPages * MIN_TEXT_PER_PAGE)) {
      return { status: "needs_text" };
    }
    return { status: "ok", text: cleaned };
  }
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { status: "ok", text: normalize(value) };
  }
  if (ext === "txt" || mime.startsWith("text/plain")) {
    return { status: "ok", text: normalize(new TextDecoder().decode(bytes)) };
  }
  if (mime.startsWith("text/html") || ext === "html" || ext === "htm") {
    return { status: "ok", text: normalize(htmlToText(new TextDecoder().decode(bytes))) };
  }
  return { status: "unsupported", reason: "Only PDF, Word (.docx) and text files can be indexed." };
}

function normalize(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
