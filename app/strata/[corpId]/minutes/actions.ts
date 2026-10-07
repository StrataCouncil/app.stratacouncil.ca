"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrataAccess } from "@/lib/data/strata";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { extractDocumentText } from "@/lib/kb/extract";
import { loadStripContext, stripForCorporation } from "@/lib/kb/privacy";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { registerUploadedDocuments, type UploadedFile } from "@/app/strata/[corpId]/documents/actions";
import { IS_DEMO, demoLimitFail } from "@/lib/demo";

/**
 * Historic minutes (doc03 Stage 5a — "upload your historic minutes"):
 * minutes from before the strata used StrataCouncil.ca. The file joins the
 * repository and is indexed; the decisions in it are extracted, reviewed
 * by the uploader, and the carried ones join the decision ledger.
 *
 * The strata plan check is done here, on the text, without AI. Only
 * PII-stripped text is sent to the AI to find the decisions, so movers and
 * seconders come back as lot numbers.
 */

type Fail = { ok: false; error: string };

export interface ExtractedDecision {
  title: string;
  outcome: "CARRIED" | "DEFEATED" | "DEFERRED";
  summary: string;
  motionText: string;
  mover: string;
  seconder: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
}

export interface HistoricAnalysis {
  planNumber: string;
  meetingDate: string;
  meetingType: string;
  decisions: ExtractedDecision[];
}

const PLAN_RE = /\b(BCS|EPS|LMS|VAS|VIS|KAS|NES|NWS|EPP|BCP|LMP|VIP|KAP|VR|NW|KS|NS|VS)\s?-?\s?(\d{2,6})\b/gi;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const LOT = /^SL\s?-?\d{1,4}$/i;

const SCHEMA = {
  type: "object",
  properties: {
    meetingDate: { type: "string", description: "YYYY-MM-DD, or empty if not stated" },
    meetingType: { type: "string", enum: ["council", "agm", "sgm", "committee", ""] },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          outcome: { type: "string", enum: ["CARRIED", "DEFEATED", "DEFERRED"] },
          summary: { type: "string" },
          motionText: { type: "string" },
          mover: { type: "string" },
          seconder: { type: "string" },
          votesFor: { type: "string" },
          votesAgainst: { type: "string" },
          votesAbstain: { type: "string" },
        },
        required: ["title", "outcome", "summary", "motionText", "mover", "seconder", "votesFor", "votesAgainst", "votesAbstain"],
        additionalProperties: false,
      },
    },
  },
  required: ["meetingDate", "meetingType", "decisions"],
  additionalProperties: false,
};

export async function analyzeHistoricMinutes(corpId: string, file: UploadedFile): Promise<({ ok: true } & HistoricAnalysis) | Fail> {
  // The demo has only its own materials (lib/demo.ts).
  if (IS_DEMO) return demoLimitFail();
  const access = await getStrataAccess(corpId);
  if (!access?.canRunMeetings) return { ok: false, error: "Historic minutes are added by your secretary, admin, or whoever runs meetings." };
  if (!access.subscribed && access.freeMeetingUsed) {
    return { ok: false, error: "Reading decisions out of minutes uses Stratasphere AI, which needs a subscription. You can still upload them under Documents." };
  }
  const parts = file.path.split("/");
  if (parts.length !== 3 || parts[0] !== access.corpId) return { ok: false, error: "That upload doesn't belong to this strata." };

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(file.path);
  if (error || !blob) return { ok: false, error: "The upload didn't finish. Please try again." };
  const extracted = await extractDocumentText(new Uint8Array(await blob.arrayBuffer()), file.name, file.type).catch(() => null);

  const discard = () => admin.storage.from(DOCUMENTS_BUCKET).remove([file.path]);
  if (!extracted || extracted.status === "unsupported") {
    await discard();
    return { ok: false, error: "Upload a PDF, Word (.docx) or text file." };
  }
  if (extracted.status === "needs_text") {
    await discard();
    return { ok: false, error: "That PDF has no text in it (it looks scanned). Upload a searchable copy." };
  }

  // The strata plan check, on our side.
  const found = [...extracted.text.matchAll(PLAN_RE)].map((m) => `${m[1].toUpperCase()}${m[2]}`);
  if (found.length === 0) {
    await discard();
    return { ok: false, error: `No strata plan number was found in that document, so it can't be confirmed as ${access.corpId}'s minutes.` };
  }
  if (!found.some((p) => norm(p) === norm(access.corpId))) {
    await discard();
    return { ok: false, error: `Those minutes are for ${found[0]}, not ${access.corpId}. Nothing was saved.` };
  }

  const ctx = await loadStripContext(admin, access.corpId);
  const stripped = stripForCorporation(extracted.text.slice(0, 120000), ctx);
  try {
    const result = await askClaudeJson<Omit<HistoricAnalysis, "planNumber">>({
      effort: "medium",
      maxTokens: 32000,
      system:
        "You read the minutes of a BC strata corporation's meeting and list every motion that was decided or deferred. " +
        "Use only what the minutes say. Movers and seconders appear as strata lot numbers (e.g. SL004) or placeholders; copy them exactly, or leave them empty. " +
        "Vote counts are digits or empty. The summary is one sentence on what was decided.",
      messages: [{ role: "user", content: `Minutes:\n\n${stripped}` }],
      schema: SCHEMA,
    });
    const decisions = (result.decisions ?? []).slice(0, 200).map((d) => ({
      ...d,
      mover: LOT.test(d.mover.trim()) ? d.mover.trim().toUpperCase().replace(/[\s-]/g, "") : "",
      seconder: LOT.test(d.seconder.trim()) ? d.seconder.trim().toUpperCase().replace(/[\s-]/g, "") : "",
      votesFor: /^\d+$/.test(d.votesFor) ? d.votesFor : "",
      votesAgainst: /^\d+$/.test(d.votesAgainst) ? d.votesAgainst : "",
      votesAbstain: /^\d+$/.test(d.votesAbstain) ? d.votesAbstain : "",
    }));
    return {
      ok: true,
      planNumber: access.corpId,
      meetingDate: /^\d{4}-\d{2}-\d{2}$/.test(result.meetingDate) ? result.meetingDate : "",
      meetingType: result.meetingType ?? "",
      decisions,
    };
  } catch (err) {
    console.error("[analyzeHistoricMinutes]", err instanceof Error ? err.message : err);
    await discard();
    return {
      ok: false,
      error: err instanceof ClaudeRefusalError ? "Stratasphere couldn't read those minutes." : "Couldn't read the decisions from those minutes. Please try again.",
    };
  }
}

