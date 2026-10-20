/**
 * The Library's built-in catalogue: the article kinds and their labels,
 * the template paywall rule, and the placeholder articles that show as
 * "Coming soon" until real ones are published (lib/data/library.ts holds
 * the published ones).
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
 * - `"federal"` — Canada-wide legislation (PIPEDA, for instance), which
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
 * Gating (decided): `policy_template` is the one kind behind the paywall.
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
export function isTemplateLocked(resource: Pick<KnowledgeResource, "kind">, subscribed: boolean) {
  return resource.kind === "policy_template" && !subscribed;
}
export type KnowledgeResourceKind =
  | "playbook"
  | "emergency_playbook"
  | "policy_template"
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
  operational_guide: "Operational Guide",
  financial_insight: "Financial Insight",
  legislation_update: "Legislation Update",
};

export const knowledgeResources: KnowledgeResource[] = [
  {
    id: "kb2",
    kind: "playbook",
    title: "Approving an alteration agreement",
    summary: "An owner wants to renovate and needs council sign-off — what to check before you approve, and what the agreement itself needs to say.",
    body: [
      "An alteration request is really two separate questions: does this need a vote, and does the agreement protect the strata if something goes wrong. Common property alterations typically need a 3/4 vote at a general meeting; alterations confined to the owner's own strata lot can usually be approved by council alone, but check your bylaws — some corporations have tightened this.",
      "Whatever the approval path, get the agreement in writing before work starts. It should name the contractor, require proof of liability insurance and any required permits, and spell out who's responsible for damage to common property or other units during the work. Verbal approval followed by a written agreement after the fact is the single most common way these disputes end up costly.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["alterations", "renovations", "agreements"],
    updatedAt: "May 2025",
    checklist: [
      "Confirm whether this needs a 3/4 vote (common property) or council approval alone",
      "Require proof of contractor insurance and, where relevant, permits",
      "Put the agreement in writing before work starts, not after",
      "Specify who's responsible for damage to common property or other units",
    ],
    commonMistakes: "Approving verbally, then having nothing in writing when a dispute comes up later.",
    legislationReferences: [
      "Strata Property Act, s. 71 (alterations to common property)",
      "Strata Property Act, s. 72 (repair and maintenance obligations)",
    ],
  },
  {
    id: "kb3",
    kind: "playbook",
    title: "Preparing for a depreciation report",
    summary: "Your report is due for renewal within the year — what council should line up in advance so the process doesn't stall.",
    body: [
      "Depreciation reports run on a mandated renewal cycle, and the corporations that handle them smoothly start months before the deadline, not weeks. Pull the prior report first — not to re-read it in full, but to see which of its recommendations were actually completed, since the new report will comment on exactly that gap.",
      "Decide early whether you need a full report or a 3-year update, since that changes both cost and timeline, and get the expense into the current fiscal year's budget rather than discovering it as a surprise mid-year. Recent contractor quotes for any major work completed since the last report help the engineer scope the update accurately instead of re-estimating from scratch.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["depreciation report", "planning", "reserve fund"],
    updatedAt: "Aug 2025",
    reviewStatus: "due",
    checklist: [
      "Pull the prior report and note which recommendations were actually completed",
      "Gather recent contractor quotes for any major work done since",
      "Decide whether council wants a full report or a 3-year update",
      "Budget the cost into the current fiscal year, not the next one",
    ],
    legislationReferences: ["Strata Property Act, s. 94 (depreciation reports)"],
  },
  {
    id: "kb6",
    kind: "emergency_playbook",
    title: "Fire alarm activation protocol",
    summary: "What council and on-site staff should do the moment an alarm activates, false or not.",
    body: [
      "Every activation gets treated as real until the Fire Department confirms otherwise on site — that's not overcaution, it's the only defensible posture if something does go wrong. Never silence or reset the panel before Fire Department clearance, even if staff are confident it's a false alarm.",
      "Log every activation regardless of outcome: date, cause once known, and response time. A pattern of false alarms is a maintenance signal, not a nuisance to ignore — if activations are becoming frequent, that's the moment to loop in your fire safety contractor, not after a real incident exposes the same fault.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["emergency", "fire safety"],
    updatedAt: "Sep 2026",
    checklist: [
      "Treat every activation as real until confirmed otherwise by Fire Department attendance",
      "Never silence or reset the panel before Fire Department clearance",
      "Log the activation, cause, and response time regardless of outcome",
      "Follow up with your fire safety contractor if activations are becoming frequent",
    ],
  },
  {
    id: "kb7",
    kind: "emergency_playbook",
    title: "Elevator entrapment response",
    summary: "Someone is stuck in an elevator — the correct sequence, and what not to do.",
    body: [
      "An entrapment call has one correct first move: your elevator maintenance contractor's 24-hour emergency line, not building staff attempting anything with the doors. Forcing doors open is contractor-only — untrained attempts to free a cab have caused serious injuries elsewhere and are never the right call.",
      "Keep the trapped occupant calm via the cab intercom or phone while help is en route, and reserve 911 specifically for a medical emergency inside the cab, not the entrapment itself. Most entrapments resolve within the contractor's response window without incident when the sequence is followed.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["emergency", "elevator"],
    updatedAt: "Sep 2026",
    checklist: [
      "Call your elevator maintenance contractor's 24-hour emergency line first",
      "Keep the trapped occupant calm via the cab intercom or phone",
      "Never attempt to force doors open — that's a contractor-only action",
      "Call 911 only if there's a medical emergency inside the cab",
    ],
  },
  {
    id: "kb8",
    kind: "policy_template",
    title: "Pet policy template",
    summary: "A ready-to-adapt council-level pet policy that stays within what your bylaws actually allow.",
    body: [
      "This template gives you a starting pet policy at the council level — the kind of operational detail (leash rules in common areas, registration, breed or size guidance where your bylaws allow it) that doesn't need to be a full bylaw amendment to be enforceable and useful.",
      "The one thing to check before adopting it: council policies can regulate use of common property, but they can't override what your actual bylaws already permit or restrict around pet ownership itself. If your bylaws already set a pet limit or a prohibited-breed list, this template should defer to that, not duplicate or contradict it.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["pets", "policy", "template"],
    updatedAt: "Apr 2025",
  },
  {
    id: "kb9",
    kind: "policy_template",
    title: "Short-term rental rule template",
    summary: "A rule template for restricting short-term rentals, worded to track the current provincial restrictions rather than override them.",
    body: [
      "Short-term rental rules are one of the more legally sensitive templates to adopt, because provincial restrictions already set a floor a strata bylaw or rule can't go below — or, depending on how it's worded, could inadvertently conflict with. This template is worded to track the current provincial restriction rather than duplicate or contradict it.",
      "Adopt it as a rule (council-level) rather than a bylaw where your governance structure allows that distinction, and review it whenever a legislation update flags a change to the underlying provincial rule — see the related update below.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["rentals", "policy", "template"],
    updatedAt: "Jan 2026",
    reviewStatus: "current",
    legislationReferences: ["Short-Term Rental Accommodations Act (as amended, 2026)"],
  },
  {
    id: "kb10",
    kind: "policy_template",
    title: "Move-in / move-out procedure template",
    summary: "A move coordination policy covering booking windows, elevator padding, and deposit handling.",
    body: [
      "Move coordination breaks down most often over ambiguity, not bad faith — an owner who didn't know there was a booking window, or a deposit that was never clearly explained. This template covers booking windows, elevator padding requirements, and deposit handling in one document you hand to every owner or tenant before their move.",
      "Set the refundable deposit amount and the inspection/return process explicitly; vague deposit terms are the single most common source of move-related disputes that end up in front of council.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["moves", "policy", "template"],
    updatedAt: "May 2025",
  },
  {
    id: "kb11",
    kind: "policy_template",
    title: "Bylaw contravention notice template",
    summary: "The written warning that has to go out before any fine — worded to meet the Act's notice requirements.",
    body: [
      "This is the written warning the Act requires before any fine can be issued — not optional paperwork, a legal precondition. It's worded to meet the Act's notice requirements: it has to identify the specific bylaw, describe the alleged contravention, and give the owner a genuine opportunity to respond before council decides on a fine.",
      "Use it every time, even for a bylaw you're confident about — a fine issued without this notice having gone out first is one of the most common reasons an enforcement action gets overturned at the Civil Resolution Tribunal.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["bylaws", "enforcement", "template", "notice"],
    updatedAt: "Aug 2025",
    reviewStatus: "due",
    legislationReferences: ["Strata Property Act, s. 135 (bylaw contravention notice)"],
  },
  {
    id: "kb12",
    kind: "operational_guide",
    title: "Hiring and managing a strata management company",
    summary: "What to put out to RFP, how to evaluate proposals, and what belongs in the management contract.",
    body: [
      "An RFP for a management company should ask for more than a price — request references from comparably-sized buildings, a sample of their monthly reporting package, and their approach to after-hours emergency response before comparing quotes. Price alone tells you almost nothing about whether the relationship will actually work.",
      "The management contract itself should spell out scope (what's included vs. billed separately), reporting cadence, termination notice period, and who holds signing authority for routine expenses versus what needs council sign-off. Ambiguity in any of these tends to surface as friction within the first six months, not immediately.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["strata manager", "contracts", "operations"],
    updatedAt: "Feb 2026",
  },
  {
    id: "kb13",
    kind: "operational_guide",
    title: "Setting up a maintenance request system",
    summary: "How to track owner maintenance requests so nothing falls through the cracks between council meetings.",
    body: [
      "A maintenance request system's whole job is making sure nothing gets lost in the gap between council meetings — an owner reports something, and it either gets tracked to resolution or it quietly disappears. Whatever tool you use, the requirement is the same: every request gets a timestamp, an owner, and a status.",
      "Review open requests at every council meeting, not just when someone complains about a delay. A short standing agenda item — \"open maintenance items\" — keeps the backlog visible instead of becoming a recurring source of owner frustration.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["maintenance", "operations"],
    updatedAt: "Jun 2025",
  },
  {
    id: "kb14",
    kind: "operational_guide",
    title: "Running a fair vendor RFP",
    summary: "A repeatable process for putting a major contract (landscaping, elevator, envelope work) out to bid.",
    body: [
      "A repeatable RFP process protects council from both bad outcomes and the appearance of favoritism — the same structure every time, whether it's landscaping, elevator maintenance, or envelope work. Define scope and evaluation criteria before soliciting bids, not after seeing what comes in.",
      "Get at least three bids where practical, document why the winning bid was chosen — not just price, insurance, references, and timeline matter too — and keep that documentation on file. If a losing bidder or an owner ever questions the decision, having the criteria and reasoning already written down is the difference between a five-minute answer and a drawn-out dispute.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["contracts", "vendors", "operations"],
    updatedAt: "Feb 2026",
  },
  {
    id: "kb15",
    kind: "financial_insight",
    title: "Reserve fund vs. contingency reserve fund",
    summary: "What the CRF is actually for, how the required minimum contribution is calculated, and why it isn't a slush fund for operating shortfalls.",
    body: [
      "The Contingency Reserve Fund (CRF) exists for unexpected or major expenditures — not day-to-day operating shortfalls, and not a fund council can dip into because the operating budget came in tight this year. Conflating the two is one of the most common financial-governance mistakes in strata management.",
      "The required minimum annual contribution is calculated as a percentage of the total operating budget, set out in the Act, though most corporations budget above that minimum once a depreciation report identifies real upcoming capital needs. Spending from the CRF outside of what the Act and your bylaws allow needs a general meeting resolution, not a council-only decision.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["finances", "reserve fund", "budgeting"],
    updatedAt: "Nov 2025",
    reviewStatus: "current",
    legislationReferences: [
      "Strata Property Act, s. 92 (contingency reserve fund)",
      "Strata Property Act, s. 96 (spending from the CRF)",
    ],
  },
  {
    id: "kb16",
    kind: "financial_insight",
    title: "How to read a depreciation report",
    summary: "What each section actually means for your budget, and which numbers matter most when planning special levies.",
    body: [
      "A depreciation report is dense, but only a handful of sections actually drive budget decisions: the funding model comparison (usually two or three scenarios at different contribution levels), the 30-year cash flow table, and the itemized component list with estimated remaining service life. Everything else is largely supporting detail.",
      "When planning a special levy, the cash flow table matters more than the component list — it shows you when the fund is projected to go negative under current contributions, which is the real trigger for deciding whether to raise contributions, levy, or both.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["depreciation report", "finances", "planning"],
    updatedAt: "Aug 2025",
    reviewStatus: "due",
    legislationReferences: ["Strata Property Act, s. 94 (depreciation reports)"],
  },
  {
    id: "kb17",
    kind: "financial_insight",
    title: "Special levy vs. loan: financing a major repair",
    summary: "The real tradeoffs between a one-time levy and a strata loan for a large capital project.",
    body: [
      "A special levy is simpler to approve procedurally but concentrates the full cost on current owners at once, which can be a genuine hardship depending on the amount. A strata loan spreads the cost over years through slightly higher ongoing contributions, but adds interest cost and a lender relationship the corporation now has to manage.",
      "The right choice usually comes down to the size of the project relative to what owners can absorb in a single payment, and whether the corporation has the financial track record a lender will want to see. For a large capital project, get quotes on both paths before bringing a recommendation to owners — the numbers, not a general preference, should drive the vote.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["finances", "special levy", "loans"],
    updatedAt: "Jan 2026",
    reviewStatus: "current",
    legislationReferences: [
      "Strata Property Act, s. 108 (special levies)",
      "Strata Property Act, s. 110 (borrowing)",
    ],
  },
  {
    id: "kb18",
    kind: "legislation_update",
    title: "2026 short-term rental restriction amendments",
    summary: "What changed in the provincial short-term rental rules this year, and what it means for bylaws written before the change.",
    body: [
      "The province's short-term rental restrictions were amended this year, and the practical effect for most corporations is narrower than the headlines suggested — the changes mainly tightened enforcement mechanisms and principal-residence requirements rather than rewriting what strata corporations can independently restrict.",
      "If your bylaws or rules around short-term rentals were written before this change, they're not automatically invalid, but they should be reviewed against the current provincial rule to confirm they don't conflict with or duplicate it in a way that creates ambiguity. See the short-term rental rule template for wording that already tracks the current rule.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["legislation", "rentals", "bylaws"],
    updatedAt: "Jan 2026",
    reviewStatus: "current",
    legislationReferences: ["Short-Term Rental Accommodations Act (as amended, 2026)"],
  },
  {
    id: "kb19",
    kind: "legislation_update",
    title: "Updated depreciation report requirements",
    summary: "Recent changes to the depreciation report cycle and waiver-vote threshold under the Strata Property Act.",
    body: [
      "Two things changed recently: the standard renewal cycle for depreciation reports, and the threshold required to pass a waiver vote to skip a cycle. Both matter for planning — a corporation that assumed the old cycle or the old waiver threshold could find itself non-compliant without realizing it.",
      "If your corporation has waived a depreciation report in the past, confirm the vote that approved that waiver still meets the current threshold requirement before assuming it carries forward unchanged.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["legislation", "depreciation report"],
    updatedAt: "Aug 2025",
    reviewStatus: "due",
    legislationReferences: ["Strata Property Act, s. 94 (depreciation reports, as amended)"],
  },
  {
    id: "kb20",
    kind: "legislation_update",
    title: "EV charging infrastructure right-to-charge rules",
    summary: "What council can and can't restrict when an owner requests EV charging infrastructure for their stall.",
    body: [
      "An owner requesting EV charging infrastructure for their parking stall has more statutory protection than a typical alteration request — council's ability to simply decline is narrower than it is for other common-property alterations. Reasonable conditions (cost allocation, electrical capacity, installation standards) can still be required.",
      "What council can't generally do is refuse outright on the basis that other owners might eventually want the same thing and there isn't a building-wide plan yet — that's a planning conversation worth having, but it isn't grounds to deny an individual compliant request under the current rules.",
    ],
    jurisdictionLevel: "provincial",
    jurisdiction: "BC",
    tags: ["legislation", "parking", "ev charging"],
    updatedAt: "Jun 2025",
    reviewStatus: "due",
    legislationReferences: ["Strata Property Act, EV charging infrastructure provisions (2025 amendment)"],
  },
  {
    id: "kb21",
    kind: "operational_guide",
    title: "Federal privacy law and your strata's data (PIPEDA)",
    summary: "Council handles personal information about owners and tenants every day — what the federal privacy law actually requires, on top of BC's own.",
    body: [
      "PIPEDA is federal, not provincial — it applies to every strata corporation in Canada that collects personal information in the course of a commercial activity, regardless of which province you're in. It sits alongside BC's own Personal Information Protection Act (PIPA), which covers organizations operating within BC specifically; the two overlap rather than one replacing the other, and council doesn't get to pick whichever is more convenient.",
      "In practice, this affects things council already handles routinely: owner contact information, parking/EV charging records, correspondence about a bylaw complaint, and anything uploaded to this platform. The core obligation is the same under both: collect only what you actually need, keep it reasonably secure, and don't use it for a purpose the owner wouldn't reasonably expect — a complaint file isn't a place to note unrelated opinions about a resident, for instance.",
    ],
    jurisdictionLevel: "federal",
    jurisdiction: null,
    tags: ["privacy", "data handling", "pipeda"],
    updatedAt: "Feb 2026",
    reviewStatus: "current",
    legislationReferences: ["Personal Information Protection and Electronic Documents Act (PIPEDA)"],
  },
  {
    id: "kb22",
    kind: "playbook",
    title: "Chairing a successful council meeting",
    summary: "Keeping a meeting focused, on time, and fair to everyone at the table — the chair's actual job, not just calling the room to order.",
    body: [
      "Chairing well is mostly preparation, not improvisation. Send the agenda far enough ahead that people arrive having actually read it, and open the meeting by confirming there's nothing urgent to add before locking it in — that one habit prevents most of the \"can we also talk about...\" drift that eats an hour. Time-box the agenda loosely in your own head (even if it's not printed on the page) so you notice when item three is running long before item six gets fifteen rushed minutes at the end.",
      "When disagreement shows up — and it will — the chair's job is to keep it about the decision, not let it become about the people. Restate the actual question on the table, make sure everyone who wants to speak gets a turn before anyone speaks twice, and don't be afraid to call a motion and vote once the real disagreement has been aired rather than let discussion circle. A meeting that ends on time, with clear decisions and civil disagreement on the record, is a much better outcome than one that ran long trying to reach total agreement nobody actually needed.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["meetings", "chairing", "leadership", "president"],
    updatedAt: "Sep 2026",
    checklist: [
      "Circulate the agenda early enough that people arrive having read it",
      "Confirm there's nothing to add before locking the agenda in",
      "Keep a rough mental time budget per item so no single item eats the meeting",
      "Call the vote once the real disagreement has been heard, not after it repeats",
    ],
    commonMistakes: "Letting a meeting run long trying to reach unanimous comfort on something a majority vote would have settled twenty minutes earlier.",
  },
  {
    id: "kb24",
    kind: "financial_insight",
    title: "What to look for in your utility bills",
    summary: "A monthly five-minute check that catches leaks, billing errors, and rate changes before they become a budget surprise.",
    body: [
      "Most councils only really look at a utility bill when it's shockingly high — by which point whatever caused it has usually been running for weeks. A better habit is a five-minute monthly glance, not a forensic audit: compare this month's usage (not just the dollar amount) to the same month last year, since rate changes alone can make a bill look alarming when consumption is actually flat, and a real usage spike can hide behind a rate decrease that keeps the total looking normal.",
      "A sudden jump in water usage with no obvious cause (no new residents, no unusual weather) is the single most common early signal of a slow leak somewhere in common property — worth flagging to your plumber before it shows up as visible damage. On the electrical side, watch for a step change that lines up with a specific date rather than a gradual trend; that pattern usually points to equipment (a pump, an elevator motor, exterior lighting left on) rather than seasonal demand, and is worth investigating before assuming it's just \"rates going up again.\"",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["utilities", "finances", "treasurer", "budgeting"],
    updatedAt: "Sep 2026",
  },
  {
    id: "kb25",
    kind: "operational_guide",
    title: "President best practices",
    summary: "What separates an effective chair from a technically compliant one — the President role beyond the bare legal minimum.",
    body: [
      "The Act gives the President one formal duty — chairing meetings — but the role that actually matters day to day is being the person who keeps council functioning as a group between meetings, not just running the room when it's in session. That means following up on action items before the next meeting rather than at it, being the point of contact when an urgent decision can't wait for a quorum, and making sure quieter council members actually get heard, not just the two or three people who naturally talk the most.",
      "The best presidents delegate deliberately rather than accumulating everything themselves out of a sense of responsibility — a treasurer who never gets asked to own the budget conversation, or a secretary whose minutes are quietly rewritten after the fact, ends up disengaged fast. Set the tone in your first few meetings for how disagreement gets handled (see \"Chairing a successful council meeting\"), since that tone, once set, is hard to change later in your term.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["president", "leadership", "roles"],
    updatedAt: "Sep 2026",
  },
  {
    id: "kb26",
    kind: "operational_guide",
    title: "Vice President best practices",
    summary: "The VP role is easy to leave undefined until the President is suddenly unavailable — what to actually prepare for in advance.",
    body: [
      "Most VPs spend a term without ever formally stepping in, which is exactly why the role tends to be under-defined — there's no forcing function to clarify it until the President is unexpectedly unreachable and someone needs to chair a meeting with no notice. Don't wait for that moment: sit in on at least one meeting's worth of prep with the President beforehand (how the agenda gets built, what's likely to be contentious) so stepping in isn't a cold start.",
      "Beyond succession-readiness, the most useful ongoing VP role is a genuine second set of eyes — reviewing the agenda before it goes out, catching what the President might have missed, and being a sounding board on anything sensitive before it reaches the full table. A VP who only exists on paper as \"backup\" is a missed seat; a VP who's actually briefed makes the whole council more resilient, not just insured against one person's absence.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["vice-president", "roles", "leadership"],
    updatedAt: "Sep 2026",
  },
  {
    id: "kb27",
    kind: "operational_guide",
    title: "Treasurer best practices",
    summary: "Beyond paying bills on time — what a treasurer should be watching month to month so nothing surprises council at year-end.",
    body: [
      "Paying invoices and keeping the books balanced is the baseline, not the job. A treasurer who's actually adding value is watching the operating budget against actuals every month, not just at year-end reconciliation — a category running consistently over budget in month four is a much easier conversation to have with council in month five than a surprise deficit explained after the fact in month twelve.",
      "The contingency reserve fund deserves its own separate attention from the operating budget — see \"Reserve fund vs. contingency reserve fund\" elsewhere in this library for why conflating the two is one of the most common governance mistakes. Bring the depreciation report's cash-flow projections into your own planning rather than treating that report as something that happens to the corporation every few years; it's the best long-range budgeting tool council already has, and a treasurer who reads it closely is the person best positioned to flag a coming shortfall early.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["treasurer", "finances", "roles"],
    updatedAt: "Sep 2026",
  },
  {
    id: "kb28",
    kind: "operational_guide",
    title: "Secretary best practices",
    summary: "Minutes and records are the corporation's legal memory — what a secretary needs to get right, every single meeting.",
    body: [
      "Minutes aren't a summary for people who missed the meeting — they're the corporation's legal record of what was decided, and years later they're what a dispute, an insurance claim, or a Civil Resolution Tribunal filing will actually rely on. Every motion needs its mover, seconder, and exact vote count recorded, not just whether it carried; \"the motion passed\" without the count behind it is a much weaker record than it looks like in the moment.",
      "Draft minutes while the meeting is still fresh, not days later from memory or scattered notes — accuracy drops fast once details blur together. Keep a consistent structure meeting to meeting (attendance, motions in the order raised, action items with owners) so anyone pulling up a year-old record can find what they need quickly, and circulate draft minutes for review promptly rather than letting them sit unfinalized, since an unfinalized record is of limited use if something needs to be referenced before the next meeting approves them.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["secretary", "records", "roles"],
    updatedAt: "Sep 2026",
  },
  {
    id: "kb29",
    kind: "operational_guide",
    title: "Member at Large best practices",
    summary: "No portfolio doesn't mean no responsibility — how a MaL adds real value without a defined officer role.",
    body: [
      "A Member at Large has no statutory duties the way the President, Treasurer, or Secretary do, and it's easy to let that translate into showing up, voting, and little else. The MaLs who add the most value pick an informal area of ownership anyway — landscaping, a specific committee, keeping an eye on a particular vendor relationship — rather than waiting to be assigned one, since council's four defined officers already have full plates.",
      "The other real value a MaL brings is perspective the officers don't have time to hold: reading correspondence and owner complaints with fresh eyes, asking the question an officer is too close to the file to ask, and being a second or third voice in a room that can otherwise default to whoever's already speaking most. A MaL who treats the role as \"no portfolio, no responsibility\" is leaving real value on the table — the best ones function as a genuine extra set of hands, not just an extra vote.",
    ],
    jurisdictionLevel: "universal",
    jurisdiction: null,
    tags: ["mal", "roles"],
    updatedAt: "Sep 2026",
  },
];
