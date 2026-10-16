/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Uploaded agendas and historic minutes are read server-side (their
    // text never goes to the browser's AI calls); allow files up to 10 MB.
    serverActions: { bodySizeLimit: "10mb" },
  },
  // pdf.js (via unpdf) and mammoth are server-only and shouldn't be bundled.
  serverExternalPackages: ["unpdf", "mammoth"],
  // The policy template download embeds Work Sans (lib/exports/policy-docx.ts).
  outputFileTracingIncludes: { "/strata/[corpId]/guides/[resourceId]/template.docx": ["./lib/exports/fonts/**"] },
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
