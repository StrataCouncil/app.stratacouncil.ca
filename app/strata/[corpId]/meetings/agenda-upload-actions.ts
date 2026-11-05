"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStrataAccess } from "@/lib/data/strata";
import { autoPopulate, ensureBookends, makeItem, NEEDS_MOTION, newCategoryId, newMotion, resolutionTypes, type AgendaItem, type ResolutionType } from "@/lib/meetings/agenda";
import { extractWithOcr } from "@/lib/kb/extract";
import { loadStripContext } from "@/lib/kb/privacy";
import { pseudonymize } from "@/lib/pii";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { demoLimitFail, type DemoLimitFail } from "@/lib/demo";
import { demoRestricted } from "@/lib/demo-sandbox";

/**
 * Reading an uploaded agenda (OCR for scans). Kept apart from the other
 * meeting actions so the OCR engine (tesseract.js, @napi-rs/canvas, about
 * 60 MB) ships only with the page that builds an agenda, not with Meeting
 * Mode, the members' page or the Meetings list, which import those actions.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

async function runner(corpId: string) {
  const access = await getStrataAccess(corpId);
  if (!access) return null;
  if (!access.canRunMeetings) return null;
  return access;
}

const AGENDA_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cat: { type: "string" },
          text: { type: "string" },
          type: { type: "string", enum: [...resolutionTypes] },
          background: { type: "string" },
          financial: { type: "string" },
          risks: { type: "string" },
          motionText: { type: "string" },
        },
        required: ["cat", "text", "type", "background", "financial", "risks", "motionText"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Build an agenda from an uploaded one. The file is read here; names and
 * other personal details are swapped for numbered references before the
 * text goes to the AI, and swapped back in the parsed result — so the
 * agenda shows real names but none were ever sent.
 */
export async function parseUploadedAgenda(corpId: string, formData: FormData): Promise<Ok<{ agenda: AgendaItem[] }> | Fail | DemoLimitFail> {
  if (await demoRestricted()) return demoLimitFail();
  const access = await runner(corpId);
  if (!access) return { ok: false, error: "You can't edit this agenda." };
  if (!access.subscribed && access.freeMeetingUsed) {
    return { ok: false, error: "Reading an uploaded agenda uses Stratasphere AI, which needs a subscription." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an agenda file." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "That file is over 10 MB." };

  // A scanned agenda is read by OCR on our own servers (lib/kb/ocr.ts), up to 10 pages.
  const extracted = await extractWithOcr(new Uint8Array(await file.arrayBuffer()), file.name, file.type, 10).catch(() => null);
  if (!extracted || extracted.status === "unsupported") return { ok: false, error: "Upload a PDF, Word (.docx) or text file." };
  if (extracted.status !== "ok") {
    return { ok: false, error: "We couldn't read any text in that PDF, even from the scan. Upload a clearer copy, or build the agenda by hand." };
  }
  if (extracted.text.trim().length < 20) return { ok: false, error: "That file looks empty." };

  const ctx = await loadStripContext(createAdminClient(), access.corpId);
  const p = pseudonymize(extracted.text.slice(0, 40000), ctx.people, ctx.identity);

  let parsed: { items: Array<Record<string, string>> };
  try {
    parsed = await askClaudeJson({
      effort: "low",
      maxTokens: 16000,
      system:
        "You turn a BC strata corporation's meeting agenda into structured items. Keep the agenda's own wording and order. " +
        "Placeholders like [REF-3] stand for names and other details; copy them exactly where they appear. " +
        "Use FOR_APPROVAL, FOR_DECISION, FOR_RATIFICATION or FOR_DIRECTION only where the agenda shows something to be voted on; otherwise FOR_INFORMATION or FOR_DISCUSSION. " +
        "Use empty strings for anything the agenda doesn't say.",
      messages: [{ role: "user", content: `Agenda:\n\n${p.text}` }],
      schema: AGENDA_SCHEMA,
    });
  } catch (err) {
    console.error("[parseUploadedAgenda]", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error:
        err instanceof ClaudeRefusalError
          ? "Stratasphere couldn't read that agenda. Build it by hand instead."
          : "Couldn't read that agenda automatically. Try again, or build it by hand.",
    };
  }

  const catIds = new Map<string, string>();
  const agenda = parsed.items.slice(0, 200).map((raw) => {
    const cat = p.restore(raw.cat || "Agenda");
    if (!catIds.has(cat)) catIds.set(cat, newCategoryId());
    const type = (resolutionTypes as readonly string[]).includes(raw.type) ? (raw.type as ResolutionType) : "FOR_INFORMATION";
    const needs = NEEDS_MOTION.includes(type);
    return autoPopulate(
      makeItem(p.restore(raw.text), cat, {
        catId: catIds.get(cat)!,
        type,
        background: p.restore(raw.background ?? ""),
        financial: p.restore(raw.financial ?? ""),
        risks: p.restore(raw.risks ?? ""),
        motion: needs ? newMotion("MAJORITY", p.restore(raw.motionText ?? "")) : null,
      })
    );
  });
  return { ok: true, agenda: ensureBookends(agenda) };
}

