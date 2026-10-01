/**
 * PII stripping — the one gate every piece of text passes through before
 * it leaves our database for a third-party AI service (Voyage embeddings,
 * Anthropic). doc02 §2, and the standing rule that anything fed to
 * Stratasphere must be PIPA/PIPEDA-compliant.
 *
 * Pure, deterministic, no network: stripping must never itself send the
 * text anywhere (a model-based detector would defeat the point).
 *
 * Layers, in order:
 *   0. Emails and URLs first, before anything can rewrite the names inside
 *      them. URLs keep their host and lose the path and query.
 *   1. Known people. Every name the strata knows — owners and council
 *      delegates on the lot roster, connected members — is replaced
 *      exactly: an owner's name becomes their lot number ("SL061"), anyone
 *      else becomes "[Council Member]". Then any remaining first name or
 *      surname of a known person is redacted on its own (capitalised or
 *      ALL CAPS — "Ms. Chen", "Sally said", "CHEN"), so a partial mention
 *      doesn't survive because only the full name was listed.
 *   2. Patterns: dates of birth, payment cards (Luhn-checked), SIN, bank
 *      transit/account numbers, phone numbers, street addresses, postal
 *      codes, honorific + name, licence plates and policy/account
 *      identifiers.
 *   3. Unknown names. Each run of capitalised words is split at
 *      vocabulary words (governance, legal, building, business, place,
 *      calendar, common English), and what's left is redacted when it
 *      looks like a name: two or more unknown words ("John Smith",
 *      "President Sally Johnson" → "President [name redacted]"), an
 *      initial and a word ("J. Smith"), or a single word next to a role
 *      title or a speech verb ("Treasurer Kevin", "Kevin noted", "moved by
 *      Kevin"). ALL CAPS runs get the same treatment.
 *
 * Every replacement is sealed as it's made, so no later layer can match
 * inside one (an inserted "SL061" is never re-read as an identifier).
 *
 * Always preserved: strata lot references (SL061, SL 61), strata plan
 * numbers (EPS9048, BCS-1234 — public LTSA records), role titles.
 *
 * Known limits, stated rather than hidden: a lone first name of someone
 * the strata doesn't know, with no role title or speech verb beside it
 * ("ask Kevin about it"); a name written all in lower case; a name fused
 * with other text. In the other direction, a capitalised heading or a
 * business name made of words outside the vocabulary is over-redacted —
 * the deliberate cost of the stricter rule. Layer 1 is why the roster
 * matters: it's exact for everyone the strata actually has on file.
 */

export interface KnownPerson {
  name: string;
  /** Present for owners on the lot roster: their name is replaced by this. */
  lotNumber?: string | null;
}

export const PII_PLACEHOLDER = {
  name: "[name redacted]",
  member: "[Council Member]",
  email: "[email redacted]",
  phone: "[phone redacted]",
  sin: "[SIN redacted]",
  card: "[payment info redacted]",
  bank: "[banking info redacted]",
  address: "[address redacted]",
  postal: "[postal code redacted]",
  id: "[identifier redacted]",
  dob: "[date of birth redacted]",
} as const;
const P = PII_PLACEHOLDER;

