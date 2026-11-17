import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeText, ClaudeRefusalError, streamClaudeText } from "@/lib/ai/claude";
import { estimateCostUsd, type TokenUsage } from "@/lib/ai/pricing";
import { loadStripContext, stripForCorporation, type StripContext } from "@/lib/kb/privacy";
import { searchKeywords, searchKnowledge, type KnowledgeHit } from "@/lib/kb/search";
import { exactStrings, lineScore, mergeHits, searchWords } from "@/lib/kb/keywords";
import { buildStrataProfile, type ProfileMeeting } from "@/lib/ai/strata-profile";
import { arrangePassages, passagesText } from "@/lib/kb/passages";
import { ledgerLine } from "@/lib/ai/ledger-line";
import { sourcesFromCitations, untagContext, type CitedRecord } from "@/lib/ai/citations";
import { answerCleaner, citedTags, cleanAnswer } from "@/lib/ai/answer-text";
import { listPublishedLibrary } from "@/lib/data/library";
import { knowledgeResourceKindLabels } from "@/lib/library/catalogue";
import { meetingFormatLabels, meetingTypeLabels, type MeetingFormat, type MeetingType } from "@/lib/meetings/agenda";
import type { AgendaItem } from "@/lib/meetings/agenda";
import type { ResolvedFocus } from "@/lib/ai/focus";
import { clockTime } from "@/lib/meetings/minutes";
import { HOURLY_LIMIT, nextAskAt } from "@/lib/ai/hourly-limit";
import { calculatorTool } from "@/lib/ai/calculator-tool";
import type { ClientTool } from "@/lib/ai/claude";
import { tz } from "@/lib/time-zone";

/**
 * Stratasphere, the AI governance assistant (doc02 §3–§5). One system for
 * both surfaces: the standalone assistant, and Meeting Mode's, which adds
 * the current item's attachments and this session's decisions.
 *
 * Everything that leaves for Voyage or Anthropic — the question, the
 * conversation so far, attachment text, ledger entries, excerpts — has
 * been through the PII stripper first. Excerpts are stored stripped;
 * everything else is stripped here.
 */

const CARDINAL_RULES = `ANSWER THE QUESTION THAT IS ASKED: Before answering, work out exactly what is being asked: the period (which fiscal year, which months, as of when), the scope (which lot, policy, fund, or decision), and the basis (charged, accrued, budgeted, or paid; one figure or a total). Then answer that question in the first sentence, with the figure or the fact itself. The working and the sources follow. Never substitute an easier or nearby question, never answer only part of it, and never stop short of the final figure when the records hold what's needed to reach it. If the question can reasonably be read two ways and the readings give different answers (for example, FY27 could mean the year ending in 2027 or the year starting in 2027), give both answers, each with the reading it rests on, rather than asking first. Raise an ambiguity only when the readings actually differ.

CALCULATION RULE: Never do arithmetic or count days or months in your head. Every sum, difference, share, proration, percentage, average, and count of days or months goes through the calculate tool, with each figure taken from the records and its source named in the step's label. In the answer, show the working: each figure with its source, each step, and the result exactly as the tool gave it, and state the basis (for example, "the premium charged to this fiscal year, spread evenly by month" or "the instalments paid in this fiscal year"). If a figure the calculation needs isn't in the records, say which one is missing and don't calculate around it. Dates in the records are the source for periods: a policy term, a fiscal year, a financing schedule.

FISCAL YEAR: The strata's fiscal year is in the platform records (STRATA CORPORATION). If it isn't set there and the question depends on it, use the fiscal year the financial statements or budget in the records show, and say where you found it; if they don't show it, say the fiscal year isn't set and that the strata's Admin can add it with Edit details on the Overview, then answer for the reading you think most likely and say which one you used. "This fiscal year" is the one that includes today's date, given with each question.

FABRICATION IS PROHIBITED: Never invent, estimate, extrapolate, or assume any corporation-specific fact — names, lot numbers, dollar amounts, dates, vote counts, bylaw sections, motion text, or any other data. If it is not in the context provided, it does not exist for the purpose of this answer.

WHEN DATA IS MISSING: If the answer isn't present in any context block, say so clearly in one sentence — do not apologize at length, do not fill the gap with general knowledge — then give one concrete direction for where the answer may be found: the specific document type to look in (for example the registered bylaws, the most recent AGM minutes, the depreciation report), the person to ask (the strata manager, council's secretary or treasurer), or, for questions of law, the Act and section to read or a lawyer, the Civil Resolution Tribunal, or the Condominium Home Owners Association of BC.

NO INTERNET: No access to external websites, databases, news sources, or search engines. Never reference, cite, or imply an external source, and never suggest the user "check online."

STANDARD BYLAWS: The Standard Bylaws in the Strata Property Act's schedule apply to a corporation only where it has not filed its own bylaw on that subject. Never present a Standard Bylaw as this corporation's bylaw. If this corporation's own bylaws on the subject aren't in the context, say so, and say the Standard Bylaw would apply only if the corporation hasn't replaced it.

LEGISLATION IS PERMITTED, ADVICE IS NOT: May explain what legislation says, but only from the LEGISLATION EXCERPTS in the context, citing the Act and section. Never state what an Act says from memory: if no excerpt covers it, say the Knowledge Base doesn't include it and name the Act to read. May not advise the corporation on what it should do legally. Always label legislative information as general context, not corporation-specific guidance.

NO OPINIONS: Report what the sources say. Never offer opinions, judgments, predictions, or recommendations on what anyone should do, and never speculate about why something happened.

CITE YOUR SOURCE: Every fact and figure is followed by the tag of each record it comes from, in square brackets: [D2], or [L1, E14] for more than one. Every record sent is tagged: D a document's passages, B the bylaws, A an agenda item's attachment, F the record the person is looking at, E and W decisions in the ledger, M decisions made so far in this meeting, L a Knowledge Base section (Acts, regulations, guidance), P precedent from other stratas, R the platform records, T a directive (follow-up council decided on). Cite only the records you actually used, and only tags given with this question or with the standing records; a record shown with an earlier question has no tag now, so name it in words. The tags are taken out before the person reads the answer and become its list of sources, so the text must read well without them. Still name an Act's section, a document, or a decision in words where the reader needs it (for example "Strata Property Regulation section 6.21(4)"). If a source can't be cited, the claim can't be made.

IF YOU DON'T KNOW, SAY SO PRECISELY: If nothing in the context answers the question, say what you looked through and that you don't see it there, for example: "I don't see this in {CORP}'s bylaws, decision ledger, documents and minutes on file, or BC strata legislation." Never say "there is no record" or that something never happened or doesn't exist: say only that you don't see it in what you looked through. If the DOCUMENTS ON FILE list marks a document as not read or not readable and it could hold the answer (judge by its title and folder), name it: "There's a document called [title] on file that I couldn't read." Then give one concrete direction: the specific document type to check, or the strata manager. If only cross-platform precedent is relevant, answer from it and label it unmistakably as precedent from other strata corporations, never as this corporation's own data. For anything out of scope, say: "I can only answer questions about {CORP}'s own records and BC strata legislation. I'm not able to [look that up online / advise on what you should do legally / access another corporation's records]." Cross-platform precedent is not "another corporation's records": it is anonymized and included by design.

RECENCY RULE: When multiple documents or decisions address the same topic, treat the most recently uploaded one as the most authoritative — documents are sorted with the most recent first and their upload date is stamped in the content header. For financial statements, always use the most recently uploaded version for current figures while referencing older statements for trends or year-over-year context. For bylaws or policies, the most recently uploaded version governs. Acknowledge older records where relevant but base your answer on the most recent.

COUNTING AND ENUMERATION RULE: When any question requires counting, filtering, or summing data — roster entries, decisions, meetings, documents, votes, fees, or any other records — you must work through every single entry systematically before giving a final answer. List each matching entry explicitly, then state the total, summing amounts with the calculate tool. Never give a count or sum without showing the entries you counted. If you find yourself uncertain about a count, recount from the beginning. A wrong number with confidence is worse than a correct number with visible working.

CONFLICT DISCLOSURE RULE: If sources disagree — a corporation's bylaws say one thing while BC legislation, global precedent, or another local document says another — do not silently pick one or reconcile them yourself. State plainly what each source says and that they conflict. For example: "Your bylaws state [X]. The Strata Property Act states [Y]. These appear to conflict." Do not resolve which one governs, do not soften the discrepancy, and do not guess at an explanation. Report only what each source explicitly states.

EARLIER ANSWERS RULE: The records found for each earlier question in this conversation travel with that question, and they remain valid sources for this answer. Never retract, correct or apologize for an earlier answer unless something in the context actually contradicts it, and then say exactly what. If a question refers to something from earlier in the conversation that is no longer available to you, say so and offer to look it up again. Answer the question that was asked.

DISPUTED-FACT RULE: If a user says a cited fact is wrong, do not concede the point or change the answer — you have no way to independently verify a claim made in conversation. State exactly which document, section, and upload date the fact came from, and note that an updated version of that document can be uploaded if it's outdated or incorrect. Never revise a factual claim based on a user's assertion alone; only a new document in context can change what you cite.`;

