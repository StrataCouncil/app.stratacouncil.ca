import type { Metadata } from "next";
import localFont from "next/font/local";
import { IS_DEMO } from "@/lib/demo";
import "./globals.css";

// The brand fonts, served from this site (app/fonts, SIL Open Font
// License): builds never fetch them from Google, and visitors' browsers
// never ask Google for them either.
const fraunces = localFont({
  src: "./fonts/fraunces-latin-wght.woff2",
  variable: "--font-fraunces",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

const workSans = localFont({
  src: "./fonts/work-sans-latin-wght.woff2",
  variable: "--font-work-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  // Link previews (Messages and others) show the title under the image, so
  // it's the plain name (the demo says what it is).
  title: IS_DEMO ? "StrataCouncil.ca Demo" : "StrataCouncil.ca",
  description: "Council training and Stratasphere™ governance tools for BC strata councils.",
  // The preview image is app/opengraph-image.png (the logo); this makes X show it large too.
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${workSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
