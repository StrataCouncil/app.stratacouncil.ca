"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publishInvestorDeck, startInvestorDeckUpload } from "@/app/admin/investors/actions";
import { INVESTOR_DECK_BUCKET } from "@/lib/investors/briefing";

/** Slides are this wide, in pixels: sharp on a large screen, a few hundred KB each. */
const SLIDE_WIDTH = 1920;

/**
 * Super Admin: upload the investor deck as a PDF (0061). The browser turns
 * each page into an image and uploads them; once every slide is up, the
 * new deck replaces the old one for investors. Investors only ever get the
 * images, never the PDF.
 */
export function InvestorDeckUpload() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      setStatus("Reading the PDF…");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      const started = await startInvestorDeckUpload({
        title: file.name.replace(/\.pdf$/i, ""),
        pageCount: pdf.numPages,
        aspect: first.width / first.height,
      });
      if (!started.ok) throw new Error(started.error);

      const storage = createClient().storage.from(INVESTOR_DECK_BUCKET);
      for (let n = 1; n <= pdf.numPages; n++) {
        setStatus(`Preparing slide ${n} of ${pdf.numPages}…`);
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: SLIDE_WIDTH / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser can't prepare the slides.");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error(`Couldn't prepare slide ${n}.`);
        const ticket = started.tickets[n - 1];
        const { error: upErr } = await storage.uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: "image/png", upsert: true });
        if (upErr) throw new Error(`Slide ${n} didn't upload: ${upErr.message}`);
      }
      setStatus("Publishing…");
      const published = await publishInvestorDeck(started.deckId);
      if (!published.ok) throw new Error(published.error);
      setStatus(`Published: ${pdf.numPages} slides. Investors see the new deck now.`);
      router.refresh();
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "The upload didn't finish.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="investor-deck-upload">
      <label className="button button-primary">
        {busy ? "Uploading…" : "Upload a new deck (PDF)"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          hidden
          disabled={busy}
          data-testid="investor-deck-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </label>
      {status && (
        <p className="card__meta" role="status" style={{ marginTop: "0.6rem" }}>
          {status}
        </p>
      )}
      {error && (
        <p className="form-alert" role="alert" style={{ marginTop: "0.6rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
