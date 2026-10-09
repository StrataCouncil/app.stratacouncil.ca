/**
 * The legislation library (Super Admin): shared between the upload screen
 * and its server actions.
 */
export type LegislationKind = "act" | "regulation" | "guidance";

export const LEGISLATION_KINDS: { value: LegislationKind; label: string }[] = [
  { value: "act", label: "Act" },
  { value: "regulation", label: "Regulation" },
  { value: "guidance", label: "Guidance" },
];

export const LEGISLATION_BUCKET = "legislation";
export const LEGISLATION_EXTENSIONS = ["pdf", "docx", "txt", "html", "htm"] as const;
export const MAX_LEGISLATION_BYTES = 50 * 1024 * 1024;

export function isLegislationKind(v: string): v is LegislationKind {
  return v === "act" || v === "regulation" || v === "guidance";
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

/** "real-estate-services-act.txt" -> "Real Estate Services Act". Words already capitalised are left alone; a leading number ID is dropped. */
export function titleFromFileName(name: string) {
  const words = name
    .replace(/\.[^.]+$/, "")
    // Download timestamps and IDs ("1780853222429-working-with-…").
    .replace(/^\d{6,}[\s_\-]+/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const title = words
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  return title.slice(0, 200) || "Untitled";
}

export function guessKind(title: string): LegislationKind {
  if (/\b(guides?|bulletins?|handbooks?|decisions?|guidance|faq)\b/i.test(title)) return "guidance";
  if (/\bregulations?\b/i.test(title)) return "regulation";
  if (/\bact\b/i.test(title)) return "act";
  return "guidance";
}
