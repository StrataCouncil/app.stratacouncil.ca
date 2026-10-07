import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A plain PDF from a kit document's text ("# " and "## " headings, "- "
 * bullets, paragraphs): what an owner would upload to the Library.
 */
export async function textPdf(text: string, footer: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 64;
  const ink = rgb(0.106, 0.165, 0.255);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const write = (line: string, font: PDFFont, size: number, x: number) => {
    if (y < M + size) newPage();
    page.drawText(line, { x, y: y - size, size, font, color: ink });
    y -= size * 1.42;
  };
  const wrap = (para: string, font: PDFFont, size: number, width: number) => {
    const words = para.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  for (const block of text.trim().split(/\n/)) {
    const line = safe(block.trimEnd());
    if (!line.trim()) {
      y -= 6;
      continue;
    }
    if (line.startsWith("# ")) {
      for (const l of wrap(line.slice(2), bold, 17, W - 2 * M)) write(l, bold, 17, M);
      y -= 4;
    } else if (line.startsWith("## ")) {
      y -= 6;
      for (const l of wrap(line.slice(3), bold, 12.5, W - 2 * M)) write(l, bold, 12.5, M);
    } else if (line.startsWith("- ")) {
      const lines = wrap(line.slice(2), regular, 10.5, W - 2 * M - 14);
      lines.forEach((l, i) => {
        if (i === 0) {
          if (y < M + 10.5) newPage();
          page.drawText("•", { x: M + 2, y: y - 10.5, size: 10.5, font: regular, color: ink });
        }
        write(l, regular, 10.5, M + 14);
      });
    } else {
      for (const l of wrap(line, regular, 10.5, W - 2 * M)) write(l, regular, 10.5, M);
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = safe(`${footer}  ·  Page ${i + 1} of ${pages.length}`);
    p.drawText(label, { x: M, y: 32, size: 8, font: regular, color: rgb(0.42, 0.45, 0.5) });
  });
  return pdf.save();
}

/** The standard PDF fonts only cover Latin-1: swap the few characters that aren't. */
function safe(s: string) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xff•·]/g, "");
}
