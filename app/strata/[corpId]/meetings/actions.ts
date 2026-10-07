"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrataAccess } from "@/lib/data/strata";
import {
  autoPopulate,
  decisionTypeLabels,
  ensureBookends,
  makeItem,
  meetingFormats,
  meetingTypes,
  newCategoryId,
  newMotion,
  normalizeAgenda,
  NEEDS_MOTION,
  resolutionTypes,
  type AgendaItem,
  meetingTypeLabels,
  type Attachment,
  type DecisionType,
  type MeetingType,
  type ResolutionType,
} from "@/lib/meetings/agenda";
import { registerUploadedDocuments, type UploadedFile } from "@/app/strata/[corpId]/documents/actions";
import { extractDocumentText } from "@/lib/kb/extract";
import { loadStripContext } from "@/lib/kb/privacy";
import { pseudonymize } from "@/lib/pii";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { isGeneralMeeting } from "@/lib/meetings/rules";
import { queueDocumentIndexing } from "@/lib/kb/queue";
import { DEMO_EDITABLE_ITEM_ID, IS_DEMO, demoLimitFail, lockDemoAgenda, type DemoLimitFail } from "@/lib/demo";
import { demoMeetingAgenda } from "@/lib/demo-kit/agenda";
import { logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";

/**
 * Meetings before they start (doc03 Stage 5a): create, edit details, build
 * the agenda, attach files and links, keep private notes, delete a draft,
 * launch. RLS (0014) is the gate for all of it — these actions only shape
 * input and report errors in plain language.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

async function runner(corpId: string) {
  const access = await getStrataAccess(corpId);
  if (!access) return null;
  if (!access.canRunMeetings) return null;
  return access;
}

function refresh(corpId: string, meetingId?: string) {
  revalidatePath(`/strata/${corpId}/meetings`);
  if (meetingId) revalidatePath(`/strata/${corpId}/meetings/${meetingId}`, "layout");
}

export interface MeetingDetailsInput {
  type: string;
  meetingDate: string;
  startTime: string;
  timezone: string;
  format: string;
  location: string;
  chairName: string;
}

function validateDetails(input: MeetingDetailsInput): string | null {
  if (!(meetingTypes as readonly string[]).includes(input.type)) return "Choose a meeting type.";
  if (!DATE_RE.test(input.meetingDate)) return "Choose a meeting date.";
  if (input.startTime && !TIME_RE.test(input.startTime)) return "Enter a valid start time.";
  if (!(meetingFormats as readonly string[]).includes(input.format)) return "Choose a format.";
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(input.timezone)) return "Choose a time zone.";
  if (input.location.length > 500 || input.chairName.length > 200) return "That's too long.";
  return null;
}

export async function createMeeting(corpId: string, input: MeetingDetailsInput): Promise<Ok<{ id: string }> | Fail | DemoLimitFail> {
  const access = await runner(corpId);
  if (!access) return { ok: false, error: "Only the secretary, the admin, or someone they've allowed can create meetings." };
  // The demo: one council meeting per visitor, its agenda already written.
  if (IS_DEMO) input = { ...input, type: "council" };
  const invalid = validateDetails(input);
  if (invalid) return { ok: false, error: invalid };
  if (IS_DEMO && !(await takeDemoAllowance("meetings"))) {
    await logDemoActivity({ kind: "limit", detail: { reason: "second meeting" } });
    return demoLimitFail();
  }

  const supabase = await createClient();
  // Blank means the chair is elected at the meeting (Meeting Mode).
  const chair = input.chairName.trim() || null;
  const { data, error } = await supabase
    .from("meetings")
    .insert({
      corporation_id: access.corpId,
      type: input.type,
      meeting_date: input.meetingDate,
      start_time: input.startTime || null,
      timezone: input.timezone,
      format: input.format,
      location: input.location.trim() || null,
      chair_name: chair,
      created_by: access.userId,
      ...(IS_DEMO ? { agenda: await demoMeetingAgenda(createAdminClient(), access.corpId) } : {}),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[createMeeting]", error?.code, error?.message);
    await refundDemoAllowance("meetings");
    return { ok: false, error: "Couldn't create the meeting. Please try again." };
  }
  await logDemoActivity({ kind: "meeting.created", detail: { meetingId: data.id, date: input.meetingDate, time: input.startTime } });
  refresh(corpId);
  return { ok: true, id: data.id };
}

export async function updateMeetingDetails(
  corpId: string,
  meetingId: string,
  input: MeetingDetailsInput
): Promise<Ok | Fail> {
  if (!(await runner(corpId))) return { ok: false, error: "You can't edit this meeting." };
  if (IS_DEMO) input = { ...input, type: "council" };
  const invalid = validateDetails(input);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .update({
      type: input.type,
      meeting_date: input.meetingDate,
      start_time: input.startTime || null,
      timezone: input.timezone,
      format: input.format,
      location: input.location.trim() || null,
      chair_name: input.chairName.trim() || null,
    })
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) {
    console.error("[updateMeetingDetails]", error.code, error.message);
    return { ok: false, error: "Couldn't save the meeting details." };
  }
  if (!data?.length) return { ok: false, error: "This meeting is being run by someone else, or its minutes are final." };
  refresh(corpId, meetingId);
  return { ok: true };
}

/** Clean an agenda coming back from the browser before it's stored. */
function sanitizeAgenda(raw: unknown): AgendaItem[] {
  const clip = (s: string, n: number) => s.slice(0, n);
  return normalizeAgenda(raw)
    .slice(0, 300)
    .map((it, i) => ({
      ...it,
      num: i + 1,
      text: clip(it.text, 300) || "Untitled item",
      cat: clip(it.cat, 120),
      background: clip(it.background, 20000),
      financial: clip(it.financial, 10000),
      risks: clip(it.risks, 10000),
      minutesSummary: clip(it.minutesSummary, 20000),
      motion: NEEDS_MOTION.includes(it.type) || it.motion ? (it.motion ?? newMotion()) : null,
      atts: (it.atts ?? []).slice(0, 50),
    }));
}

/**
 * Save the whole agenda. `expectedUpdatedAt` guards against two people
 * editing the same draft at once: if the meeting changed since this
 * editor loaded it, nothing is written and the editor is told to reload.
 */
export async function saveAgenda(
  corpId: string,
  meetingId: string,
  agenda: unknown,
  expectedUpdatedAt: string
): Promise<Ok<{ updatedAt: string }> | Fail> {
  if (!(await runner(corpId))) return { ok: false, error: "You can't edit this agenda." };
  const supabase = await createClient();
  let next = sanitizeAgenda(agenda);
  if (IS_DEMO) {
    const locked = await demoLockedAgenda(supabase, corpId, meetingId, next);
    if (!locked) return { ok: false, error: "Couldn't save the agenda." };
    next = locked;
  }
  const { data, error } = await supabase
    .from("meetings")
    .update({ agenda: ensureBookends(next) })
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at");
  if (error) {
    console.error("[saveAgenda]", error.code, error.message);
    return { ok: false, error: "Couldn't save the agenda." };
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "This agenda changed somewhere else since you opened it (or the meeting is being run by someone else). Reload to see the latest.",
    };
  }
  if (IS_DEMO) {
    const item = next.find((i) => i.id === DEMO_EDITABLE_ITEM_ID);
    await logDemoActivity({
      kind: "agenda.saved",
      detail: { meetingId, item: item?.text, type: item?.type, motion: item?.motion?.text ?? "", text: [item?.background, item?.financial, item?.risks].filter(Boolean).join("\n\n") },
    });
  }
  refresh(corpId, meetingId);
  return { ok: true, updatedAt: data[0].updated_at };
}

