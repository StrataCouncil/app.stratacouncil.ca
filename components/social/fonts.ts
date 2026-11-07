import localFont from "next/font/local";

/**
 * The carousel fonts: the brand's Fraunces and Work Sans, as variable fonts
 * so slides can use the full weight range (Fraunces Black for display
 * headlines, Light for editorial lines; Work Sans Black for list titles).
 * Loaded only on the Social tab, from this site (app/fonts).
 */
export const socialSerif = localFont({
  src: "../../app/fonts/fraunces-latin-full.woff2",
  variable: "--font-social-serif",
  weight: "100 900",
  style: "normal",
  display: "block",
});
export const socialSans = localFont({
  src: "../../app/fonts/work-sans-latin-wght.woff2",
  variable: "--font-social-sans",
  weight: "100 900",
  style: "normal",
  display: "block",
});

export const socialFontClass = `${socialSerif.variable} ${socialSans.variable}`;
