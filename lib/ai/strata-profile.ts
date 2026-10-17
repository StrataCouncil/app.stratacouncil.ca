/**
 * The strata profile Stratasphere reads with every question: everything
 * the asking member can see on the platform about their strata (Jeremy,
 * 2026-10-16: "The Stratasphere has to see EVERYTHING on the platform"),
 * laid out as text. Pure: the caller loads the rows (through the member's
 * own access, so nothing they couldn't open is included) and supplies the
 * PII stripper for free text.
 *
 * No name, email or phone number tied to a strata lot ever leaves (PIPA;
 * Jeremy, 2026-10-16): every owner is referred to by lot number, whether a
 * person or a company, and a code ("Owner A", "Company B") ties together
 * the lots one owner holds, so Stratasphere can count and group them. The
 * strata manager is named by company only. Not included: members' chats,
 * Council Training and billing, which stay private.
 */

export interface ProfileLot {
  lot: string;
  unit: string | null;
  entitlement: number | null;
  ownerType: string | null;
  ownerName: string | null;
  parking: string | null;
  storage: string | null;
  bikeRack: string | null;
  fees: number | null;
  isCouncil: boolean;
  role: string | null;
}

export interface ProfileMeeting {
  date: string;
  type: string;
  status: string;
  format: string;
  minutesState: string | null;
  trial: boolean;
  location: string | null;
  chair: string | null;
  presentLots: number;
  agenda: Array<{ num: number; cat: string; text: string; type: string; done: boolean; deferred: boolean; outcome: string | null }>;
}

export interface StrataProfileData {
  corp: { planNumber: string; legalName: string; buildingName: string | null; address: string; unitCount: number; jurisdiction: string };
  management: { company: string | null; website: string | null; managers: number } | null;
  lots: ProfileLot[];
  platformRoles: Array<{ role: string; count: number }>;
  members: { active: number; invited: number };
  meetings: ProfileMeeting[];
  documents: Array<{ title: string; category: string | null; uploadedAt: string; current: boolean }>;
  announcements: Array<{ title: string; body: string; publishedAt: string }>;
  library: Array<{ title: string; kind: string; summary: string }>;
}

const COMPANY =
  /\b(?:ltd|limited|inc|incorporated|corp|corporation|company|co|llc|llp|lp|ulc|developments?|holdings?|properties|enterprises?|investments?|ventures|realty|homes|builders?|construction|group|partnership|society|association)\b\.?/i;
const NUMBERED_COMPANY = /^\s*\d{6,}\s+(?:B\.?\s?C\.?|Canada|Alberta|Ontario)\b/i;

/** A registered owner that's a business, not a person ("Selkirks Developments Ltd.", "1234567 B.C. Ltd."). */
export function isCompanyName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  // "Smith Family Trust" names a family; trusts stay private.
  if (/\btrust\b/i.test(n)) return false;
  return NUMBERED_COMPANY.test(n) || COMPANY.test(n);
}

const ROLE_LABELS: Record<string, string> = {
  president: "President",
  vice_president: "Vice President",
  treasurer: "Treasurer",
  secretary: "Secretary",
  member_at_large: "Member at Large",
  admin: "Admin",
  manager: "Strata Manager",
};
const label = (role: string) => ROLE_LABELS[role] ?? role.replace(/_/g, " ");

const OWNER_TYPES: Record<string, string> = { owner: "owner", tenant: "tenant", strata_agent: "strata agent" };