const PERMITTED = `PERMITTED KNOWLEDGE: Only what is in the context blocks below: this corporation's live records on StrataCouncil.ca (its owner roster, council, meetings and agendas, the list of documents on file, its management company, platform announcements and the Library), its documents and minutes, its decision ledger, its directives (the follow-up council decided on, and whether each is open, done, or cancelled), the legislation excerpts, and anonymized precedent from other strata corporations on the platform. The platform records are current as of this question: use them for counts and lists (lots, owners, council, meetings, documents), and say they come from the platform's records. Precedent is always framed explicitly as cross-platform precedent, never presented as if it were this corporation's own data. General knowledge may be used only to read and understand those sources (plain meaning of words), never as a source of facts. Arithmetic is done with the calculate tool.

PIPA: Refer to owners who are people by strata lot number only (e.g. SL061), never by name. Text in the context has already had names and personal details replaced with lot numbers or placeholders such as [name redacted]; never try to guess what a placeholder stands for. Owners are never named on the roster, whether people or companies: an "Owner A" or "Company A" code marks the lots one owner holds. Use the codes to count and group lots, and never guess who an owner is. If asked who owns a lot, say the platform doesn't share owners' names and point to the roster in the app.

FORMAT: Plain text, as a careful person would write it. The first paragraph is the answer itself. Then short paragraphs, separated by a blank line. No markdown or other markup of any kind: no asterisks, no pound signs, no headings, no bold, no bullet dashes. No emoji. No preamble, no sign-off, no unsolicited recommendations. When working or a list is genuinely needed, number the lines "1." "2." "3.", one per line.`;

const MAX_CONTEXT_CHARS = 400_000;
const MAX_ATTACHMENT_CHARS = 150_000;
const SEARCH_TIMEOUT_MS = 10_000;

/**
 * One turn of history. `context` is what a user turn was answered from (the
 * excerpts, already stripped), replayed so the conversation keeps its
 * sources; `sources` names what an assistant turn cited.
 */
export type AssistantTurn = { role: "user" | "assistant"; content: string; sources?: string[]; context?: string | null };

export interface MeetingScope {
  item: AgendaItem;
  agenda: AgendaItem[];
  meetingLabel: string;
}

/** What an answer drew on, shown under it. Titles are as stored (stripped). */
export type StratasphereSource =
  | { kind: "document"; title: string; documentId: string }
  | { kind: "decisions" }
  | { kind: "directives" }
  | { kind: "precedent" }
  | { kind: "legislation"; title: string };

export type AskResult =
  | { ok: true; text: string; sources: StratasphereSource[]; /** What this question was answered from, to store with it. */ context: string }
  | { ok: false; error: string; limit?: boolean };

type Prepared =
  | {
      ok: true;
      system: Anthropic.Beta.BetaTextBlockParam[];
      messages: Anthropic.Beta.BetaMessageParam[];
      turnContext: string;
      effort: "low" | "medium";
      maxTokens: number;
      /** Tools Claude may call while answering (the calculator). */
      tools: ClientTool[];
      /** What each citation tag stands for (lib/ai/citations.ts). */
      records: CitedRecord[];
      sources: StratasphereSource[];
      /** The full bylaws given as context: listed as sources only when the answer draws on them. */
      bylawSources: StratasphereSource[];
      /** What reached the model, for the recall check (lib/ai/recall.ts). */
      diagnostics: ContextDiagnostics;
    }
  | { ok: false; error: string; limit?: boolean };

export interface ContextSizes {
  /** The instructions. */
  rules: number;
  bylaws: number;
  ledger: number;
  /** The platform records (roster, meetings, documents on file, and so on). */
  platform: number;
  /** Earlier questions and answers, with the records found for them. */
  history: number;
  /** The strata's document passages found for this question. */
  passages: number;
  precedent: number;
  legislation: number;
  /** Everything else sent with this question (attachments, the record being looked at, older decisions, notes). */
  otherForQuestion: number;
  total: number;
  /** Characters not sent because neighbouring passages were joined and identical copies sent once. */
  savedByJoining: number;
}

/** Which records a request carried: read by the recall check, never by the model. */
export interface ContextDiagnostics {
  bylawDocumentIds: string[];
  attachmentDocumentIds: string[];
  ledgerDecisionIds: string[];
  /** Search results in the order they were given, with their scores. */
  hits: Array<{ id: string; scope: KnowledgeHit["scope"]; documentId: string | null; title: string | null; similarity: number }>;
  /** Characters sent, by part, so the cost of each part can be seen. */
  sizes?: ContextSizes;
  searchFailed: boolean;
}

/** Chips show each document's real title (what's sent to the AI is stripped; what members see isn't). */
function sourcesFrom(hits: KnowledgeHit[], hasLedger: boolean, titles: Map<string, string>): StratasphereSource[] {
  const out: StratasphereSource[] = [];
  const seenDocs = new Set<string>();
  for (const h of hits) {
    if (h.scope === "corporation" && h.documentId && !seenDocs.has(h.documentId)) {
      seenDocs.add(h.documentId);
      out.push({ kind: "document", title: titles.get(h.documentId) || h.title || "Untitled document", documentId: h.documentId });
    }
  }
  // One chip per Act, naming the sections drawn on: "Strata Property Act, s. 45, 46".
  const acts = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.scope !== "legislation") continue;
    const act = h.sourceAct || h.title || "BC legislation";
    if (!acts.has(act)) acts.set(act, new Set());
    const m = /^(?:s\. (\S+)|(Form \S+)|(Standard Bylaw \S+))/.exec(h.title ?? "");
    if (m) acts.get(act)!.add(m[1] ? `s. ${m[1]}` : (m[2] ?? m[3]));
  }
  for (const [act, refs] of acts) {
    const list = [...refs].sort((a, b) => {
      const na = parseFloat(a.slice(3));
      const nb = parseFloat(b.slice(3));
      return (Number.isNaN(na) ? 1e9 : na) - (Number.isNaN(nb) ? 1e9 : nb) || a.localeCompare(b, "en", { numeric: true });
    });
    const shown = list.length > 6 ? `${list.slice(0, 6).join(", ")} and ${list.length - 6} more` : list.join(", ");
    out.push({ kind: "legislation", title: list.length ? `${act}, ${shown}` : act });
  }
  if (hits.some((h) => h.scope === "global_precedent")) out.push({ kind: "precedent" });
  if (hasLedger) out.push({ kind: "decisions" });
  return out.slice(0, 12);
}