// Words that are not part of a person's name. Lower-cased. Deliberately
// broad: the stricter rule redacts anything capitalised that isn't here.
const VOCABULARY = new Set(
  `
  a an the this that these those there their they them we our us you your it its he she his her him i my me
  and or but if then than so as at by for from in into of on onto to up down out off with within without
  about above across after against along among around because before behind below beside besides between
  beyond during except inside near outside over past per since through throughout toward towards under
  until upon via re cc attn regarding subject dear sincerely regards thanks thank please yours truly
  note notes notice noted moved seconded carried defeated tabled deferred approved received resolved
  whereas therefore however also further furthermore following followed discussion discussed discuss
  afterwards afterward later meanwhile finally additionally unfortunately currently again already still
  accordingly subsequently previously recently instead otherwise thus hence once only just even
  be is are was were been being has have had do does did done will would shall should can could may might
  must not no yes all any each every some none both either neither several many much more most few less
  least other others another such same new old next last first second third fourth fifth final draft
  previous prior current recent upcoming pending open closed complete completed incomplete ongoing
  one two three four five six seven eight nine ten eleven twelve hundred thousand million
  monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday
  january february march april may june july august september october november december
  spring summer fall autumn winter am pm pst pdt mst mdt est edt noon midnight morning afternoon evening
  what when where which who whom whose why how here everyone everybody someone somebody anyone nobody
  welcome hello hi good morning call called order adjourn adjourned adjournment opened closed
  strata property act regulation regulations bylaw bylaws rule rules council councillor councillors
  owners owner tenant tenants occupant occupants resident residents landlord corporation corporations
  plan plans lot lots unit units common limited section sections subsection part parts schedule schedules
  form forms division article clause clauses item items appendix exhibit attachment attachments page
  annual general special meeting meetings minutes agenda agendas motion motions resolution resolutions
  vote votes voting quorum proxy proxies chair chairperson president vice treasurer secretary member
  members manager managers management agent agents broker brokerage representative delegate committee
  committees council's owner's chair's attendance present absent regrets guest guests observer observers
  contingency reserve fund funds operating budget budgets depreciation report reports financial finance
  finances statement statements levy levies fee fees fiscal year years month months quarter week weeks
  insurance insurer policy policies premium deductible claim claims appraisal audit accountant auditor
  legal lawyer lawyers counsel notice notices bank account accounts invoice invoices payment payments
  receivable receivables payable payables arrears interest balance cash revenue expense expenses income
  cost costs quote quotes quotation estimate estimates tender tenders bid bids proposal proposals contract
  contracts agreement agreements renewal renewals approval decision decisions direction ratification
  business old new unfinished action actions update updates review reviews summary overview
  building buildings construction maintenance repair repairs replacement replace project projects roof
  roofing envelope parkade parking stall stalls storage locker lockers bike bicycle rack elevator elevators
  boiler boilers plumbing electric electrical mechanical hvac fire code codes safety alarm alarms sprinkler
  sprinklers window windows door doors balcony balconies deck decks patio patios garden gardens
  landscaping landscape pool gym lobby hallway hallways amenity amenities room rooms garage gate gates
  water sewer gas hydro heating cooling ventilation exterior interior entrance entry exit stairwell
  stairs carpet paint painting lighting lights camera cameras access fob fobs key keys intercom
  garbage recycling compost collection pickup snow removal cleaning cleaner janitorial inspection
  inspections warranty leak leaks flood flooding mould mold damage pest pests noise smoke smoking pets pet
  dog dogs cat cats rental rentals short term long move moves moving renovation renovations alteration
  alterations complaint complaints infraction infractions fine fines hearing hearings dispute disputes
  north south east west northeast northwest southeast southwest upper lower main street avenue road
  drive boulevard way place court crescent lane highway suite floor floors level levels tower towers block
  city town village district municipality municipal county province provincial federal government
  ministry british columbia canada canadian vancouver victoria burnaby surrey richmond coquitlam kelowna
  kamloops nanaimo langley abbotsford delta saanich chilliwack whistler squamish port moody maple ridge
  pitt meadows white rock new westminster penticton vernon prince george pacific island mainland
  okanagan fraser valley
  civil tribunal supreme registry land title titles survey authority ltsa bcfsa spa crt cra
  personal information protection privacy real estate services institutions
  ltd inc incorporated corp company co llp llc group services service solutions contracting
  contractors contractor consulting consultants engineering engineers associates partners holdings
  properties realty systems supply supplies industries enterprises restoration
  security flooring glass control waste disposal credit union trust
  standard acts department office board association society organization
  mr mrs ms dr miss mx sir madam
  terrace trail close parkway circle square mews gardens park estates heights residences manor village
  residential commercial mixed use zoom teams online virtual hybrid person phone video conference
  held hold holds attended provided submitted presented reviewed accepted rejected considered
  stratasphere stratacouncil
`
    .split(/\s+/)
    .filter(Boolean)
);

