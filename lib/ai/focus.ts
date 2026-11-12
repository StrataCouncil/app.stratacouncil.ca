import type { SupabaseClient } from "@supabase/supabase-js";
import { meetingTypeLabels, normalizeAgenda, type AgendaItem, type MeetingType } from "@/lib/meetings/agenda";
import type { FocusRef, SavedFocus } from "@/lib/stratasphere-focus";

/**
 * The record a person is looking at, read again on the server with their
 * own access (RLS, through their own client), for Stratasphere (PR 4a).
 * Null when they couldn't open it themselves: a meeting of another strata,
 * a document they can't see, or a discussion that isn't a decision yet.
 * Nothing from the browser is trusted but the reference.
 */
export type ResolvedFocus =
  | { ref: FocusRef; label: string; kind: "meeting"; meetingLabel: string; date: string; agenda: AgendaItem[] }
  | { ref: FocusRef; label: string; kind: "agenda_item"; meetingLabel: string; date: string; item: AgendaItem }
  | {
      ref: FocusRef;
      label: string;
      kind: "document";
      documentId: string;
      title: string;
      uploadedAt: string;
      indexingStatus: string;
      text: string | null;
    }
  | {
      ref: FocusRef;
      label: string;
      kind: "discussion";
      title: string;
      motion: string;
      closedAt: string;
      votes: { for: number; against: number; abstain: number };
    };

/** "2026-11-12" -> "Nov 12, 2026" (a date, not a moment: no time zone shift). */
export function shortDate(iso: string) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export async function resolveFocus(supabase: SupabaseClient, corpId: string, ref: FocusRef): Promise<ResolvedFocus | null> {
  if (ref.kind === "meeting" || ref.kind === "agenda_item") {
    const { data: m } = await supabase
      .from("meetings")
      .select("id, type, meeting_date, agenda")
      .eq("corporation_id", corpId)
      .eq("id", ref.meetingId)
      .maybeSingle();
    if (!m) return null;
    const meetingLabel = meetingTypeLabels[m.type as MeetingType] ?? "Meeting";
    const date = shortDate(m.meeting_date as string);
    const agenda = normalizeAgenda(m.agenda);
    if (ref.kind === "meeting") {
      return { ref, label: `${meetingLabel}, ${date}`, kind: "meeting", meetingLabel, date, agenda };
    }
    const item = agenda.find((i) => i.id === ref.itemId);
    if (!item) return null;
    return { ref, label: `${meetingLabel}, ${date}: ${item.text}`, kind: "agenda_item", meetingLabel, date, item };
  }
  if (ref.kind === "document") {
    const { data: d } = await supabase
      .from("documents")
      .select("id, title, uploaded_at, indexing_status, document_text")
      .eq("corporation_id", corpId)
      .eq("id", ref.documentId)
      .maybeSingle();
    if (!d) return null;
    const title = (d.title as string) || "Document";
    return {
      ref,
      label: title,
      kind: "document",
      documentId: d.id as string,
      title,
      uploadedAt: String(d.uploaded_at ?? "").slice(0, 10),
      indexingStatus: (d.indexing_status as string) ?? "",
      text: d.indexing_status === "indexed" ? ((d.document_text as string | null) ?? null) : null,
    };
  }
  // A discussion is a decision only once it's closed with its motion carried
  // (awaiting ratification). Open ones, and those that didn't carry, are
  // never sent. Read through the person's own access (council, or those
  // who run meetings); the comments and who voted which way never are.
  const { data: x } = await supabase
    .from("discussions")
    .select("id, title, motion, status, result, vote_required, closed_at, votes_for, votes_against, votes_abstain")
    .eq("corporation_id", corpId)
    .eq("id", ref.discussionId)
    .maybeSingle();
  if (!x || x.status !== "closed" || x.result !== "supported" || !x.vote_required) return null;
  return {
    ref,
    label: `Discussion: ${x.title as string}`,
    kind: "discussion",
    title: x.title as string,
    motion: (x.motion as string) ?? "",
    closedAt: String(x.closed_at ?? "").slice(0, 10),
    votes: { for: (x.votes_for as number) ?? 0, against: (x.votes_against as number) ?? 0, abstain: (x.votes_abstain as number) ?? 0 },
  };
}

/** What's saved with the question: the reference and its label, never record text. */
export function savedFocus(f: ResolvedFocus): SavedFocus {
  return { ...f.ref, label: f.label.slice(0, 300) };
}