async function documentTitles(supabase: SupabaseClient, corpId: string, hits: KnowledgeHit[]) {
  const ids = [...new Set(hits.flatMap((h) => (h.scope === "corporation" && h.documentId ? [h.documentId] : [])))];
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabase.from("documents").select("id, title").eq("corporation_id", corpId).in("id", ids);
  return new Map((data ?? []).flatMap((d) => (d.title ? [[d.id as string, d.title as string] as const] : [])));
}

function block(title: string, body: string) {
  return body.trim() ? `=== ${title} ===\n${body.trim()}\n` : "";
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function attachmentsBlock(supabase: SupabaseClient, corpId: string, item: AgendaItem, ctx: StripContext) {
  const ids = item.atts.map((a) => a.documentId).filter((x): x is string => Boolean(x));
  const disclosures: string[] = [];
  const read: string[] = [];
  /** Sent in full: their search passages would only repeat them. */
  const whole: string[] = [];
  const records: CitedRecord[] = [];
  if (!ids.length) return { text: "", disclosures, read, whole, records };
  const { data } = await supabase
    .from("documents")
    .select("id, title, source_type, url, indexing_status, document_text, uploaded_at")
    .eq("corporation_id", corpId)
    .in("id", ids);
  let budget = MAX_ATTACHMENT_CHARS;
  const parts: string[] = [];
  // Largest last, so when the budget runs out it's the largest that's cut.
  const docs = [...(data ?? [])].sort((a, b) => (a.document_text?.length ?? 0) - (b.document_text?.length ?? 0));
  for (const d of docs) {
    const title = stripForCorporation(d.title ?? "Attachment", ctx);
    if (d.indexing_status === "indexed" && d.document_text) {
      // Counted as read only if some of its text fits (the recall check).
      if (budget > 0) read.push(d.id as string);
      let text = stripForCorporation(d.document_text, ctx);
      if (text.length > budget) {
        text = `${text.slice(0, Math.max(0, budget))}\n[...truncated]`;
        disclosures.push(
          unreadPart(title, budget > 0 ? "the end of it wasn't read: the attachments are longer than can be read at once" : "none of it was read: the other attachments filled the space")
        );
      } else {
        whole.push(d.id as string);
      }
      budget -= text.length;
      const tag = `A${records.length + 1}`;
      records.push({ tag, kind: "attachment", title: d.title || "Attachment", documentId: d.id as string, excerpt: text.slice(0, 4000) });
      parts.push(`[${tag} ATTACHMENT: ${title}, added ${String(d.uploaded_at).slice(0, 10)}]\n${text}\n[END ATTACHMENT]`);
    } else if (d.indexing_status === "pending" || d.indexing_status === "processing") {
      disclosures.push(`The attachment "${title}" is still being processed and is not yet searchable. Say so before answering if it matters.`);
    } else if (d.source_type === "link") {
      disclosures.push(`This item has a link attachment ("${title}") whose page couldn't be read. If the question is about it, say you can't access that page and the user should refer to the link directly.`);
    } else {
      disclosures.push(`The attachment "${title}" couldn't be read (it may be an image or a scanned document with no text). Say so if the question is about it.`);
    }
  }
  return { text: parts.join("\n\n"), disclosures, read, whole, records };
}

const MAX_BYLAWS_CHARS = 150_000;

/** A required disclosure when part of a record wasn't read (PR 5, §7 gap 4). */
function unreadPart(title: string, what: string) {
  return `Part of "${title}" wasn't read (${what}). If the answer could be in the part that wasn't read, say so: "Part of '${title}' wasn't read."`;
}

/**
 * The strata's current bylaws, in full, on every question. Bylaw questions
 * are the most common and often worded nothing like the bylaw that answers
 * them ("can managers leave flyers?" vs "hallways are for ingress and
 * egress only"), so they're read, not just searched. Most recent first.
 */
async function bylawsBlock(supabase: SupabaseClient, corpId: string, ctx: StripContext) {
  const { data } = await supabase
    .from("documents")
    .select("id, title, uploaded_at, document_text, content_sha256")
    .eq("corporation_id", corpId)
    .eq("indexing_status", "indexed")
    .eq("is_current", true)
    .or("doc_type.eq.bylaws,title.ilike.%bylaw%")
    .order("uploaded_at", { ascending: false })
    .limit(4);
  let budget = MAX_BYLAWS_CHARS;
  const parts: string[] = [];
  const sources: StratasphereSource[] = [];
  const disclosures: string[] = [];
  const whole: string[] = [];
  const records: CitedRecord[] = [];
  // The same file on record twice is read once (documents.content_sha256, 0065).
  const seen = new Map<string, number>();
  for (const d of data ?? []) {
    if (!d.document_text) continue;
    const title = stripForCorporation(d.title ?? "Bylaws", ctx);
    const fingerprint = (d.content_sha256 as string | null) ?? null;
    if (fingerprint && seen.has(fingerprint)) {
      const at = seen.get(fingerprint)!;
      parts[at] = parts[at].replace(/^\[(B\d+) BYLAWS: ([^\]\n]*)\]/, (_m, tag: string, head: string) => `[${tag} BYLAWS: ${head}; identical copy also filed as "${title}"]`);
      whole.push(d.id as string);
      continue;
    }
    if (budget <= 0) {
      disclosures.push(unreadPart(title, "none of it was read: the bylaws before it filled the space"));
      continue;
    }
    let text = stripForCorporation(d.document_text, ctx);
    if (text.length > budget) {
      text = `${text.slice(0, budget)}\n[...truncated]`;
      disclosures.push(unreadPart(title, "the end of it wasn't read: it's longer than can be read at once"));
    } else {
      whole.push(d.id as string);
    }
    budget -= text.length;
    if (fingerprint) seen.set(fingerprint, parts.length);
    const tag = `B${parts.length + 1}`;
    parts.push(`[${tag} BYLAWS: ${title}, uploaded ${String(d.uploaded_at).slice(0, 10)}]\n${text}\n[END BYLAWS]`);
    sources.push({ kind: "document", title: d.title || "Bylaws", documentId: d.id });
    records.push({ tag, kind: "bylaws", title: d.title || "Bylaws", documentId: d.id as string });
  }
  return { text: parts.join("\n\n"), sources, disclosures, whole, records };
}

const MAX_PROFILE_CHARS = 80000;

/**
 * Everything the asking member can see about their strata on the platform
 * (lib/ai/strata-profile.ts): roster, council, meetings and agendas, the
 * documents on file, management, announcements and the Library. Read with
 * the member's own access (RLS), so it never holds more than they could open
 * themselves. Members' chats, Council Training and billing stay private.
 */
