import JSZip from "jszip";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { toBlob } from "html-to-image";
import { PLATFORMS, PLATFORM_INFO, platformTextFile, readmeFile, slideFileName, slideLink, slidesFor, type Platform, type SocialPost } from "./post.ts";

/**
 * The carousel export, in the browser (no server work): every platform's
 * slides drawn to PNG from the hidden export stage, a text file per
 * platform with the post text and tracked links, a PDF for LinkedIn whose
 * pages link to their slide's tracked link, and a README, all in one ZIP.
 */

/** Wait for every picture on the stage to load (or fail), and for the fonts. */
async function ready(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
    )
  );
  await document.fonts.ready;
}

async function slidePng(node: HTMLElement, width: number, height: number): Promise<Blob> {
  // The first capture can miss web fonts and pictures; drawing twice is the documented fix.
  await toBlob(node, { width, height, pixelRatio: 1, cacheBust: false });
  const blob = await toBlob(node, { width, height, pixelRatio: 1, cacheBust: false });
  if (!blob) throw new Error("A slide couldn't be drawn.");
  return blob;
}

async function linkedInPdf(post: SocialPost, pngs: { png: Blob; index: number }[]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(post.title || "StrataCouncil.ca");
  pdf.setAuthor("StrataCouncil.ca");
  const { width, height } = PLATFORM_INFO.linkedin;
  for (const { png, index } of pngs) {
    const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
    // 72 dpi points at half size: a 540 x 675 page holds the 1080 x 1350 slide sharply.
    const w = width / 2;
    const h = height / 2;
    const page = pdf.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    const link = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [0, 0, w, h],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(slideLink(post, "linkedin", index)) },
      })
    );
    page.node.set(PDFName.of("Annots"), pdf.context.obj([link]));
  }
  return pdf.save();
}

export function exportFileName(post: SocialPost) {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}-${post.campaign}.zip`;
}

/**
 * Build the ZIP from the export stage: `stage` holds one element per
 * platform and slide, marked data-platform and data-index.
 */
export async function buildExportZip(post: SocialPost, stage: HTMLElement, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  await ready(stage);
  const zip = new JSZip();
  const root = zip.folder(post.campaign)!;
  root.file("README.txt", readmeFile(post));
  const total = PLATFORMS.reduce((n, p) => n + slidesFor(p, post.slides).length, 0);
  let done = 0;
  for (const platform of PLATFORMS) {
    const folder = root.folder(platform)!;
    const { width, height } = PLATFORM_INFO[platform];
    const pngs: { png: Blob; index: number }[] = [];
    for (const [n, { index }] of slidesFor(platform, post.slides).entries()) {
      const node = stage.querySelector<HTMLElement>(`[data-platform="${platform}"][data-index="${index}"]`);
      if (!node) throw new Error(`Slide ${index + 1} for ${PLATFORM_INFO[platform].label} isn't on the stage.`);
      const png = await slidePng(node.firstElementChild as HTMLElement, width, height);
      folder.file(slideFileName(n), png);
      pngs.push({ png, index });
      onProgress?.(++done, total);
    }
    folder.file("post.txt", platformTextFile(post, platform));
    if (platform === "linkedin") folder.file("carousel.pdf", await linkedInPdf(post, pngs));
  }
  return zip.generateAsync({ type: "blob" });
}

export function platformsWithSlides(post: SocialPost): Platform[] {
  return PLATFORMS.filter((p) => slidesFor(p, post.slides).length > 0);
}
