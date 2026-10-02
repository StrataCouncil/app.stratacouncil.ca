import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeText, ClaudeRefusalError, streamClaudeText } from "@/lib/ai/claude";
import { loadStripContext, stripForCorporation, type StripContext } from "@/lib/kb/privacy";
import { searchKnowledge, type KnowledgeHit } from "@/lib/kb/search";
import type { AgendaItem } from "@/lib/meetings/agenda";

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

const CARDINAL_RULES = `FABRICATION IS PROHIBITED: Never invent, estimate, extrapolate, or assume any corporation-specific fact — names, lot numbers, dollar amounts, dates, vote counts, bylaw sections, motion text, or any other data. If it is not in the context provided, it does not exist for the purpose of this answer.

WHEN DATA IS MISSING: If the answer isn't present in any context block, say so clearly in one sentence — do not apologize at length, do not fill the gap with general knowledge — then give one concrete direction for where the answer may be found: the specific document type to look in (for example the registered bylaws, the most recent AGM minutes, the depreciation report), the person to ask (the strata manager, council's secretary or treasurer), or, for questions of law, the Act and section to read or a lawyer, the Civil Resolution Tribunal, or the Condominium Home Owners Association of BC.

NO INTERNET: No access to external websites, databases, news sources, or search engines. Never reference, cite, or imply an external source, and never suggest the user "check online."

LEGISLATION IS PERMITTED, ADVICE IS NOT: May explain what legislation says, but only from the LEGISLATION EXCERPTS in the context, citing the Act and section. Never state what an Act says from memory: if no excerpt covers it, say the legislation library doesn't include it and name the Act to read. May not advise the corporation on what it should do legally. Always label legislative information as general context, not corporation-specific guidance.

NO OPINIONS: Report what the sources say. Never offer opinions, judgments, predictions, or recommendations on what anyone should do, and never speculate about why something happened.

CITE YOUR SOURCE: Every factual claim names its source — document title, decision date and meeting type, agenda item title, or legislation section. If a source can't be named, the claim can't be made.

IF YOU DON'T KNOW, SAY SO PRECISELY: If nothing in the corporation's records or in cross-platform precedent answers the question, say: "I don't see anything in {CORP}'s records — or in cross-platform precedent — that answers this. You may want to check [the specific document type] directly, or ask your strata manager." If only cross-platform precedent is relevant, answer from it and label it unmistakably as precedent from other strata corporations, never as this corporation's own data. For anything out of scope, say: "I can only answer questions about {CORP}'s own records, cross-platform precedent, and BC strata legislation. I'm not able to [look that up online / advise on what you should do legally / access another corporation's own records]." Cross-platform precedent is not "another corporation's records" — it is anonymized and included by design.

RECENCY RULE: When multiple documents or decisions address the same topic, treat the most recently uploaded one as the most authoritative — documents are sorted with the most recent first and their upload date is stamped in the content header. For financial statements, always use the most recently uploaded version for current figures while referencing older statements for trends or year-over-year context. For bylaws or policies, the most recently uploaded version governs. Acknowledge older records where relevant but base your answer on the most recent.

COUNTING AND ENUMERATION RULE: When any question requires counting, filtering, or summing data — roster entries, decisions, meetings, documents, votes, fees, or any other records — you must work through every single entry systematically before giving a final answer. List each matching entry explicitly, then state the total. Never give a count or sum without showing the entries you counted. If you find yourself uncertain about a count, recount from the beginning. A wrong number with confidence is worse than a correct number with visible working.

CONFLICT DISCLOSURE RULE: If sources disagree — a corporation's bylaws say one thing while BC legislation, global precedent, or another local document says another — do not silently pick one or reconcile them yourself. State plainly what each source says and that they conflict. For example: "Your bylaws state [X]. The Strata Property Act states [Y]. These appear to conflict." Do not resolve which one governs, do not soften the discrepancy, and do not guess at an explanation. Report only what each source explicitly states.

DISPUTED-FACT RULE: If a user says a cited fact is wrong, do not concede the point or change the answer — you have no way to independently verify a claim made in conversation. State exactly which document, section, and upload date the fact came from, and note that an updated version of that document can be uploaded if it's outdated or incorrect. Never revise a factual claim based on a user's assertion alone; only a new document in context can change what you cite.`;

