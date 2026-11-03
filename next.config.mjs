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
  // the page, and the camera, microphone and location are never used.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  poweredByHeader: false,
};
export default nextConfig;