/**
 * The demo's agenda: only the one editable item (DEMO_EDITABLE_ITEM_ID)
 * takes what the browser sent; everything else stays as it was saved, in
 * the same order and category.
 */
async function demoLockedAgenda(
  supabase: Awaited<ReturnType<typeof createClient>>,
  corpId: string,
  meetingId: string,
  incoming: AgendaItem[]
): Promise<AgendaItem[] | null> {
  const { data } = await supabase.from("meetings").select("agenda").eq("id", meetingId).eq("corporation_id", corpId).maybeSingle();
  if (!data) return null;
  return lockDemoAgenda(normalizeAgenda(data.agenda), incoming);
}

export async function deleteMeeting(corpId: string, meetingId: string): Promise<Ok | Fail> {
  if (!(await runner(corpId))) return { ok: false, error: "You can't delete this meeting." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) {
    console.error("[deleteMeeting]", error.code, error.message);
    return { ok: false, error: "Couldn't delete the meeting." };
  }
  if (!data?.length) return { ok: false, error: "Only meetings that haven't been launched can be deleted." };
  await logDemoActivity({ kind: "meeting.deleted", detail: { meetingId } });
  refresh(corpId);
  return { ok: true };
}

/** Private note on one item (empty deletes it). */
export async function saveItemNote(corpId: string, meetingId: string, itemId: string, body: string): Promise<Ok | Fail> {
  const supabase = await createClient();
  const trimmed = body.slice(0, 5000);
  const { error } = trimmed.trim()
    ? await supabase
        .from("meeting_item_notes")
        .upsert({ meeting_id: meetingId, item_id: itemId, body: trimmed, updated_at: new Date().toISOString() })
    : await supabase.from("meeting_item_notes").delete().eq("meeting_id", meetingId).eq("item_id", itemId);
  if (error) {
    console.error("[saveItemNote]", error.code, error.message);
    return { ok: false, error: "Couldn't save the note." };
  }
  return { ok: true };
}