const PERMITTED = `PERMITTED KNOWLEDGE: Only what is in the context blocks below: this corporation's documents and minutes, its decision ledger, the legislation excerpts, and anonymized precedent from other strata corporations on the platform. Precedent is always framed explicitly as cross-platform precedent, never presented as if it were this corporation's own data. General knowledge may be used only to read and understand those sources (plain meaning of words, arithmetic), never as a source of facts.

PIPA: Refer to owners by strata lot number only (e.g. SL061), never by name. Text in the context has already had names and personal details replaced with lot numbers or placeholders such as [name redacted]; never try to guess what a placeholder stands for.

FORMAT: Plain prose only — no markdown, no **, no #, no bullet dashes, no emoji, no preamble, no sign-off, no unsolicited recommendations. Numbered lists as "1. 2. 3." only when listing is genuinely needed.`;

const MAX_CONTEXT_CHARS = 400_000;
const MAX_ATTACHMENT_CHARS = 150_000;
const SEARCH_TIMEOUT_MS = 10_000;

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export interface MeetingScope {
  item: AgendaItem;
  agenda: AgendaItem[];
  meetingLabel: string;
}

/** What an answer drew on, shown under it. Titles are as stored (stripped). */
export type StratasphereSource =
  | { kind: "document"; title: string; documentId: string }
  | { kind: "decisions" }
  | { kind: "precedent" }
  | { kind: "legislation"; title: string };

export type AskResult = { ok: true; text: string; sources: StratasphereSource[] } | { ok: false; error: string; limit?: boolean };

type Prepared =
  | { ok: true; system: string; messages: Anthropic.Beta.BetaMessageParam[]; effort: "low" | "medium"; maxTokens: number; sources: StratasphereSource[] }
  | { ok: false; error: string; limit?: boolean };

function sourcesFrom(hits: KnowledgeHit[], hasLedger: boolean): StratasphereSource[] {
  const out: StratasphereSource[] = [];
  const seenDocs = new Set<string>();
  for (const h of hits) {
    if (h.scope === "corporation" && h.documentId && !seenDocs.has(h.documentId)) {
      seenDocs.add(h.documentId);
      out.push({ kind: "document", title: h.title || "Untitled document", documentId: h.documentId });
    }
  }
  const acts = [...new Set(hits.filter((h) => h.scope === "legislation").map((h) => h.sourceAct || h.title || "BC legislation"))];
  for (const a of acts) out.push({ kind: "legislation", title: a });
  if (hits.some((h) => h.scope === "global_precedent")) out.push({ kind: "precedent" });
  if (hasLedger) out.push({ kind: "decisions" });
  return out.slice(0, 12);
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
  if (!ids.length) return { text: "", disclosures };
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
      let text = stripForCorporation(d.document_text, ctx);
      if (text.length > budget) {
        text = `${text.slice(0, Math.max(0, budget))}\n[...truncated]`;
      }
      budget -= text.length;
      parts.push(`[ATTACHMENT: ${title}, added ${String(d.uploaded_at).slice(0, 10)}]\n${text}\n[END ATTACHMENT]`);
    } else if (d.indexing_status === "pending" || d.indexing_status === "processing") {
      disclosures.push(`The attachment "${title}" is still being processed and is not yet searchable. Say so before answering if it matters.`);
    } else if (d.source_type === "link") {
      disclosures.push(`This item has a link attachment ("${title}") whose page couldn't be read. If the question is about it, say you can't access that page and the user should refer to the link directly.`);
    } else {
      disclosures.push(`The attachment "${title}" couldn't be read (it may be an image or a scanned document with no text). Say so if the question is about it.`);
    }
  }
  return { text: parts.join("\n\n"), disclosures };
}

