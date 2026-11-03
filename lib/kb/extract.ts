import mammoth from "mammoth";
import { mergeOcr, ocrPdfPages, pdfTextByPage, type OcrSummary } from "./ocr.ts";

/**
 * Text out of an uploaded or fetched file. Runs entirely on our own
 * servers — nothing is sent anywhere to read it.
 *
 * A PDF with pages that have no text layer (scanned) comes back as
 * `needs_ocr`, with those pages: they're read by OCR on our own servers
 * (lib/kb/ocr.ts), never sent to an AI model to read, which would hand the
 * raw, unstripped page images to a third party. The background indexer
 * reads them a few pages at a time; extractWithOcr() reads a short one
 * straight away. `needs_text` is what's left when OCR found nothing.
 */
export type Extraction =
  | { status: "ok"; text: string; ocr?: OcrSummary }
  | { status: "needs_ocr"; scanned: number[]; totalPages: number }
  | { status: "needs_text" }
  | { status: "unsupported"; reason: string };

export async function extractDocumentText(bytes: Uint8Array, fileName: string, mimeType?: string | null): Promise<Extraction> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const mime = (mimeType ?? "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") {
    const { pages, scanned } = await pdfTextByPage(bytes);
    if (scanned.length) return { status: "needs_ocr", scanned, totalPages: pages.length };
    return { status: "ok", text: normalize(pages.join("\n\n")) };
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

/**
 * The same, reading up to `maxOcrPages` scanned pages straight away, for
 * uploads read while the person waits (historic minutes, an agenda). Past
 * that, the rest of the scan is left out (ocr.skipped says how many).
 */
export async function extractWithOcr(bytes: Uint8Array, fileName: string, mimeType: string | null | undefined, maxOcrPages: number): Promise<Extraction> {
  const first = await extractDocumentText(bytes, fileName, mimeType);
  if (first.status !== "needs_ocr") return first;
  return readScannedPages(bytes, first.scanned, maxOcrPages);
}

/** Reads a PDF's scanned pages (up to `maxOcrPages`) and puts them among its text pages. */
export async function readScannedPages(bytes: Uint8Array, scanned: number[], maxOcrPages: number): Promise<Extraction> {
  const { pages } = await pdfTextByPage(bytes);
  const toRead = scanned.slice(0, maxOcrPages);
  const ocr = await ocrPdfPages(bytes, toRead);
  return finishOcr(pages, ocr, scanned.length - toRead.length);
}

/** Text pages plus OCR'd pages: the document's text, or needs_text if there's still nothing to read. */
export function finishOcr(textPages: string[], ocr: Awaited<ReturnType<typeof ocrPdfPages>>, skipped: number): Extraction {
  const { text, summary } = mergeOcr(textPages, ocr, skipped);
  const cleaned = normalize(text);
  if (cleaned.replace(/\s/g, "").length < 20) return { status: "needs_text" };
  return { status: "ok", text: cleaned, ocr: summary };
}

function normalize(text: string) {
  return text
    // Control characters (a null in particular, common in PDFs printed from
    // mail apps) can't be stored in a text column.
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, "")
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