function money(n: number) {
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Owner A" … "Owner Z", "Owner AA" … (or "Company A" …). */
function ownerCode(i: number, kind: "Owner" | "Company") {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${kind} ${s}`;
}

const ownerKey = (name: string | null) => (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The code for each owner who holds more than one lot ("Owner A",
 * "Company A"), in lot order. The roster and the PII stripper
 * (lib/kb/privacy.ts) both use it, so a document's "Company A" is the
 * roster's "Company A".
 */
export function ownerCodes(lots: Array<{ lot: string; ownerName: string | null }>) {
  const byOwner = new Map<string, string[]>();
  for (const l of [...lots].sort((a, b) => a.lot.localeCompare(b.lot, "en", { numeric: true }))) {
    const key = ownerKey(l.ownerName);
    if (key) byOwner.set(key, [...(byOwner.get(key) ?? []), l.lot]);
  }
  const codes = new Map<string, string>();
  let people = 0;
  let companies = 0;
  for (const [key, ls] of byOwner) {
    if (ls.length < 2) continue;
    const company = isCompanyName(key);
    codes.set(key, ownerCode(company ? companies++ : people++, company ? "Company" : "Owner"));
  }
  return { codes, byOwner, key: ownerKey };
}

function rosterSection(lots: ProfileLot[]) {
  if (!lots.length) return "No lots on the roster.";
  // Lots one owner holds share a code; no owner is ever named.
  const { codes, byOwner } = ownerCodes(lots);

  const lines = lots.map((l) => {
    const key = ownerKey(l.ownerName);
    const type = OWNER_TYPES[l.ownerType ?? ""] ?? "owner";
    const who = !key ? "no owner on file" : `${type}: ${codes.get(key) ?? (isCompanyName(key) ? "a company" : "an individual")}`;
    const parts = [
      l.lot,
      l.unit ? `unit ${l.unit}` : null,
      l.entitlement != null ? `UE ${l.entitlement}` : null,
      who,
      l.fees != null ? `fees ${money(l.fees)}/month` : null,
      l.parking ? `parking ${l.parking}` : null,
      l.storage ? `storage ${l.storage}` : null,
      l.bikeRack ? `bike rack ${l.bikeRack}` : null,
      l.isCouncil || l.role ? `council${l.role ? ` (${label(l.role)})` : ""}` : null,
    ];
    return parts.filter(Boolean).join(" | ");
  });

  const ue = lots.reduce((s, l) => s + (l.entitlement ?? 0), 0);
  const fees = lots.reduce((s, l) => s + (l.fees ?? 0), 0);
  const companyLots = lots.filter((l) => isCompanyName(l.ownerName)).length;
  const summary = [
    `${lots.length} lots. Total unit entitlement ${ue || "not on file"}.${fees ? ` Total monthly strata fees ${money(fees)}.` : ""}`,
    `${companyLots} lot${companyLots === 1 ? "" : "s"} owned by companies; ${lots.filter((l) => ownerKey(l.ownerName) && !isCompanyName(l.ownerName)).length} by individuals; ${lots.filter((l) => !ownerKey(l.ownerName)).length} with no owner on file.`,
    ...[...byOwner.entries()]
      .filter(([key]) => codes.has(key))
      .map(([key, ls]) => `${codes.get(key)} (${isCompanyName(key) ? "a company" : "an individual"}) is listed on ${ls.length} lots: ${ls.join(", ")}.`),
  ];
  return `${summary.join("\n")}\n\n${lines.join("\n")}`;
}

function meetingsSection(meetings: ProfileMeeting[], strip: (s: string) => string) {
  if (!meetings.length) return "No meetings on the platform yet.";
  return meetings
    .map((m) => {
      const head = [
        `${m.date} ${m.type}`,
        m.status === "DRAFT" ? "planned (not yet held)" : m.status === "LIVE" ? "in progress" : "held",
        m.format,
        m.location ? `at ${strip(m.location)}` : null,
        m.chair ? `chair ${strip(m.chair)}` : null,
        m.status === "ADJOURNED" ? `${m.presentLots} lots present` : null,
        m.minutesState ? `minutes ${m.minutesState === "FINAL" ? "final" : "draft"}` : null,
        m.trial ? "trial meeting" : null,
      ]
        .filter(Boolean)
        .join(", ");
      if (!m.agenda.length) return `- ${head}. No agenda items.`;
      const items = m.agenda.map((it) => {
        const state = it.outcome ? ` — ${it.outcome}` : it.deferred ? " — deferred" : it.done ? " — done" : "";
        return `    ${it.num}. ${strip(it.text)} (${strip(it.cat)}; ${it.type.replace(/_/g, " ").toLowerCase()})${state}`;
      });
      return `- ${head}. Agenda:\n${items.join("\n")}`;
    })
    .join("\n");
}

export function buildStrataProfile(d: StrataProfileData, strip: (s: string) => string): string {
  const c = d.corp;
  const sections: Array<[string, string]> = [
    [
      "STRATA CORPORATION",
      [
        `Strata Plan ${c.planNumber}. Legal name: ${c.legalName}.${c.buildingName ? ` Building name: ${c.buildingName}.` : ""}`,
        `Address: ${c.address}. ${c.unitCount} strata lots. Jurisdiction: ${c.jurisdiction}.`,
        d.management?.company
          ? `Strata management company: ${d.management.company}${d.management.website ? ` (${d.management.website})` : ""}, ${d.management.managers} strata manager${d.management.managers === 1 ? "" : "s"} listed.`
          : "Self-managed: no strata management company on file.",
        `Platform members: ${d.members.active} active, ${d.members.invited} invited.${d.platformRoles.length ? ` Platform roles: ${d.platformRoles.map((r) => `${label(r.role)} ×${r.count}`).join(", ")}.` : ""}`,
      ].join("\n"),
    ],
    [
      "OWNER ROSTER (one line per strata lot; owners are never named: lots one owner holds share an Owner or Company code)",
      rosterSection(d.lots),
    ],
    [
      "COUNCIL (from the roster)",
      d.lots.some((l) => l.isCouncil || l.role)
        ? d.lots
            .filter((l) => l.isCouncil || l.role)
            .map((l) => `${l.lot}: ${l.role ? label(l.role) : "council member"}`)
            .join("\n")
        : "No council members marked on the roster.",
    ],
    ["MEETINGS ON THE PLATFORM (newest first)", meetingsSection(d.meetings, strip)],
    [
      "DOCUMENTS ON FILE (title, folder, upload date; the text of each is searched separately)",
      d.documents.length
        ? d.documents
            .map((doc) => `- ${strip(doc.title)} | ${doc.category ?? "no folder"} | uploaded ${doc.uploadedAt.slice(0, 10)}${doc.current ? "" : " | superseded by a newer version"}`)
            .join("\n")
        : "No documents uploaded.",
    ],
    [
      "PLATFORM ANNOUNCEMENTS (from StrataCouncil.ca)",
      d.announcements.length ? d.announcements.map((a) => `- ${a.publishedAt.slice(0, 10)} ${a.title}: ${a.body}`).join("\n") : "None current.",
    ],
    [
      "STRATACOUNCIL.CA LIBRARY (general playbooks, guides and templates, not this strata's own documents)",
      d.library.length ? d.library.map((l) => `- ${l.title} (${l.kind.replace(/_/g, " ")}): ${l.summary}`).join("\n") : "Nothing published.",
    ],
  ];
  return sections.map(([title, body]) => `=== ${title} ===\n${body}`).join("\n\n");
}