async function profileBlock(supabase: SupabaseClient, corpId: string, ctx: StripContext) {
  const [corp, mgmt, lots, roles, members, meetings, docs, announcements, library] = await Promise.all([
    supabase.from("strata_corporations").select("strata_plan_number, legal_name, building_name, address, unit_count, jurisdiction, fiscal_year_start_month").eq("strata_plan_number", corpId).maybeSingle(),
    supabase.from("strata_management").select("company_name, website, managers").eq("corporation_id", corpId).maybeSingle(),
    supabase
      .from("owners_and_council")
      .select("lot_number, unit_number, unit_entitlement, owner_type, full_name, parking, storage, bike_rack, strata_fees, is_council_member, role")
      .eq("corporation_id", corpId)
      .order("lot_number"),
    supabase.from("corporation_role_assignments").select("role").eq("corporation_id", corpId),
    supabase.from("corporation_memberships").select("status").eq("corporation_id", corpId),
    supabase
      .from("meetings")
      .select("meeting_date, type, status, format, location, chair_name, agenda, attendance, minutes_state, is_trial")
      .eq("corporation_id", corpId)
      .order("meeting_date", { ascending: false })
      .limit(40),
    supabase
      .from("documents")
      .select("title, category, uploaded_at, is_current, indexing_status")
      .eq("corporation_id", corpId)
      .order("uploaded_at", { ascending: false })
      .limit(400),
    supabase.from("announcements").select("title, body, published_at, expires_at").order("published_at", { ascending: false }).limit(10),
    listPublishedLibrary().catch(() => []),
  ]);
  for (const [name, r] of Object.entries({ corp, mgmt, lots, roles, members, meetings, docs, announcements })) {
    if (r.error) console.error(`[askStratasphere] profile ${name}`, r.error.message);
  }
  if (!corp.data) return "";
  const count = (rows: Array<{ [k: string]: unknown }> | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return m;
  };
  const roleCounts = count(roles.data, "role");
  const memberCounts = count(members.data, "status");
  const now = Date.now();

  const text = buildStrataProfile(
    {
      corp: {
        planNumber: corp.data.strata_plan_number,
        legalName: corp.data.legal_name,
        buildingName: corp.data.building_name,
        address: corp.data.address,
        unitCount: corp.data.unit_count,
        jurisdiction: corp.data.jurisdiction,
        fiscalYearStartMonth: corp.data.fiscal_year_start_month ?? null,
      },
      management: mgmt.data
        ? { company: mgmt.data.company_name, website: mgmt.data.website, managers: Array.isArray(mgmt.data.managers) ? mgmt.data.managers.length : 0 }
        : null,
      lots: (lots.data ?? []).map((l) => ({
        lot: l.lot_number,
        unit: l.unit_number,
        entitlement: l.unit_entitlement,
        ownerType: l.owner_type,
        ownerName: l.full_name,
        parking: l.parking,
        storage: l.storage,
        bikeRack: l.bike_rack,
        fees: l.strata_fees,
        isCouncil: Boolean(l.is_council_member),
        role: l.role,
      })),
      platformRoles: [...roleCounts].map(([role, n]) => ({ role, count: n })),
      members: { active: memberCounts.get("active") ?? 0, invited: memberCounts.get("invited") ?? 0 },
      meetings: (meetings.data ?? []).map((m): ProfileMeeting => {
        const agenda = (Array.isArray(m.agenda) ? m.agenda : []) as AgendaItem[];
        const attendance = (m.attendance ?? {}) as Record<string, string>;
        return {
          date: String(m.meeting_date),
          type: meetingTypeLabels[m.type as MeetingType] ?? m.type,
          status: m.status,
          format: meetingFormatLabels[m.format as MeetingFormat] ?? m.format,
          minutesState: m.minutes_state,
          trial: Boolean(m.is_trial),
          location: m.location,
          chair: m.chair_name,
          presentLots: Object.values(attendance).filter((v) => v === "present" || v === "proxy").length,
          agenda: agenda.map((it) => ({
            num: it.num,
            cat: it.cat ?? "",
            text: it.text ?? "",
            type: String(it.type ?? ""),
            done: Boolean(it.done),
            deferred: Boolean(it.deferred),
            outcome: it.motion?.outcome ?? null,
          })),
        };
      }),
      documents: (docs.data ?? []).map((d) => ({
        title: d.title ?? "Untitled",
        category: d.category,
        uploadedAt: String(d.uploaded_at),
        current: d.is_current !== false,
        status: (d.indexing_status as string | null) ?? null,
      })),
      announcements: (announcements.data ?? [])
        .filter((a) => !a.expires_at || Date.parse(a.expires_at) > now)
        .map((a) => ({ title: a.title, body: a.body, publishedAt: String(a.published_at) })),
      library: library.map((l) => ({ title: l.title, kind: knowledgeResourceKindLabels[l.kind] ?? l.kind, summary: l.summary })),
    },
    (s) => stripForCorporation(s, ctx)
  );
  return text.length > MAX_PROFILE_CHARS ? `${text.slice(0, MAX_PROFILE_CHARS)}\n${PROFILE_TRUNCATED}` : text;
}

const PROFILE_TRUNCATED = "[...profile truncated]";

/** The whole ledger, one line per decision, newest first, up to about 1,000 decisions (PR 5, §7 gap 2). */
const MAX_LEDGER_CHARS = 120_000;
/** Decisions read at most (a safety limit, far beyond any strata's history). */
const MAX_LEDGER_ROWS = 10_000;
/** Older decisions past the limit that match a question, sent with it. */
const MAX_OLDER_DECISIONS = 15;

type LedgerLine = { id: string; tag: string; date: string; line: string };

