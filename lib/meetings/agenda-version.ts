import { createHash } from "node:crypto";
import { normalizeAgenda } from "./agenda.ts";

/**
 * A fingerprint of an agenda's content, for spotting two people saving
 * the same draft agenda. It changes only when the agenda does, so
 * editing the meeting's details (date, place, chair) never makes an
 * agenda editor think someone else changed the agenda. Keys are sorted,
 * so the order the database returns them in doesn't matter.
 */
export function agendaVersion(raw: unknown): string {
  return createHash("sha256").update(stable(normalizeAgenda(raw))).digest("hex").slice(0, 32);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