/**
 * Files attached to an agenda item: written to the repository's Agenda
 * Attachments folder (system-assigned, doc01 §4) and indexed like any
 * other document.
 */
export async function registerAgendaAttachments(
  corpId: string,
  meetingId: string,
  itemId: string,
  files: UploadedFile[]
): Promise<Ok<{ attachments: Attachment[] }> | Fail | DemoLimitFail> {
  if (IS_DEMO) return demoLimitFail();
  if (!(await runner(corpId))) return { ok: false, error: "You can't add attachments to this agenda." };
  const result = await registerUploadedDocuments(corpId, "agenda_attachments", files, {
    sourceType: "agenda_attachment",
    meetingId,
    agendaItemId: itemId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    attachments: result.documentIds.map((documentId, i) => ({
      id: `a_${documentId}`,
      kind: "document" as const,
      documentId,
      title: files[i].name,
    })),
  };
}

/**
 * A link attachment: stored as a document in Agenda Attachments and
 * fetched once in the background (with the link guard) so its content is
 * indexed for Stratasphere like any other attachment.
 */
export async function addLinkAttachment(
  corpId: string,
  meetingId: string,
  itemId: string,
  rawUrl: string,
  label: string
): Promise<Ok<{ attachment: Attachment }> | Fail | DemoLimitFail> {
  if (IS_DEMO) return demoLimitFail();
  const access = await runner(corpId);
  if (!access) return { ok: false, error: "You can't add attachments to this agenda." };
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "Enter a full link, starting with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only web links (http or https) can be attached." };
  const title = (label.trim() || url.hostname).slice(0, 300);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      corporation_id: access.corpId,
      category: "agenda_attachments",
      title,
      file_name: null,
      source_type: "link",
      url: url.toString(),
      uploaded_by: access.userId,
      meeting_id: meetingId,
      agenda_item_id: itemId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[addLinkAttachment]", error?.code, error?.message);
    return { ok: false, error: "Couldn't add that link." };
  }
  await queueDocumentIndexing([data.id]);
  revalidatePath(`/strata/${corpId}/documents`, "layout");
  return { ok: true, attachment: { id: `a_${data.id}`, kind: "link", documentId: data.id, url: url.toString(), title } };
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
  if (IS_DEMO) return demoLimitFail();
  const access = await runner(corpId);
  if (!access) return { ok: false, error: "You can't edit this agenda." };
  if (!access.subscribed && access.freeMeetingUsed) {
    return { ok: false, error: "Reading an uploaded agenda uses Stratasphere AI, which needs a subscription." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an agenda file." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "That file is over 10 MB." };

  const extracted = await extractDocumentText(new Uint8Array(await file.arrayBuffer()), file.name, file.type).catch(
    () => null
  );
  if (!extracted || extracted.status === "unsupported") return { ok: false, error: "Upload a PDF, Word (.docx) or text file." };
  if (extracted.status === "needs_text") {
    return { ok: false, error: "That PDF has no text in it (it looks scanned). Upload a searchable copy, or build the agenda by hand." };
  }
  if (extracted.text.trim().length < 20) return { ok: false, error: "That file looks empty." };

  const ctx = await loadStripContext(createAdminClient(), access.corpId);
  const p = pseudonymize(extracted.text.slice(0, 40000), ctx.people);

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

const MOTION_SCHEMA = {
  type: "object",
  properties: { motionText: { type: "string" } },
  required: ["motionText"],
  additionalProperties: false,
};

/**
 * Draft motion wording for a custom agenda item. Only the item's own text
 * goes out, with names and other personal details swapped for numbered
 * references first and swapped back in the reply. The draft lands in the
 * editable motion field; nothing is saved until the item is.
 */
export async function draftMotion(
  corpId: string,
  meetingId: string,
  input: { text: string; background: string; financial: string; risks: string; decisionType: DecisionType }
): Promise<Ok<{ motionText: string }> | Fail | DemoLimitFail> {
  const access = await runner(corpId);
  if (!access) return { ok: false, error: "You can't edit this agenda." };
  if (!access.subscribed && access.freeMeetingUsed) {
    return { ok: false, error: "Drafting a motion uses Stratasphere AI, which needs a subscription." };
  }
  if (!input.text.trim()) return { ok: false, error: "Give the item a title first." };
  if (IS_DEMO && !(await takeDemoAllowance("motions"))) {
    await logDemoActivity({ kind: "limit", detail: { reason: "motion drafts" } });
    return demoLimitFail();
  }

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("type")
    .eq("id", meetingId)
    .eq("corporation_id", access.corpId)
    .maybeSingle();
  const meetingLabel = meeting ? meetingTypeLabels[meeting.type as MeetingType] : "meeting";

  const ctx = await loadStripContext(createAdminClient(), access.corpId);
  const p = pseudonymize(
    [
      `Agenda item: ${input.text.slice(0, 500)}`,
      input.background.trim() && `Background: ${input.background.slice(0, 4000)}`,
      input.financial.trim() && `Financial implications: ${input.financial.slice(0, 2000)}`,
      input.risks.trim() && `Risks / compliance: ${input.risks.slice(0, 2000)}`,
      `Decision type: ${decisionTypeLabels[input.decisionType]}`,
    ]
      .filter(Boolean)
      .join("\n"),
    ctx.people
  );

  try {
    const out = await askClaudeJson<{ motionText: string }>({
      effort: "low",
      maxTokens: 1000,
      system:
        `You draft motions for a BC strata corporation's ${meetingLabel}, in the form minutes record them. ` +
        "Write one motion as a single sentence starting with \"THAT\" (or \"BE IT RESOLVED by a 3/4 vote of the owners that\" for a 3/4 resolution, and the matching wording for 80% or unanimous resolutions). " +
        "Be specific to the item, use plain language, and cite the Strata Property Act only where the item clearly calls for it. " +
        "Placeholders like [REF-3] stand for names and other details; copy them exactly. Use [square brackets] for anything the item doesn't say, such as an amount or date. " +
        "Never invent facts.",
      messages: [{ role: "user", content: p.text }],
      schema: MOTION_SCHEMA,
    });
    const motionText = p.restore(out.motionText ?? "").trim();
    if (!motionText) {
      await refundDemoAllowance("motions");
      return { ok: false, error: "Stratasphere couldn't draft a motion for that item. Write it by hand." };
    }
    await logDemoActivity({ kind: "motion.drafted", detail: { item: input.text, motion: motionText } });
    return { ok: true, motionText };
  } catch (err) {
    console.error("[draftMotion]", err instanceof Error ? err.message : err);
    await refundDemoAllowance("motions");
    return {
      ok: false,
      error:
        err instanceof ClaudeRefusalError
          ? "Stratasphere couldn't draft a motion for that item. Write it by hand."
          : "Couldn't draft a motion. Try again, or write it by hand.",
    };
  }
}

export async function launchMeeting(
  corpId: string,
  meetingId: string
): Promise<Ok<{ result: string }> | Fail & { subscriptionRequired?: boolean }> {
  const supabase = await createClient();
  // Council and committee meetings take attendance and quorum from the
  // council lots, so there must be some.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("type")
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (meeting && !isGeneralMeeting(meeting.type as MeetingType)) {
    const { count } = await supabase
      .from("owners_and_council")
      .select("lot_number", { count: "exact", head: true })
      .eq("corporation_id", corpId)
      .eq("is_council_member", true);
    if (!count) {
      return {
        ok: false,
        error:
          "No council members are tied to a strata lot yet. On Council, set each council member's strata lot, then launch.",
      };
    }
  }
  const { data, error } = await supabase.rpc("launch_meeting", { p_meeting_id: meetingId });
  if (error) {
    const subscriptionRequired = error.hint === "subscription_required";
    const known =
      subscriptionRequired ||
      /already being run|already been adjourned|Build the agenda/.test(error.message);
    if (!known) console.error("[launchMeeting]", error.code, error.message);
    return { ok: false, error: known ? error.message : "Couldn't launch the meeting.", subscriptionRequired };
  }
  await logDemoActivity({ kind: "meeting.launched", detail: { meetingId } });
  refresh(corpId, meetingId);
  return { ok: true, result: data as string };
}