async function ledgerBlock(supabase: SupabaseClient, corpId: string, ctx: StripContext) {
  // Every decision, in pages (the API returns at most 1,000 rows at a time).
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < MAX_LEDGER_ROWS; from += 1000) {
    const { data, error } = await supabase
      .from("decisions")
      .select("id, decided_at, meeting_type, title, category, motion_text, mover, seconder, decision_type, votes_for, votes_against, votes_abstain, source")
      .eq("corporation_id", corpId)
      .order("decided_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.error("[askStratasphere] ledger", error.message);
      break;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // Each decision is tagged E1, E2, ... (newest first) so an answer can cite it.
  const lines: LedgerLine[] = rows.map((d, i) => ({
    id: d.id as string,
    tag: `E${i + 1}`,
    date: String(d.decided_at).slice(0, 10),
    line: `E${i + 1} ${stripForCorporation(ledgerLine(d), ctx)}`,
  }));
  // Newest first, as many as fit; the rest are searched for each question.
  let used = 0;
  let cut = 0;
  while (cut < lines.length && used + lines[cut].line.length + 1 <= MAX_LEDGER_CHARS) used += lines[cut++].line.length + 1;
  const sent = lines.slice(0, cut);
  const older = lines.slice(cut);
  const text = [
    ...sent.map((l) => l.line),
    older.length
      ? `[The ${older.length} oldest decisions, from ${older[older.length - 1].date} to ${older[0].date}, aren't listed here: those that match a question are sent with it, under OLDER DECISIONS.]`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  // Decisions council made between meetings: closed Discussions whose
  // motion carried, awaiting ratification (decided 2026-11-12). Once a
  // meeting ratifies one it's that meeting's decision above, so only those
  // still awaiting are added. Read with the service role, because a
  // manager who uses Stratasphere may not see Discussions themselves; only
  // the motion, its date, and the count, never the comments or who voted
  // which way. Open discussions are never read.
  const { data: pending } = await createAdminClient()
    .from("discussions")
    .select("title, motion, closed_at, votes_for, votes_against, votes_abstain")
    .eq("corporation_id", corpId)
    .eq("status", "closed")
    .eq("result", "supported")
    .eq("vote_required", true)
    .order("closed_at", { ascending: false })
    .limit(20);
  const awaitingRecords: CitedRecord[] = [];
  const awaiting = (pending ?? [])
    .map((d, i) => {
      awaitingRecords.push({ tag: `W${i + 1}`, kind: "between_meetings", title: `${String(d.closed_at).slice(0, 10)}: ${d.title}` });
      return `W${i + 1} ${stripForCorporation(
        `[${String(d.closed_at).slice(0, 10)}, council Discussion between meetings, awaiting ratification at the next council meeting] ${d.title} (${d.votes_for ?? 0}-${d.votes_against ?? 0}-${d.votes_abstain ?? 0}). Motion: ${d.motion}`,
        ctx
      )}`;
    })
    .join("\n");
  return { text: [awaiting, text].filter(Boolean).join("\n"), ids: sent.map((l) => l.id), sent, older, awaitingRecords };
}

/** Directives read at most: every open one, and the latest closed ones. */
const MAX_DIRECTIVES = 300;

/**
 * Directives (0097): the follow-up council decided on, open ones first,
 * each tagged T1, T2, ... so an answer can cite it. Read as the person
 * asking (Stratasphere's users all see directives). Names are stripped like
 * everything else.
 */
async function directivesBlock(supabase: SupabaseClient, corpId: string, ctx: StripContext) {
  const { data, error } = await supabase
    .from("directives")
    .select("id, title, detail, source, source_text, assignee_kind, assignee_name, due_date, status, closed_at, closed_by_name, close_note, created_at, meeting:meetings(meeting_date)")
    .eq("corporation_id", corpId)
    .order("created_at", { ascending: false })
    .limit(MAX_DIRECTIVES);
  if (error) {
    console.error("[askStratasphere] directives", error.message);
    return { text: "", records: [] as CitedRecord[] };
  }
  const rows = [...(data ?? [])].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  const records: CitedRecord[] = [];
  const lines = rows.map((d, i) => {
    const tag = `T${i + 1}`;
    const meeting = (Array.isArray(d.meeting) ? d.meeting[0] : d.meeting) as { meeting_date: string } | null;
    const who = d.assignee_kind === "manager" ? "assigned to the strata manager" : d.assignee_kind === "person" ? `assigned to ${d.assignee_name}` : "not assigned";
    const state =
      d.status === "open"
        ? `open, ${who}${d.due_date ? `, due ${d.due_date}` : ""}`
        : `${d.status === "done" ? "done" : "cancelled"} ${String(d.closed_at ?? "").slice(0, 10)}${d.closed_by_name ? ` by ${d.closed_by_name}` : ""}${d.close_note ? ` (${d.close_note})` : ""}, was ${who}`;
    const from =
      d.source === "meeting"
        ? `from a motion carried at the meeting of ${meeting?.meeting_date ?? "an earlier date"}`
        : d.source === "discussion"
          ? "from a council Discussion that council supported"
          : `added by hand on ${String(d.created_at).slice(0, 10)}`;
    const line = stripForCorporation(
      `${tag} [${state}; ${from}] ${d.title}${d.detail ? ` Detail: ${d.detail}` : ""}${d.source_text ? ` Motion: ${d.source_text}` : ""}`,
      ctx
    );
    records.push({ tag, kind: "directive", title: String(d.title).slice(0, 160), excerpt: line.replace(/^T\d+ /, "") });
    return line;
  });
  return { text: lines.join("\n"), records };
}

function liveDecisionsBlock(agenda: AgendaItem[], ctx: StripContext) {
  return agenda
    .filter((it) => it.done && it.motion?.outcome)
    .map((it) => {
      const m = it.motion!;
      return stripForCorporation(
        `${it.text} — ${m.outcome} (${m.for} for / ${m.against} against / ${m.abstain} abstain). Moved ${m.mover || "—"}, seconded ${m.sec || "—"}. Motion: ${m.text}`,
        ctx
      );
    })
    .join("\n");
}

/**
 * The record the person is looking at (PR 4a), as text for the model:
 * stripped like everything else. Its attachments, for an agenda item, come
 * from attachmentsBlock. Discussions reach here only closed with the motion
 * carried (lib/ai/focus.ts): the motion and the count, never the comments
 * or who voted which way.
 */
function focusBlock(f: ResolvedFocus, ctx: StripContext): { text: string; disclosure?: string } {
  const strip = (t: string) => stripForCorporation(t, ctx);
  const motionLine = (it: AgendaItem) => {
    const m = it.motion;
    if (!m?.text) return "";
    const result = m.outcome ? ` Result: ${m.outcome} (${m.for} for / ${m.against} against / ${m.abstain} abstain).` : "";
    return ` Motion: ${m.text}.${result}`;
  };
  switch (f.kind) {
    case "agenda_item": {
      const it = f.item;
      const parts = [
        `${f.meetingLabel}, ${f.date}. Agenda item: "${it.text}" (${it.cat}).`,
        it.background ? `Background: ${it.background}` : "",
        it.financial ? `Financial implications: ${it.financial}` : "",
        it.risks ? `Risks: ${it.risks}` : "",
        motionLine(it).trim(),
        it.minutesSummary ? `Minutes: ${it.minutesSummary}` : "",
      ].filter(Boolean);
      return { text: strip(parts.join("\n")) };
    }
    case "meeting":
      return {
        text: strip(
          [`${f.meetingLabel}, ${f.date}. Agenda:`, ...f.agenda.map((it) => `${it.num}. ${it.text} (${it.cat}).${motionLine(it)}`)].join("\n")
        ),
      };
    case "document": {
      if (!f.text) {
        return {
          text: strip(`Document: "${f.title}", added ${f.uploadedAt}.`),
          disclosure: strip(
            f.indexingStatus === "pending" || f.indexingStatus === "processing" || f.indexingStatus === "waiting"
              ? `The document the person is looking at ("${f.title}") hasn't been read yet. Say so if the question is about it.`
              : `The document the person is looking at ("${f.title}") couldn't be read (it may be an image or a scan with no text). Say so if the question is about it.`
          ),
        };
      }
      const body = f.text.length > MAX_ATTACHMENT_CHARS ? `${f.text.slice(0, MAX_ATTACHMENT_CHARS)}\n[...truncated]` : f.text;
      return { text: strip(`[DOCUMENT: ${f.title}, added ${f.uploadedAt}]\n${body}\n[END DOCUMENT]`) };
    }
    case "discussion":
      return {
        text: strip(
          `A council decision made between meetings, in a Discussion closed ${f.closedAt}: "${f.title}". Motion: ${f.motion}. ` +
            `CARRIED by council vote (${f.votes.for} for / ${f.votes.against} against / ${f.votes.abstain} abstain). ` +
            "It awaits ratification at the next council meeting."
        ),
      };
  }
}

/** Legislation chunks already open with their citation line (Act, current-to date, section). */
/** Legislation sections: each once (a section's text already names its Act and number). */
function legislationBlock(hits: KnowledgeHit[]) {
  const { groups, charsSaved } = arrangePassages(hits.map((h) => ({ ...h, documentId: null, title: null, sourceAct: null })));
  const byId = new Map(hits.map((h) => [h.id, h]));
  const records: CitedRecord[] = groups.map((g, i) => {
    const h = byId.get(g.passageIds[0]);
    return { tag: `L${i + 1}`, kind: "legislation", title: h?.title || h?.sourceAct || "Knowledge Base", sourceAct: h?.sourceAct ?? undefined, chunkId: h?.id, excerpt: g.segments.join("\n[...]\n") };
  });
  return { text: passagesText(groups, "L"), charsSaved, records };
}

/** A document's passages under one heading, neighbours joined, identical copies once (lib/kb/passages.ts). */
function hitsBlock(hits: KnowledgeHit[], prefix: "D" | "P", titles: Map<string, string> = new Map()) {
  const { groups, charsSaved } = arrangePassages(hits);
  const records: CitedRecord[] = groups.map((g, i) => ({
    tag: `${prefix}${i + 1}`,
    kind: prefix === "D" ? "document" : "precedent",
    title: prefix === "D" ? (g.documentId && titles.get(g.documentId)) || g.title || "Untitled document" : "Precedent from another strata",
    documentId: prefix === "D" ? (g.documentId ?? undefined) : undefined,
    excerpt: g.segments.join("\n[...]\n"),
  }));
  return { text: passagesText(groups, prefix), charsSaved, records };
}

type PrepareInput = {
  supabase: SupabaseClient;
  corpId: string;
  question: string;
  history: AssistantTurn[];
  meeting?: MeetingScope;
  /** What the person is looking at, already read with their own access (lib/ai/focus.ts). */
  focus?: ResolvedFocus | null;
  /** Older turns were dropped from this conversation's history. */
  trimmed?: boolean;
};

/**
 * "That's 30 questions in the last hour. You can ask again at 3:42 p.m. PT."
 * The time is when the oldest of those 30 turns an hour old. Usage is only
 * readable with the service role, so it's read here for this person alone.
 */
export async function hourlyLimitMessage(supabase: SupabaseClient, now = Date.now()) {
  const fallback = `That's ${HOURLY_LIMIT} questions in the last hour. Please wait a few minutes, then ask again.`;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallback;
    const { data } = await createAdminClient()
      .from("stratasphere_usage")
      .select("created_at")
      .eq("user_id", user.id)
      .gt("created_at", new Date(now - 3_600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(HOURLY_LIMIT);
    const at = nextAskAt((data ?? []).map((r) => r.created_at as string), now);
    return at ? `That's ${HOURLY_LIMIT} questions in the last hour. You can ask again at ${clockTime(at, "America/Vancouver")}.` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Everything up to the model call: the allowance check, then the request.
 * `supabase` is the signed-in user's client — every read goes through RLS,
 * and the allowance (stratasphere_allowed, 0090: subscribed, council,
 * manager, or admin, and under 30 questions in the hour) is checked first.
 */
async function prepareStratasphere(input: PrepareInput): Promise<Prepared> {
  if (!input.question.trim()) return { ok: false, error: "Ask a question." };
  const { data: allowed, error: allowError } = await input.supabase.rpc("stratasphere_allowed", { p_corporation_id: input.corpId });
  if (allowError) {
    console.error("[askStratasphere] allowance", allowError.message);
    return { ok: false, error: "Stratasphere isn't available right now." };
  }
  if (allowed === "limit") {
    return { ok: false, limit: true, error: await hourlyLimitMessage(input.supabase) };
  }
  if (allowed !== "ok") {
    return {
      ok: false,
      limit: true,
      error: "Stratasphere comes with a subscription, and is for council members, managers, and admins.",
    };
  }
  return assembleStratasphere(input);
}

/**
 * The request exactly as the model would get it: PII stripping and context
 * assembly, with no allowance check and no model call. Used by every
 * question (through prepareStratasphere) and by the recall check, so the
 * check always tests what Stratasphere really sends.
 */
export async function assembleStratasphere({
  supabase,
  corpId,
  question,
  history,
  meeting,
  focus,
  trimmed,
}: {
  supabase: SupabaseClient;
  corpId: string;
  question: string;
  history: AssistantTurn[];
  meeting?: MeetingScope;
  focus?: ResolvedFocus | null;
  /** Older turns were dropped from this conversation's history. */
  trimmed?: boolean;
}): Promise<Prepared> {
  const q = question.trim().slice(0, 4000);
  if (!q) return { ok: false, error: "Ask a question." };

  const ctx = await loadStripContext(createAdminClient(), corpId);
  const { data: corp } = await supabase
    .from("strata_corporations")
    .select("legal_name, building_name, strata_plan_number")
    .eq("strata_plan_number", corpId)
    .maybeSingle();
  const corpName = corp?.building_name || corp?.legal_name || corpId;

  const strippedQuestion = stripForCorporation(q, ctx);
  const disclosures: string[] = [];

  let searchFailed = false;
  const [profile, attachments, ledgerResult, bylaws, meaningHits, keywordHits, directives] = await Promise.all([
    profileBlock(supabase, corpId, ctx).catch((err) => {
      console.error("[askStratasphere] profile", err instanceof Error ? err.message : err);
      return "";
    }),
    meeting
      ? attachmentsBlock(supabase, corpId, meeting.item, ctx)
      : focus?.kind === "agenda_item"
        ? attachmentsBlock(supabase, corpId, focus.item, ctx)
        : Promise.resolve({ text: "", disclosures: [] as string[], read: [] as string[], whole: [] as string[], records: [] as CitedRecord[] }),
    ledgerBlock(supabase, corpId, ctx),
    bylawsBlock(supabase, corpId, ctx),
    withTimeout(searchKnowledge(supabase, corpId, strippedQuestion), SEARCH_TIMEOUT_MS).catch((err) => {
      console.error("[askStratasphere] search", err instanceof Error ? err.message : err);
      searchFailed = true;
      disclosures.push(
        "The document search failed for this question. Begin your answer with: \"Note: I was unable to search the document repository right now. My answer is based on the decision ledger" +
          (meeting ? " and item attachments" : "") +
          ' only."'
      );
      return [] as KnowledgeHit[];
    }),
    // Alongside the meaning search: exact strings and words (0095). If it
    // fails, the answer still has the meaning search.
    withTimeout(searchKeywords(supabase, corpId, strippedQuestion), SEARCH_TIMEOUT_MS).catch((err) => {
      console.error("[askStratasphere] keyword search", err instanceof Error ? err.message : err);
      return [] as KnowledgeHit[];
    }),
    directivesBlock(supabase, corpId, ctx).catch((err) => {
      console.error("[askStratasphere] directives", err instanceof Error ? err.message : err);
      return { text: "", records: [] as CitedRecord[] };
    }),
  ]);
  const hits = mergeHits(meaningHits, keywordHits);
  disclosures.push(...attachments.disclosures, ...bylaws.disclosures);
  if (profile.endsWith(PROFILE_TRUNCATED)) {
    disclosures.push(
      "The end of the platform records (the oldest meetings or documents in the list) wasn't read: there are more than can be read at once. If the answer could be there, say so."
    );
  }
  const ledger = ledgerResult.text;
  // Decisions older than those listed in full, searched for this question.
  const exact = exactStrings(strippedQuestion);
  const words = searchWords(strippedQuestion);
  const olderDecisions = ledgerResult.older
    .map((l) => ({ ...l, score: lineScore(l.line, exact, words) }))
    .filter((l) => l.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OLDER_DECISIONS);
  const looking = focus ? focusBlock(focus, ctx) : null;
  if (looking?.disclosure) disclosures.push(looking.disclosure);

  // Each passage once in a request: not the bylaws or attachments already
  // sent in full (one cut short keeps its passages, so its unread end can
  // still be found), and not a passage already shown with an earlier
  // question in this conversation (still in front of the model).
  const inFull = new Set([...bylaws.whole, ...attachments.whole]);
  const earlier = history.map((t) => t.context ?? "").join("\n");
  let repeated = 0;
  const fresh = (h: KnowledgeHit) => {
    if (earlier && earlier.includes(h.text)) {
      repeated++;
      return false;
    }
    return true;
  };
  const local = hits.filter((h) => h.scope === "corporation" && !(h.documentId && inFull.has(h.documentId))).filter(fresh);
  const global = hits.filter((h) => h.scope === "global_precedent").filter(fresh);
  const legislation = hits.filter((h) => h.scope === "legislation").filter(fresh);
  const titles = await documentTitles(supabase, corpId, hits);
  const localBlock = hitsBlock(local, "D", titles);
  const globalBlock = hitsBlock(global, "P");
  const legislationText = legislationBlock(legislation);

  // The request is laid out for the prompt cache: what's the same for every
  // question (rules, bylaws, ledger) first, then the conversation, where
  // each question carries the records found for it. Only the newest turn is
  // new to the cache, so remembering earlier records costs little.
  const preamble = meeting
    ? `You are Stratasphere, the AI governance assistant for Strata Plan ${corpId} (${corpName}), operating inside a live ${meeting.meetingLabel}. Answer in 2–4 sentences; when a figure is calculated, add the working briefly after them.`
    : `You are Stratasphere, the AI governance assistant for Strata Plan ${corpId} (${corpName}). Lead with the answer in a sentence or two, then give the working and sources, as briefly as they allow.`;

  // Cached for an hour (PR 5, §7 "Cost"): the bylaws and ledger, which
  // change only when a document is uploaded or a meeting adjourns, then the
  // platform records, which change more often (a live meeting updates its
  // agenda). Two breakpoints, so a change to the platform records still
  // reads the bylaws and ledger from the cache. Nothing here changes from
  // one question to the next.
  const records = [
    block(`${corpName.toUpperCase()} BYLAWS (full text of the current bylaws, most recent first)`, bylaws.text),
    block("DECISION LEDGER (every entry is a carried motion, newest first; votes are for-against-abstain)", ledger),
  ]
    .filter(Boolean)
    .join("\n");
  const platform = block(
    `${corpName.toUpperCase()} ON STRATACOUNCIL.CA (live platform records: the roster, council, meetings, documents on file, management, announcements, and the Library) (cite as R)`,
    profile
  );
  const directivesText = block(
    "DIRECTIVES (what council decided should be done, from carried motions, supported Discussions, or added by hand; open first, then done or cancelled, newest first) (cite as T1, T2, ...)",
    directives.text
  );

  const hour = { type: "ephemeral", ttl: "1h" } as const;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: [preamble, CARDINAL_RULES.replaceAll("{CORP}", corpName), PERMITTED].join("\n\n") },
    { type: "text", text: records || "=== STANDING RECORDS ===\nNo bylaws or decisions are on file.", cache_control: hour },
    {
      type: "text",
      text: `${platform || "=== PLATFORM RECORDS ===\nNot available for this question."}${directivesText ? `\n${directivesText}` : ""}\n\nEach question below comes with the records found for it. Answer only what is supported by these records and those excerpts.`,
      cache_control: hour,
    },
  ];

  let turnContext = [
    block("TODAY", todayLine()),
    // What the person is looking at goes first and in full (PR 4a). Search
    // below still runs across everything, so it adds context, never narrows it.
    looking ? block("THE RECORD THE PERSON IS LOOKING AT (highest priority) (cite as F)", looking.text) : "",
    focus?.kind === "agenda_item" ? block("THAT AGENDA ITEM'S ATTACHMENTS (HIGHEST PRIORITY, verbatim)", attachments.text) : "",
    meeting
      ? block(
          "CURRENT AGENDA ITEM (cite as F)",
          `"${stripForCorporation(meeting.item.text, ctx)}" (${stripForCorporation(meeting.item.cat, ctx)})`
        )
      : "",
    disclosures.length ? block("DISCLOSURES REQUIRED FOR THIS ANSWER", disclosures.join("\n")) : "",
    meeting ? block("CURRENT AGENDA ITEM ATTACHMENTS (HIGHEST PRIORITY, verbatim)", attachments.text) : "",
    meeting ? block("DECISIONS MADE SO FAR IN THIS MEETING (not yet in the ledger) (cite as M)", liveDecisionsBlock(meeting.agenda, ctx)) : "",
    olderDecisions.length
      ? block(
          "OLDER DECISIONS (carried motions from the decision ledger, older than those listed in full, that match this question; votes are for-against-abstain)",
          olderDecisions.map((l) => l.line).join("\n")
        )
      : "",
    block(
      `${corpName.toUpperCase()} DOCUMENT EXCERPTS (most relevant to this question; a document's passages are under one heading, with [...] between parts that aren't next to each other)`,
      localBlock.text
    ),
    block("CROSS-PLATFORM PRECEDENT (anonymized, from other strata corporations — never this corporation's own data)", globalBlock.text),
    block(
      "LEGISLATION EXCERPTS (verbatim text from the Knowledge Base: BC Acts, regulations, and official guidance. Cite the Act and section, or the guidance document's title)",
      legislationText.text
    ),
  ]
    .filter(Boolean)
    .join("\n");
  if (repeated) {
    turnContext = [
      turnContext,
      `[${repeated} passage${repeated === 1 ? "" : "s"} found for this question already appear${repeated === 1 ? "s" : ""} with earlier questions above, and ${repeated === 1 ? "isn't" : "aren't"} repeated here.]`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (!turnContext) turnContext = "No further records matched this question.";
  if (turnContext.length > MAX_CONTEXT_CHARS) {
    turnContext = `[Not all the records found for this question fit: the end of them wasn't read. If the answer could be missing because of that, say so.]\n${turnContext.slice(0, MAX_CONTEXT_CHARS)}\n[...context truncated]`;
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({
    role: t.role,
    content:
      t.role === "user"
        ? composeUserTurn(t.context ? untagContext(t.context) : null, stripForCorporation(t.content.slice(0, 8000), ctx))
        : stripForCorporation(
            `${t.content.slice(0, 8000)}${t.sources?.length ? `\n[Sources for this answer: ${t.sources.join("; ")}]` : ""}`,
            ctx
          ),
  }));
  // The API needs the conversation to start with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (trimmed && messages.length) {
    messages[0] = {
      role: "user",
      content: `[Earlier parts of this conversation are no longer available to you.]\n\n${messages[0].content as string}`,
    };
  }
  messages.push({ role: "user", content: composeUserTurn(turnContext, strippedQuestion) });

  return {
    ok: true,
    system,
    messages,
    turnContext,
    effort: meeting ? "low" : "medium",
    maxTokens: meeting ? 4000 : 8000,
    tools: [calculatorTool],
    sources: withFocusSource(focus, sourcesFrom(hits, Boolean(ledger.trim()), titles)),
    records: [
      ...(looking || meeting
        ? [
            {
              tag: "F",
              kind: "focus" as const,
              title: focus?.kind === "document" ? focus.title : meeting ? meeting.item.text || "The agenda item" : "The record being looked at",
              documentId: focus?.kind === "document" ? focus.documentId : undefined,
              excerpt: (looking?.text ?? "").slice(0, 4000) || undefined,
            },
          ]
        : []),
      ...attachments.records,
      ...(meeting ? [{ tag: "M", kind: "meeting" as const, title: `Decisions made so far in this ${meeting.meetingLabel}` }] : []),
      ...bylaws.records,
      ...ledgerResult.awaitingRecords,
      ...[...ledgerResult.sent, ...olderDecisions].map(
        (l): CitedRecord => ({ tag: l.tag, kind: "decision", title: l.line.replace(/^E\d+ /, "").slice(0, 160), decisionId: l.id, excerpt: l.line.replace(/^E\d+ /, "") })
      ),
      ...localBlock.records,
      ...globalBlock.records,
      ...legislationText.records,
      ...(platform ? [{ tag: "R", kind: "platform" as const, title: "The strata's records on StrataCouncil.ca" }] : []),
      ...directives.records,
    ],
    bylawSources: bylaws.sources,
    diagnostics: {
      bylawDocumentIds: bylaws.sources.flatMap((b) => (b.kind === "document" ? [b.documentId] : [])),
      attachmentDocumentIds: attachments.read,
      ledgerDecisionIds: [...ledgerResult.ids, ...olderDecisions.map((l) => l.id)],
      // Every passage found, including those already shown with an earlier question.
      hits: hits.map((h) => ({ id: h.id, scope: h.scope, documentId: h.documentId, title: h.title, similarity: h.similarity })),
      searchFailed,
      sizes: (() => {
        const textOf = (c: Anthropic.Beta.BetaMessageParam["content"]) => (typeof c === "string" ? c : JSON.stringify(c));
        const historyChars = messages.slice(0, -1).reduce((n, m) => n + textOf(m.content).length, 0);
        const turnChars = textOf(messages[messages.length - 1].content).length;
        const passages = localBlock.text.length;
        const precedent = globalBlock.text.length;
        const legislationChars = legislationText.text.length;
        const rules = system[0].text.length;
        const platformChars = system[2].text.length;
        const recordsChars = system[1].text.length;
        const ledgerChars = ledger.length;
        return {
          rules,
          bylaws: Math.max(0, recordsChars - ledgerChars),
          ledger: ledgerChars,
          platform: platformChars,
          history: historyChars,
          passages,
          precedent,
          legislation: legislationChars,
          otherForQuestion: Math.max(0, turnChars - passages - precedent - legislationChars),
          total: rules + recordsChars + platformChars + historyChars + turnChars,
          savedByJoining: localBlock.charsSaved + globalBlock.charsSaved + legislationText.charsSaved,
        };
      })(),
    },
  };
}

/** The document the person was looking at leads the sources, once. */
function withFocusSource(focus: ResolvedFocus | null | undefined, sources: StratasphereSource[]): StratasphereSource[] {
  if (focus?.kind !== "document") return sources;
  const rest = sources.filter((x) => !(x.kind === "document" && x.documentId === focus.documentId));
  const lead: StratasphereSource = { kind: "document", title: focus.title, documentId: focus.documentId };
  return [lead, ...rest].slice(0, 12);
}

/** Today's date in Pacific time, for "this fiscal year", "last month", and the like. */
function todayLine(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz("America/Vancouver", now),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz("America/Vancouver", now), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `Today is ${day} (${iso}), Pacific time.`;
}

/** A question as the model sees it: the records found for it, then the question. Must stay byte-stable (cache). */
function composeUserTurn(context: string | null, question: string) {
  return context ? `=== RECORDS FOUND FOR THIS QUESTION ===\n${context}\n\n=== QUESTION ===\n${question}` : question;
}

type AskInput = PrepareInput;

/**
 * One row per answer in stratasphere_usage (0024), for the Super Admin
 * dashboard. Written with the service role (no client can write usage);
 * a failure is logged, never shown to the person asking.
 */
async function logUsage(input: AskInput, usage: TokenUsage) {
  try {
    const {
      data: { user },
    } = await input.supabase.auth.getUser();
    const { error } = await createAdminClient()
      .from("stratasphere_usage")
      .insert({
        corporation_id: input.corpId,
        user_id: user?.id ?? null,
        surface: input.meeting ? "meeting" : "assistant",
        input_tokens: usage.input,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        output_tokens: usage.output,
        cost_usd: Number(estimateCostUsd(usage).toFixed(5)),
      });
    if (error) console.error("[stratasphere usage]", error.message);
  } catch (err) {
    console.error("[stratasphere usage]", err instanceof Error ? err.message : err);
  }
}

/** Search hits, plus the full bylaws when the answer refers to bylaws. */
export function finalSources(prepared: Extract<Prepared, { ok: true }>, text: string) {
  if (!/\bbylaws?\b/i.test(text)) return prepared.sources;
  const have = new Set(prepared.sources.map((s) => (s.kind === "document" ? s.documentId : "")));
  return [...prepared.bylawSources.filter((b) => b.kind === "document" && !have.has(b.documentId)), ...prepared.sources].slice(0, 12);
}

/**
 * The answer as the person reads it, and its sources: the records it cited
 * (lib/ai/citations.ts), or, if it cited none, those found for it as before.
 */
export function finishAnswer(prepared: Extract<Prepared, { ok: true }>, raw: string, text = cleanAnswer(raw, tagSet(prepared))) {
  const records = new Map(prepared.records.map((r) => [r.tag, r]));
  const tags = citedTags(raw, tagSet(prepared));
  const cited = sourcesFromCitations(tags, records);
  return { text, tags, cited: tags.map((t) => records.get(t)!).filter(Boolean), sources: tags.length ? cited : finalSources(prepared, text) };
}

export function tagSet(prepared: Extract<Prepared, { ok: true }>) {
  return new Set(prepared.records.map((r) => r.tag));
}

/** Answer one question in full (Meeting Mode). */
export async function askStratasphere(input: AskInput): Promise<AskResult> {
  const prepared = await prepareStratasphere(input);
  if (!prepared.ok) return prepared;
  try {
    const { text, truncated, usage } = await askClaudeText({
      system: prepared.system,
      messages: prepared.messages,
      effort: prepared.effort,
      maxTokens: prepared.maxTokens,
      tools: prepared.tools,
      cache: true,
    });
    await logUsage(input, usage);
    const done = finishAnswer(prepared, text);
    if (!done.text) return { ok: false, error: "Stratasphere didn't return an answer. Please try again." };
    return { ok: true, text: truncated ? `${done.text}\n[Answer cut short.]` : done.text, sources: done.sources, context: prepared.turnContext };
  } catch (err) {
    if (err instanceof ClaudeRefusalError) return { ok: false, error: "Stratasphere can't help with that question." };
    console.error("[askStratasphere]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Stratasphere couldn't answer right now. Please try again." };
  }
}

/**
 * Answer one question, streaming the text to `onText` as it's written (the
 * standalone assistant). Resolves with the full answer and its sources.
 */
export async function streamStratasphere(input: AskInput, onText: (delta: string) => void): Promise<AskResult> {
  const prepared = await prepareStratasphere(input);
  if (!prepared.ok) return prepared;
  try {
    // Only clean text reaches the person: no citation tags, markup symbols, or emoji.
    const cleaner = answerCleaner(tagSet(prepared), onText);
    const { truncated, usage } = await streamClaudeText(
      { system: prepared.system, messages: prepared.messages, effort: prepared.effort, maxTokens: prepared.maxTokens, tools: prepared.tools, cache: true },
      (delta) => cleaner.push(delta)
    );
    const shown = cleaner.finish();
    await logUsage(input, usage);
    const done = finishAnswer(prepared, cleaner.raw(), shown);
    if (!done.text) return { ok: false, error: "Stratasphere didn't return an answer. Please try again." };
    if (truncated) onText("\n[Answer cut short.]");
    return { ok: true, text: truncated ? `${done.text}\n[Answer cut short.]` : done.text, sources: done.sources, context: prepared.turnContext };
  } catch (err) {
    if (err instanceof ClaudeRefusalError) return { ok: false, error: "Stratasphere can't help with that question." };
    console.error("[streamStratasphere]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Stratasphere couldn't answer right now. Please try again." };
  }
}
