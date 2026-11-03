import { tmpdir } from "node:os";
import path from "node:path";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/**
 * Reading scanned PDF pages (pages with no text layer) with OCR, entirely
 * on our own servers: each page is drawn as an image and read by
 * Tesseract, an open-source OCR engine. Nothing is sent anywhere, so the
 * PII rule still holds (the text is stripped before it reaches any AI
 * service, like any other document's). The English model ships with the
 * app (lib/kb/tessdata, Apache-2.0, from the Tesseract project), so
 * nothing is downloaded at run time either.
 *
 * About 2 seconds a page. Typed and printed pages read well; handwriting
 * and very faint scans don't, which the confidence score shows.
 */

/** More pages than this aren't read; the rest of a very long scan is left out. */
export const OCR_MAX_PAGES = 300;
/** A page read with less confidence than this (0 to 100) is "unclear". */
export const OCR_UNCLEAR_BELOW = 70;
/** Drawn at 2.5x the PDF's size: about 180 dots per inch for a letter page. */
const SCALE = 2.5;

export interface OcrPage {
  page: number;
  text: string;
  /** 0 to 100; 0 for a page with nothing on it. */
  confidence: number;
}

const TESSDATA = path.join(process.cwd(), "lib/kb/tessdata");

/** Reads the given pages (1-based) of a PDF. */
export async function ocrPdfPages(bytes: Uint8Array, pages: number[]): Promise<OcrPage[]> {
  if (pages.length === 0) return [];
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath: TESSDATA, cachePath: tmpdir(), gzip: true });
  try {
    const out: OcrPage[] = [];
    for (const n of pages) {
      // pdf.js takes ownership of the buffer it's given, so each page gets a copy.
      const image = await renderPageAsImage(new Uint8Array(bytes), n, { canvasImport: () => import("@napi-rs/canvas"), scale: SCALE });
      const { data } = await worker.recognize(Buffer.from(image));
      const text = data.text.trim();
      out.push({ page: n, text, confidence: text ? Math.round(data.confidence) : 0 });
    }
    return out;
  } finally {
    await worker.terminate();
  }
}

/** A PDF's text, page by page, from its text layer; and which pages have none. */
export async function pdfTextByPage(bytes: Uint8Array): Promise<{ pages: string[]; scanned: number[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: string[] = [];
  const scanned: number[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("");
    pages.push(text);
    if (text.replace(/\s/g, "").length < MIN_TEXT_PER_PAGE) scanned.push(n);
  }
  return { pages, scanned };
}

/** A page with fewer characters than this in its text layer is treated as scanned. */
export const MIN_TEXT_PER_PAGE = 40;

export interface OcrSummary {
  /** Pages read by OCR. */
  read: number;
  /** Of those, read with low confidence. */
  unclear: number;
  /** Scanned pages past OCR_MAX_PAGES, left out. */
  skipped: number;
  /** Average confidence over the pages that had text, 0 to 100. */
  confidence: number | null;
}

/** Puts OCR'd pages back among the text-layer pages, in order, and sums up how it went. */
export function mergeOcr(textPages: string[], ocr: OcrPage[], skipped: number): { text: string; summary: OcrSummary } {
  const byPage = new Map(ocr.map((o) => [o.page, o.text]));
  const text = textPages.map((t, i) => byPage.get(i + 1) ?? t).join("\n\n");
  const withText = ocr.filter((o) => o.text);
  return {
    text,
    summary: {
      read: ocr.length,
      unclear: withText.filter((o) => o.confidence < OCR_UNCLEAR_BELOW).length,
      skipped,
      confidence: withText.length ? Math.round(withText.reduce((n, o) => n + o.confidence, 0) / withText.length) : null,
    },
  };
}
