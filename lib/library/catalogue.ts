/**
 * The Library's catalogue: the article kinds and their labels, and the
 * rules for templates and forms. Every item is written and published in
 * the Super Admin console (library_resources, 0049; lib/data/library.ts).
 * The hard-coded placeholder articles that showed as "Coming soon" were
 * removed on 2026-11-21.
 */

/**
 * The Library (doc01 §3b's `playbooks`/`templates` tables,
 * unified into one searchable set here rather than two separate lists —
 * a new council member doesn't think in schema tables, they think "I
 * need to know X"). Free the moment a user is connected to a
 * corporation, no subscription required — this is the free-tier
 * onboarding value doc01 §4a describes, and it's why this tab leads the
 * nav: it's the thing a brand-new council member gets immediate use out
 * of before anything else here means much to them.
 *
 * `jurisdictionLevel` is the category that actually matters for scoping
 * (`"federal" | "provincial" | "universal"`), with `jurisdiction` giving
 * the specific province only when the level is `"provincial"`:
 * - `"provincial"` — a specific Act like the Strata Property Act (BC),
 *   tied to one province's legislation (`jurisdiction: "BC" | "AB" | "QC"`).
 *   This is what changes as StrataCouncil expands beyond BC — Alberta and
 *   Quebec each get their own provincial set, not a rewrite of BC's.
 * - `"federal"` — Canada-wide legislation, which
 *   applies to every corporation regardless of province, so it's neither
 *   scoped to one province nor truly "universal" in the way general
 *   meeting-etiquette content is. `jurisdiction` stays `null` here.
 * - `"universal"` — no legislative tie at all, applies everywhere
 *   (`jurisdiction: null`).
 * Municipal isn't modeled — nothing at that level applies to strata
 * governance content here.
 * A corporation sees its own province's set, plus federal, plus
 * universal (doc01 §3b, extended) — every resource here is BC,
 * federal or universal today since BC is this corporation's only
 * jurisdiction so far; the shape already supports the other two
 * provinces once they exist.
 *
 * `checklist`/`commonMistakes` are populated for the `playbook` and
 * `emergency_playbook` kinds (situation-response content genuinely
 * benefits from a step list) and left empty for the others, where a
 * summary carries the content instead.
 *
 * Gating (decided): `policy_template` and `form` are the kinds behind the
 * paywall (forms added 2026-10-20, same treatment as templates).
 * Everything else — playbooks, emergency playbooks, operational guides,
 * financial insights, legislation updates — stays free, on the reasoning
 * already recorded here: playbooks/emergency playbooks are the "don't
 * screw this up right now" content that earns trust in week one, and
 * financial insights/legislation updates are ongoing value for an engaged
 * council, so neither is a good gating candidate. Templates are more of a
 * convenience — downloadable, editable documents — than urgent-need
 * content, which makes them the one kind worth holding back as a
 * subscription incentive without taking away anything a council actually
 * needs in a crisis. Reuses the existing binary subscribed/not-subscribed
 * flag (the strata's subscription, same as the
 * Stratasphere™ assistant) — no new tier system.
 *
 * Locked templates stay visible and browsable (greyed card, lock badge,
 * clickable through to their detail page) rather than hidden — the
 * library should read as "here's everything, some of it needs a
 * subscription to download," not as a shrunken free tier. See
 * `isTemplateLocked()` below and the `--locked` card treatment in
 * `KnowledgeLibrary`/the detail page.
 */
export function isTemplateLocked(_resource: Pick<KnowledgeResource, "kind">, _subscribed: boolean) {
  // Templates and forms are free since 2026-11-12 (Learn is free:
  // docs/learn-decide-remember.md). Kept so the lock can return if needed.
  return false;
}

/** The kinds a subscriber downloads as Word, filled in for their strata: policy templates and forms. */
export function isDownloadableKind(kind: KnowledgeResourceKind) {
  return kind === "policy_template" || kind === "form";
}
/**
 * Forms & Templates (2026-11-13): policy templates and forms have their own
 * page in Resources (/templates); everything else is the Library. Published
 * the same way (Super Admin); only where they're listed differs.
 */
export function isFormOrTemplate(kind: KnowledgeResourceKind) {
  return isDownloadableKind(kind);
}

export type KnowledgeResourceKind =
  | "playbook"
  | "emergency_playbook"
  | "policy_template"
  | "form"
  | "operational_guide"
  | "financial_insight"
  | "legislation_update";

export type KnowledgeResource = {
  id: string;
  kind: KnowledgeResourceKind;
  title: string;
  summary: string;
  // The full article — what renders on the resource's own detail page,
  // one paragraph per array entry. `summary` stays the one- or
  // two-sentence card/list blurb; `body` is what a reader actually came
  // for once they click through, like a blog post's lede vs. its content.
  body: string[];
  // See the doc comment above `knowledgeResources` for what each level
  // means and how `jurisdiction` relates to it.
  jurisdictionLevel: "federal" | "provincial" | "universal";
  jurisdiction: string | null; // 'BC' | 'AB' | 'QC' when provincial; null otherwise
  tags: string[];
  updatedAt: string; // display string
  checklist?: string[];
  commonMistakes?: string;
  // Plain citation strings shown on the detail page ("Act, s. N (topic)").
  // Set only where the content is genuinely tied to a specific statutory
  // provision — same "not everything goes stale" reasoning as
  // `reviewStatus` below, and in practice the two mostly travel together.
  legislationReferences?: string[];
  // Set only for content tied to a specific Act/Regulation provision or
  // threshold — the stuff that actually goes stale when the legislature
  // amends something, not every resource here. Left unset for content
  // with no legislative dependency (an operational guide, a house-policy
  // template) rather than forcing every card through a review cadence it
  // doesn't need. This is a UI-only editorial signal for now, not backed
  // by doc01's `legislation_documents` versioning yet — that table
  // tracks the Act's own text, not which playbooks/templates cite it.
  //
  // Not shown to connected council members at all — it's a maintenance
  // note for whoever authors this content ("re-check this against
  // current legislation"), not a status a member has any use for or
  // should be prompted to worry about. Shown to Super Admins
  // only, in `KnowledgeLibrary` and the resource detail page.
  reviewStatus?: "current" | "due";
};

export const knowledgeResourceKindLabels: Record<KnowledgeResourceKind, string> = {
  playbook: "Playbook",
  emergency_playbook: "Emergency Playbook",
  policy_template: "Policy Template",
  form: "Form",
  operational_guide: "Operational Guide",
  financial_insight: "Financial Insight",
  legislation_update: "Legislation Update",
};