/** Words that, right before a lone unknown capitalised word, mark it as a name. */
const TITLE_WORDS = new Set(
  `president vice treasurer secretary chair chairperson councillor member owner owners tenant
   occupant resident manager agent delegate representative landlord mr mrs ms dr miss mx`.split(/\s+/)
);

const SPEECH_AFTER =
  /^\s+(?:said|says|noted|notes|asked|asks|reported|reports|stated|states|moved|seconded|advised|advises|requested|requests|complained|explained|confirmed|agreed|indicated|suggested|mentioned|proposed|replied|responded|wrote|writes|called|emailed|attended|joined|arrived|left|declared|abstained|voted|objected|thanked)\b/i;
const CONTEXT_BEFORE =
  /\b(?:by|from|with|thanked|asked|told|cc|attn|contact|contacted|called|emailed|per|owner|tenant|resident|occupant)\s*:?\s+$/i;

/** Public codes that look like the identifier pattern but must stay. */
const KEEP_CODES = new Set([
  "SPA", "CRF", "AGM", "SGM", "SPR", "CRT", "CRA", "GST", "PST", "HST", "LTD", "INC", "PDF", "BC", "FY",
  "ISO", "CSA", "ULC", "BCBC", "NFPA", "HVAC", "AM", "PM", "QTY", "NO",
]);

// Sealed replacements:  + index in private-use "hex digits" + .
// None of these characters is a letter, digit or space, so no pattern can
// match inside or through a sealed span.
const SEAL_OPEN = "";
const SEAL_CLOSE = "";
const SEALED = /([-]+)/g;

class Vault {
  private items: Array<{ text: string; original?: string }> = [];
  private refByOriginal = new Map<string, string>();
  readonly refs = new Map<string, string>();

  /** `original` is what was replaced; pseudonymizing restores it later. */
  seal = (text: string, original?: string) => {
    const idx = (this.items.push({ text, original }) - 1)
      .toString(16)
      .split("")
      .map((c) => String.fromCharCode(0xe100 + parseInt(c, 16)))
      .join("");
    return SEAL_OPEN + idx + SEAL_CLOSE;
  };

