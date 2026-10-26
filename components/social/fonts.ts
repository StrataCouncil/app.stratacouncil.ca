import { Fraunces, Work_Sans } from "next/font/google";

/**
 * The carousel fonts: the brand's Fraunces and Work Sans, as variable fonts
 * so slides can use the full weight range (Fraunces Black for display
 * headlines, Light for editorial lines; Work Sans Black for list titles).
 * Loaded only on the Social tab.
 */
export const socialSerif = Fraunces({ subsets: ["latin"], variable: "--font-social-serif", axes: ["SOFT", "opsz"], display: "block" });
export const socialSans = Work_Sans({ subsets: ["latin"], variable: "--font-social-sans", display: "block" });

export const socialFontClass = `${socialSerif.variable} ${socialSans.variable}`;