async function ledgerBlock(supabase: SupabaseClient, corpId: string, ctx: StripContext) {
  const { data } = await supabase
    .from("decisions")
    .select("decided_at, meeting_type, title, category, motion_text, mover, seconder, decision_type, votes_for, votes_against, votes_abstain, source")
    .eq("corporation_id", corpId)
    .order("decided_at", { ascending: false })
    .limit(50);
  return (data ?? [])
    .map((d) => {
      const votes = d.votes_for != null ? ` (${d.votes_for} for / ${d.votes_against ?? 0} against / ${d.votes_abstain ?? 0} abstain)` : "";
      const who = d.mover ? ` Moved ${d.mover}${d.seconder ? `, seconded ${d.seconder}` : ""}.` : "";
      const where = `${String(d.decided_at).slice(0, 10)}, ${d.meeting_type ?? "meeting"}${d.source === "historic_minutes" ? " (from uploaded past minutes)" : ""}`;
      const motion = d.motion_text ? ` Motion: ${d.motion_text}` : "";
      return stripForCorporation(`[${where}] ${d.title} — CARRIED${votes}.${who}${motion}`, ctx);
    })
    .join("\n");
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

function hitsBlock(hits: KnowledgeHit[]) {
  return hits
    .map((h, i) => `[${i + 1}${h.title ? ` | ${h.title}` : ""}${h.sourceAct ? ` | ${h.sourceAct}` : ""} | relevance ${h.similarity.toFixed(2)}]\n${h.text}`)
    .join("\n\n");
}

/**
 * Everything up to the model call: the allowance check, PII stripping, and
 * context assembly. `supabase` is the signed-in user's client — every read
 * goes through RLS, and the per-call allowance (subscription, or the free
 * meeting's ten calls) is checked and counted first.
 */
async function prepareStratasphere({
  supabase,
  corpId,
  question,
  history,
  meeting,
}: {
  supabase: SupabaseClient;
  corpId: string;
  question: string;
  history: AssistantTurn[];
  meeting?: MeetingScope;
}): Promise<Prepared> {
  const q = question.trim().slice(0, 4000);
  if (!q) return { ok: false, error: "Ask a question." };

  const { data: allowed, error: allowError } = await supabase.rpc("consume_stratasphere_request", { p_corporation_id: corpId });
  if (allowError) {
    console.error("[askStratasphere] allowance", allowError.message);
    return { ok: false, error: "Stratasphere isn't available right now." };
  }
  if (!allowed) {
    return {
      ok: false,
      limit: true,
      error: "Stratasphere needs a subscription. (Your free meeting includes ten questions, and they've been used.)",
    };
  }

  const ctx = await loadStripContext(createAdminClient(), corpId);
  const { data: corp } = await supabase
    .from("strata_corporations")
    .select("legal_name, building_name, strata_plan_number")
    .eq("strata_plan_number", corpId)
    .maybeSingle();
  const corpName = corp?.building_name || corp?.legal_name || corpId;

  const strippedQuestion = stripForCorporation(q, ctx);
  const disclosures: string[] = [];

  const [attachments, ledger, hits] = await Promise.all([
    meeting ? attachmentsBlock(supabase, corpId, meeting.item, ctx) : Promise.resolve({ text: "", disclosures: [] }),
    ledgerBlock(supabase, corpId, ctx),
    withTimeout(searchKnowledge(supabase, corpId, strippedQuestion), SEARCH_TIMEOUT_MS).catch((err) => {
      console.error("[askStratasphere] search", err instanceof Error ? err.message : err);
      disclosures.push(
        "The document search failed for this question. Begin your answer with: \"Note: I was unable to search the document repository right now. My answer is based on the decision ledger" +
          (meeting ? " and item attachments" : "") +
          ' only."'
      );
      return [] as KnowledgeHit[];
    }),
  ]);
  disclosures.push(...attachments.disclosures);

  const local = hits.filter((h) => h.scope === "corporation");
  const global = hits.filter((h) => h.scope === "global_precedent");
  const legislation = hits.filter((h) => h.scope === "legislation");

  const preamble = meeting
    ? `You are Stratasphere, the AI governance assistant for Strata Plan ${corpId} (${corpName}), operating inside a live ${meeting.meetingLabel}. Current agenda item: "${stripForCorporation(meeting.item.text, ctx)}" (${stripForCorporation(meeting.item.cat, ctx)}). Answer in 2–4 sentences.`
    : `You are Stratasphere, the AI governance assistant for Strata Plan ${corpId} (${corpName}). Answer in up to a short paragraph.`;

  let context = [
    meeting ? block("CURRENT AGENDA ITEM ATTACHMENTS (HIGHEST PRIORITY, verbatim)", attachments.text) : "",
    block("DECISION LEDGER (carried motions, newest first)", ledger),
    meeting ? block("DECISIONS MADE SO FAR IN THIS MEETING (not yet in the ledger)", liveDecisionsBlock(meeting.agenda, ctx)) : "",
    block(`${corpName.toUpperCase()} DOCUMENT EXCERPTS (most relevant to this question)`, hitsBlock(local)),
    block("CROSS-PLATFORM PRECEDENT (anonymized, from other strata corporations — never this corporation's own data)", hitsBlock(global)),
    block("LEGISLATION EXCERPTS", hitsBlock(legislation)),
  ]
    .filter(Boolean)
    .join("\n");
  if (context.length > MAX_CONTEXT_CHARS) context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n[...context truncated]`;

  const system = [
    preamble,
    CARDINAL_RULES.replaceAll("{CORP}", corpName),
    PERMITTED,
    disclosures.length ? `DISCLOSURES REQUIRED FOR THIS ANSWER:\n${disclosures.join("\n")}` : "",
    context || "=== CONTEXT ===\nNo records matched this question.",
    "Answer only what is supported by the context above.",
  ]
    .filter(Boolean)
    .join("\n\n");

  // At most 10 turns of history (5 + 5), stripped like everything else.
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-10).map((t) => ({ role: t.role, content: stripForCorporation(t.content.slice(0, 8000), ctx) })),
    { role: "user" as const, content: strippedQuestion },
  ];
  // The API needs the conversation to start with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();

  return {
    ok: true,
    system,
    messages,
    effort: meeting ? "low" : "medium",
    maxTokens: meeting ? 4000 : 8000,
    sources: sourcesFrom(hits, Boolean(ledger.trim())),
  };
}

type AskInput = Parameters<typeof prepareStratasphere>[0];

/** Answer one question in full (Meeting Mode). */
export async function askStratasphere(input: AskInput): Promise<AskResult> {
  const prepared = await prepareStratasphere(input);
  if (!prepared.ok) return prepared;
  try {
    const { text, truncated } = await askClaudeText({
      system: prepared.system,
      messages: prepared.messages,
      effort: prepared.effort,
      maxTokens: prepared.maxTokens,
    });
    if (!text) return { ok: false, error: "Stratasphere didn't return an answer. Please try again." };
    return { ok: true, text: truncated ? `${text}\n[Answer cut short.]` : text, sources: prepared.sources };
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
    const { text, truncated } = await streamClaudeText(
      { system: prepared.system, messages: prepared.messages, effort: prepared.effort, maxTokens: prepared.maxTokens },
      onText
    );
    if (!text) return { ok: false, error: "Stratasphere didn't return an answer. Please try again." };
    if (truncated) onText("\n[Answer cut short.]");
    return { ok: true, text: truncated ? `${text}\n[Answer cut short.]` : text, sources: prepared.sources };
  } catch (err) {
    if (err instanceof ClaudeRefusalError) return { ok: false, error: "Stratasphere can't help with that question." };
    console.error("[streamStratasphere]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Stratasphere couldn't answer right now. Please try again." };
  }
}
