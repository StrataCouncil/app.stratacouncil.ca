import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import { IS_DEMO } from "@/lib/demo";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600", "700"],
  style: ["normal"],
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  // Link previews (Messages and others) drop a "StrataCouncil.ca —" prefix, so the demo says what it is.
  title: IS_DEMO ? "StrataCouncil.ca Demo" : "StrataCouncil.ca — App",
  description: "Council Training and Stratasphere™ governance tools for BC strata councils.",
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