  restore(text: string, mode: "strip" | "pseudonymize" = "strip") {
    return text.replace(SEALED, (_, idx: string) => {
      const n = parseInt(
        idx
          .split("")
          .map((c) => (c.charCodeAt(0) - 0xe100).toString(16))
          .join(""),
        16
      );
      const item = this.items[n];
      if (!item) return "";
      if (mode === "strip" || item.original === undefined) return item.text;
      const key = item.original.trim();
      let ref = this.refByOriginal.get(key);
      if (!ref) {
        ref = `[REF-${this.refByOriginal.size + 1}]`;
        this.refByOriginal.set(key, ref);
        this.refs.set(ref, key);
      }
      return ref;
    });
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function luhn(digits: string) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const isVocab = (word: string) =>
  VOCABULARY.has(
    word
      .toLowerCase()
      .replace(/['’]s$/, "")
      .replace(/[^\p{L}]/gu, "")
  );

/** Layer 0 + protected spans: lot refs, plan numbers, emails, URLs. */
function sealFixed(text: string, v: Vault) {
  return (
    text
      .replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, (url) => {
        try {
          const u = new URL(url);
          const rest = url.length > u.origin.length + 1;
          return v.seal(u.origin + (rest ? "/[path redacted]" : url.slice(u.origin.length)), url);
        } catch {
          return v.seal("[link redacted]", url);
        }
      })
      .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, (m) => v.seal(P.email, m))
      .replace(/\bSL\s?-?\d{1,4}\b/g, (m) => v.seal(m))
      .replace(/\b(?:BCS|EPS|LMS|VAS|VIS|KAS|NES|NWS|EPP|BCP|LMP|VIP|KAP)\s?-?\d{2,6}\b/g, (m) => v.seal(m))
  );
}

/** Layer 1: exact replacement of everyone the strata knows. */
function stripKnown(text: string, people: KnownPerson[], v: Vault) {
  const named = people
    .map((p) => ({ name: (p.name ?? "").trim().replace(/\s+/g, " "), lot: p.lotNumber?.trim() || null }))
    .filter((p) => p.name.length >= 2);

  // Longest first, so "Mary Anne Chen" is replaced before "Anne Chen".
  named.sort((a, b) => b.name.length - a.name.length);

  const bound = (body: string) => `(?<![\\p{L}\\p{N}])${body}(?:['’]s)?(?![\\p{L}\\p{N}])`;
  const flex = (s: string) => escapeRegExp(s).replace(/ /g, "\\s+");

  let out = text;
  for (const p of named) {
    const parts = p.name.split(" ");
    const replacement = (m: string) => v.seal(p.lot ?? P.member, m);
    const variants = [p.name];
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const given = parts.slice(0, -1).join(" ");
      variants.push(`${last}, ${given}`, `${last}, ${first}`, `${first} ${last}`, `${first[0]}. ${last}`, `${first[0]} ${last}`);
    }
    for (const variant of variants) {
      out = out.replace(new RegExp(bound(flex(variant)), "giu"), replacement);
    }
  }

  // Leftover single tokens of known names (first names, surnames), matched
  // capitalised or ALL CAPS only — so a member called Will or Mark doesn't
  // take "will" and "mark" out of every sentence.
  const tokens = new Set<string>();
  for (const p of named) {
    for (const t of p.name.split(" ")) {
      const clean = t.replace(/[^\p{L}\p{M}'’-]/gu, "");
      if (clean.length >= 3 && !isVocab(clean)) {
        const cap = clean[0].toUpperCase() + clean.slice(1);
        tokens.add(cap);
        tokens.add(clean.toUpperCase());
        if (clean !== cap) tokens.add(clean); // "McDonald", "DeLuca" as written
      }
    }
  }
  for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(bound(escapeRegExp(t)), "gu"), (m) => v.seal(P.name, m));
  }

  // Known first names that are also ordinary words ("Will", "Mark", "Bill")
  // only go when the context says it's the person: after a role title or
  // before a speech verb.
  const wordNames = new Set<string>();
  for (const p of named) {
    for (const t of p.name.split(" ")) {
      const clean = t.replace(/[^\p{L}\p{M}'’-]/gu, "");
      if (clean.length >= 3 && isVocab(clean)) wordNames.add(clean[0].toUpperCase() + clean.slice(1).toLowerCase());
    }
  }
  for (const t of wordNames) {
    const titles = [...TITLE_WORDS].join("|");
    out = out
      .replace(new RegExp(`(?<=\\b(?:${titles})\\.?\\s+)${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, "giu"), (m) =>
        m[0] === m[0].toUpperCase() ? v.seal(P.name, m) : m
      )
      .replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${escapeRegExp(t)}|${escapeRegExp(t.toUpperCase())})(?=${SPEECH_AFTER.source.slice(1)})`, "gu"), (m) =>
        v.seal(P.name, m)
      );
  }
  return out;
}

const STREET_TYPES =
  "Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Court|Ct|Crescent|Cres|Lane|Ln|Highway|Hwy|Terrace|Trail|Close|Parkway|Pkwy|Circle|Square|Mews|Gate|Row|Walk";

/** Layer 2: structured identifiers. Order matters (most specific first). */
function stripPatterns(text: string, v: Vault) {
  const s = (placeholder: string) => (m: string) => v.seal(placeholder, m);
  return (
    text
      // Dates of birth, when labelled as such.
      .replace(
        /\b(?:DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?)\s*:?\s*(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\p{L}+\.? \d{1,2},? \d{4}|\d{1,2} \p{L}+\.? \d{4})/giu,
        s(P.dob)
      )
      // Payment cards: 13–19 digits, optional space/dash groups, Luhn-valid.
      .replace(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g, (m) => {
        const digits = m.replace(/\D/g, "");
        return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? v.seal(P.card, m) : m;
      })
      // Bank: transit(5)-institution(3)-account(7–12), any separator.
      .replace(/(?<!\d)\d{5}[ -]?\d{3}[ -]?\d{7,12}(?!\d)/g, s(P.bank))
      // SIN: 3-3-3 with separators, or 9 digits when labelled.
      .replace(/(?<![\d-])\d{3}[ -]\d{3}[ -]\d{3}(?![\d-])/g, s(P.sin))
      .replace(/\b(?:SIN|social insurance(?: number)?)\s*(?:#|no\.?|number)?\s*:?\s*\d{9}\b/gi, s(P.sin))
      // Phone numbers (North American), with optional +1 and extension.
      .replace(
        /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,5})?(?![\d-])/gi,
        s(P.phone)
      )
      // Street addresses: number (optionally unit-number), 1–4 capitalised
      // words, street type. Case-sensitive, so "12 owners went to court" stays.
      .replace(
        new RegExp(
          `(?:#\\s?\\d{1,5}\\s*[-–]\\s*|\\b(?:[Uu]nit|UNIT|[Ss]uite|SUITE|[Aa]pt\\.?)\\s*\\d{1,5}[,\\s-]+)?\\b\\d{1,6}(?:[-–]\\d{1,6})?[A-Za-z]?\\s+(?:\\p{Lu}[\\p{L}'.-]*\\s+){1,4}(?:${STREET_TYPES})\\b\\.?(?:\\s+(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\\b)?`,
          "gu"
        ),
        s(P.address)
      )
      // Canadian postal codes.
      .replace(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi, s(P.postal))
      // Honorific + name ("Mrs. Chen", "Dr Patel", "Ms. Mary-Anne O'Brien").
      .replace(
        /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Mme|Mlle|Sr|Sra)\.?\s+\p{Lu}[\p{L}\p{M}'’-]+(?:\s+\p{Lu}[\p{L}\p{M}'’-]+)?/gu,
        s(P.name)
      )
      // Licence plates and policy/account-style identifiers.
      .replace(/\b[A-Z]{2,4}[ -]?\d{3,12}\b|\b\d{3}[ -]?[A-Z]{3}\b|\b[A-Z]{2}\d[ -]?\d{2}[A-Z]\b/g, (m) =>
        KEEP_CODES.has(m.replace(/[\s\d-]/g, "")) ? m : v.seal(P.id, m)
      )
      .replace(
        /\b(?:policy|account|acct|member|client|customer|licen[cs]e|plate|file|claim|certificate|cert|driver'?s licen[cs]e|DL|passport|health card|PHN|MSP|care card)\s*(?:#|no\.?|number|num\.?)\s*:?\s*[A-Z0-9][A-Z0-9-]{3,}/gi,
        s(P.id)
      )
  );
}

// A capitalised word ("Smith", "McDonald", "O'Brien", "Smith-Jones",
// "Côté") or an initial ("J."). Runs stay on one line, so a heading
// never merges with the line below it.
const WORD = String.raw`\p{Lu}[\p{L}\p{M}'’]*(?:-\p{Lu}[\p{L}\p{M}'’]*)*`;
const INITIAL = String.raw`\p{Lu}\.(?=\s)`;
const RUN = new RegExp(
  String.raw`(?<![\p{L}\p{N}'’-])(?:${INITIAL}|${WORD})(?:[ \t]+(?:${INITIAL}|${WORD}))*(?![\p{L}\p{N}])`,
  "gu"
);

type Kind = "vocab" | "initial" | "candidate";

/** Layer 3: capitalised runs, split at vocabulary, unknown segments redacted. */
function stripLikelyNames(text: string, v: Vault) {
  return text.replace(RUN, (run: string, offset: number) => {
    const words = [...run.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index! }));
    const kind = (w: string): Kind => {
      if (/^\p{Lu}\.$/u.test(w)) return "initial";
      const lettersOnly = w.replace(/['’]s$/, "").replace(/[^\p{L}]/gu, "");
      if (lettersOnly.length <= 1 || isVocab(w) || KEEP_CODES.has(lettersOnly)) return "vocab";
      const allCaps = lettersOnly === lettersOnly.toUpperCase();
      // ALL CAPS: two letters could be a code, longer reads as a word.
      if (allCaps && lettersOnly.length <= 2) return "vocab";
      return "candidate";
    };
    const kinds = words.map((w) => kind(w.text));

    // Group into maximal non-vocab segments.
    const redact = new Array(words.length).fill(false);
    let i = 0;
    while (i < words.length) {
      if (kinds[i] === "vocab") {
        i++;
        continue;
      }
      let j = i;
      while (j < words.length && kinds[j] !== "vocab") j++;
      const seg = kinds.slice(i, j);
      const candidates = seg.filter((k) => k === "candidate").length;
      const initials = seg.length - candidates;
      let isName = candidates >= 2 || (candidates === 1 && initials >= 1);
      if (!isName && candidates === 1) {
        const prevWord = i > 0 ? words[i - 1].text.toLowerCase().replace(/[^\p{L}]/gu, "") : null;
        const before = text.slice(Math.max(0, offset + words[i].at - 40), offset + words[i].at);
        const after = text.slice(offset + words[j - 1].at + words[j - 1].text.length);
        isName =
          (prevWord !== null && TITLE_WORDS.has(prevWord)) ||
          (i === 0 && CONTEXT_BEFORE.test(before)) ||
          (j === words.length && SPEECH_AFTER.test(after));
      }
      if (isName) for (let k = i; k < j; k++) redact[k] = true;
      i = j;
    }
    if (!redact.some(Boolean)) return run;

    // Rebuild, collapsing each redacted segment into one placeholder.
    let out = "";
    let cursor = 0;
    for (let k = 0; k < words.length; k++) {
      if (!redact[k]) continue;
      let end = k;
      while (end + 1 < words.length && redact[end + 1]) end++;
      const poss = words[end].text.match(/['’]s$/);
      const segmentEnd = words[end].at + words[end].text.length - (poss ? poss[0].length : 0);
      out += run.slice(cursor, words[k].at) + v.seal(P.name, run.slice(words[k].at, segmentEnd));
      cursor = words[end].at + words[end].text.length;
      // Keep a possessive on the last redacted word ("Johnson's" → "[name redacted]'s").
      if (poss) out += poss[0];
      k = end;
    }
    return out + run.slice(cursor);
  });
}

function run(text: string, people: KnownPerson[], v: Vault) {
  // Private-use characters are our seal markers; nothing legitimate uses them.
  let out = text.replace(/[\uE000-\uF8FF]/g, " ");
  out = sealFixed(out, v);
  out = stripKnown(out, people, v);
  out = stripPatterns(out, v);
  return stripLikelyNames(out, v);
}

export function stripPII(text: string, people: KnownPerson[] = []): string {
  if (!text) return text;
  const v = new Vault();
  return v.restore(run(text, people, v));
}

/**
 * Like stripPII, but every replaced value becomes a numbered reference
 * ("[REF-3]") instead of a generic placeholder, and the mapping stays
 * here. For tasks where the AI's answer comes back to us and should show
 * the real names again — parsing an uploaded agenda — without the names
 * ever leaving: send `text`, then pass the reply through `restore`.
 * The same value always gets the same reference within one call.
 */
export function pseudonymize(text: string, people: KnownPerson[] = []) {
  const v = new Vault();
  const out = text ? v.restore(run(text, people, v), "pseudonymize") : text;
  const refs = new Map(v.refs);
  return {
    text: out,
    restore: (reply: string) => reply.replace(/\[REF-(\d+)\]/g, (ref) => refs.get(ref) ?? ref),
  };
}
