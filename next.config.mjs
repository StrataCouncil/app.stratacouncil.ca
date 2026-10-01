/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Uploaded agendas and historic minutes are read server-side (their
    // text never goes to the browser's AI calls); allow files up to 10 MB.
    serverActions: { bodySizeLimit: "10mb" },
  },
  // pdf.js (via unpdf) and mammoth are server-only and shouldn't be bundled.
  serverExternalPackages: ["unpdf", "mammoth"],
};
export default nextConfig;
