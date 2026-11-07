const OCR_FILES = ["./lib/kb/tessdata/**", "./node_modules/tesseract.js-core/*.wasm"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Uploaded agendas and historic minutes are read server-side (their
    // text never goes to the browser's AI calls); allow files up to 10 MB.
    serverActions: { bodySizeLimit: "10mb" },
  },
  // pdf.js (via unpdf) and mammoth are server-only and shouldn't be bundled.
  // tesseract.js runs OCR in a worker thread from its own files, and
  // @napi-rs/canvas is a native module; neither can be bundled (lib/kb/ocr.ts).
  serverExternalPackages: ["unpdf", "mammoth", "tesseract.js", "@napi-rs/canvas"],
  // @napi-rs/canvas ships a build for musl Linux (Alpine) beside the glibc
  // one Vercel runs; tracing picks up both. Leave the unused one out (29 MB
  // in every function that reads PDFs).
  outputFileTracingExcludes: {
    "*": ["node_modules/@napi-rs/canvas-linux-x64-musl/**"],
    // The includes above match by substring ("/strata" matches every page
    // under it), so the OCR files are taken back out of the pages that never
    // read a scan: about 15 MB off each. Only the strata page (plan upload),
    // a strata's overview, Documents and a document category (historic
    // minutes), Meetings and a meeting's agenda page (agenda upload), and the
    // background indexer keep them. A new page under /strata keeps them too
    // until it's added here; that costs space, never breaks anything.
    "/strata/\\[corpId\\]/{assistant,billing,calendar,council,decisions,discussions,documents/export,guides,lots,management,meetings/new,meetings/video-test,meetings/\\[meetingId\\]/,minutes}": [
      "lib/kb/tessdata/**",
      "node_modules/tesseract.js-core/**",
      "node_modules/tesseract.js/**",
      "node_modules/@napi-rs/canvas*/**",
    ],
  },
  // The policy template download embeds Work Sans (lib/exports/policy-docx.ts).
  // OCR (lib/kb/ocr.ts) ships with the routes that read PDFs: the English
  // model, and the engine's WebAssembly files, which it loads from disk
  // and so the build's file tracing doesn't find on its own.
  outputFileTracingIncludes: {
    "/strata/[corpId]/guides/[resourceId]/template.docx": ["./lib/exports/fonts/**"],
    "/api/inngest": OCR_FILES,
    "/strata": OCR_FILES,
    "/strata/[corpId]/documents/[category]": OCR_FILES,
    "/strata/[corpId]/meetings/[meetingId]": OCR_FILES,
  },
  // The demo site's switch (lib/demo.ts), for the browser's code too.
  env: { DEMO_MODE: process.env.DEMO_MODE ?? "" },
  // Browser security settings for every page (2026-10 audit): no other site
  // may show the app inside a frame (clickjacking), files are never
  // second-guessed into another type, other sites see only our address, not
  // the page, and location is never used. The camera and microphone may be
  // used by this site's own pages only (meeting video, and Test video and
  // audio), never by another site's frame. That has to hold on every page:
  // the app moves between pages without reloading, and the browser keeps
  // the policy of the page it first loaded, so allowing it on the meeting
  // pages alone blocked the camera until a reload.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
        ],
      },
      // The Zoom frame itself: shown only inside our own pages.
      {
        source: "/zoom-frame.html",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
        ],
      },
    ];
  },
  poweredByHeader: false,
};
export default nextConfig;