/**
 * Keep the minutes: the file goes into the repository (indexed), and the
 * carried decisions the uploader kept go into the ledger.
 */
export async function saveHistoricMinutes(
  corpId: string,
  file: UploadedFile,
  meta: { meetingDate: string; meetingType: string },
  decisions: ExtractedDecision[]
): Promise<{ ok: true; recorded: number } | Fail> {
  // The demo has only its own materials (lib/demo.ts).
  if (IS_DEMO) return demoLimitFail();
  const access = await getStrataAccess(corpId);
  if (!access?.canRunMeetings) return { ok: false, error: "You can't add historic minutes." };
  if (meta.meetingDate && !/^\d{4}-\d{2}-\d{2}$/.test(meta.meetingDate)) return { ok: false, error: "Enter the meeting date as YYYY-MM-DD." };

  const registered = await registerUploadedDocuments(corpId, "meetings_records", [file], { sourceType: "historic_minutes" });
  if (!registered.ok) return registered;
  const documentId = registered.documentIds[0];

  const carried = decisions
    .filter((d) => d.outcome === "CARRIED" && d.title.trim())
    .map((d) => ({
      title: d.title.slice(0, 300),
      motion_text: d.motionText || d.summary,
      mover: d.mover,
      seconder: d.seconder,
      votes_for: d.votesFor,
      votes_against: d.votesAgainst,
      votes_abstain: d.votesAbstain,
      decided_on: meta.meetingDate,
      meeting_type: ["council", "agm", "sgm", "committee"].includes(meta.meetingType) ? meta.meetingType : "",
    }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_historic_decisions", {
    p_corporation_id: access.corpId,
    p_document_id: documentId,
    p_decisions: carried,
  });
  if (error) {
    console.error("[saveHistoricMinutes]", error.code, error.message);
    return { ok: false, error: "The minutes were saved, but their decisions couldn't be recorded. Try again from the Minutes tab." };
  }
  if (meta.meetingDate || meta.meetingType) {
    await retitleHistoricMinutes(documentId, meta);
  }
  revalidatePath(`/strata/${corpId}/minutes`);
  return { ok: true, recorded: Number(data) || 0 };
}

async function retitleHistoricMinutes(documentId: string, meta: { meetingDate: string; meetingType: string }) {
  const labels: Record<string, string> = { council: "Council meeting", agm: "AGM", sgm: "SGM", committee: "Committee meeting" };
  const label = labels[meta.meetingType] ?? "Meeting";
  await createAdminClient()
    .from("documents")
    .update({ title: `Minutes — ${label}${meta.meetingDate ? `, ${meta.meetingDate}` : ""}` })
    .eq("id", documentId);
}
