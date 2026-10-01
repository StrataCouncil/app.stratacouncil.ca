/**
 * PII stripping (lib/pii.ts) — the gate in front of every AI call.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripPII, type KnownPerson } from "../lib/pii.ts";

const people: KnownPerson[] = [
  { name: "Sally Johnson", lotNumber: "SL061" },
  { name: "Mary Anne Chen", lotNumber: "SL012" },
  { name: "Will Turner", lotNumber: null },
  { name: "Kevin O'Brien", lotNumber: "SL003" },
  { name: "Raj McDonald" },
];

function t(name: string, input: string, check: (out: string) => boolean | string, ppl: KnownPerson[] = people) {
  test(name, () => {
    const out = stripPII(input, ppl);
    const r = check(out);
    assert.ok(r === true, `${typeof r === "string" ? r : "check failed"}\n  in:  ${input}\n  out: ${out}`);
  });
}
const eq = (exp: string) => (o: string) => o === exp || `expected: ${exp}`;
const lacks = (...xs: string[]) => (o: string) => xs.every((x) => !o.includes(x)) || `still contains one of ${xs.join(", ")}`;
const has = (...xs: string[]) => (o: string) => xs.every((x) => o.includes(x)) || `missing one of ${xs.join(", ")}`;

// Layer 1: known people
t("full name -> lot", "Sally Johnson raised the leak.", eq("SL061 raised the leak."));
t("possessive", "Sally Johnson's dog barked.", eq("SL061 dog barked."));
t("last, first", "Complaint from Johnson, Sally re noise.", has("SL061"));
t("initial", "S. Johnson attended.", eq("SL061 attended."));
t("three-part name", "Mary Anne Chen moved the motion.", eq("SL012 moved the motion."));
t("first last of three-part", "Mary Chen seconded.", eq("SL012 seconded."));
t("no lot -> council member", "Will Turner chaired.", eq("[Council Member] chaired."));
t("lot not re-redacted as id", "Sally Johnson and Kevin O'Brien", eq("SL061 and SL003"));
t("leftover first name", "Sally said the dog is loud.", eq("[name redacted] said the dog is loud."));
t("leftover surname w/ honorific", "Ms. Johnson objected.", lacks("Johnson"));
t("ALL CAPS known", "LETTER FROM SALLY JOHNSON", lacks("SALLY", "JOHNSON"));
t("ALL CAPS surname alone", "RE: JOHNSON COMPLAINT", lacks("JOHNSON"));
t("'will' as a verb survives", "The council will review it and Bill will mark it.", eq("The council will review it and Bill will mark it."), [{ name: "Will Turner" }, { name: "Mark Bill" }].slice(0,1));
t("Will at sentence start (strict)", "Will said no.", lacks("Will"));
t("McDonald", "Ask McDonald about the quote.", lacks("McDonald"));
t("O'Brien", "O'Brien called.", lacks("O'Brien"));
t("lower-case full known name", "spoke to sally johnson today", eq("spoke to SL061 today"));
t("multiple spaces/newline", "Sally\n  Johnson", eq("SL061"));
t("name in email preserved as email", "Email sally.johnson@gmail.com today", eq("Email [email redacted] today"));

// Layer 0
t("url keeps host", "See https://example.com/owners/sally-johnson?id=4 for it", eq("See https://example.com/[path redacted] for it"));
t("bare host url", "Go to https://bcfsa.ca", eq("Go to https://bcfsa.ca"));
t("SL ref kept", "SL 61 and SL-7 and SL061", eq("SL 61 and SL-7 and SL061"));
t("plan number kept", "Strata Plan EPS9048 and BCS-1234", eq("Strata Plan EPS9048 and BCS-1234"));

// Layer 2
t("phone", "Call 604-555-1234 or (778) 555-9876 ext 12 or +1 250.555.0000", (o) => (o.match(/\[phone redacted\]/g) ?? []).length === 3 || "3 phones");
t("SIN", "SIN 046 454 286", lacks("046"));
t("SIN labelled 9 digits", "SIN: 046454286", lacks("046454286"));
t("card", "Card 4111 1111 1111 1111 on file", eq("Card [payment info redacted] on file"));
t("not a card (luhn fails)", "Ref 1234 5678 9012 3456", lacks("[payment"));
t("bank", "Deposit to 12345-003-1234567", eq("Deposit to [banking info redacted]"));
t("postal", "Mail to V6B 1A1 please", eq("Mail to [postal code redacted] please"));
t("address", "She lives at 4521 Oak Avenue, Vancouver", has("[address redacted]"));
t("address with unit", "#1203 - 888 Beach Ave", eq("[address redacted]"));
t("not an address", "12 owners went to court", eq("12 owners went to court"));
t("dob", "DOB: 1951-04-12", eq("[date of birth redacted]"));
t("dob words", "born on March 4, 1960", eq("[date of birth redacted]"));
t("honorific unknown", "Mrs. Patel complained", eq("[name redacted] complained"));
t("plate", "Vehicle ABC 123 towed", lacks("ABC 123"));
t("plate 123ABC", "Car 123 ABC in stall 4", lacks("123 ABC"));
t("policy no", "Policy # CGL-88271 renewed", lacks("88271"));
t("keep codes", "AGM 2026 and SPA 45 and FY2026", eq("AGM 2026 and SPA 45 and FY2026"));
t("money and dates", "Approved $12,500 on 2026-10-01 at 7:00 pm", eq("Approved $12,500 on 2026-10-01 at 7:00 pm"));
t("bylaw refs", "Bylaw 3.4(a) and section 45 of the Strata Property Act", eq("Bylaw 3.4(a) and section 45 of the Strata Property Act"));

// Layer 3: unknown names
t("unknown full name", "John Smith complained about noise.", eq("[name redacted] complained about noise."), []);
t("title + name", "Council President Sally Jones opened the meeting.", eq("Council President [name redacted] opened the meeting."), []);
t("title + single", "Treasurer Kevin presented the budget.", eq("Treasurer [name redacted] presented the budget."), []);
t("speech verb", "Afterwards Kevin noted the leak.", eq("Afterwards [name redacted] noted the leak."), []);
t("moved by", "Moved by Priya, seconded by Tom.", eq("Moved by [name redacted], seconded by [name redacted]."), []);
t("initial + surname", "J. Smith attended.", eq("[name redacted] attended."), []);
t("ALL CAPS unknown", "LETTER FROM JOHN SMITH", eq("LETTER FROM [name redacted]"), []);
t("accented", "Émile Côté wrote in.", eq("[name redacted] wrote in."), []);
t("hyphenated", "Anne Smith-Jones called.", eq("[name redacted] called."), []);
t("possessive unknown", "John Smith's car", eq("[name redacted]'s car"), []);
t("governance preserved", "The Strata Council approved the Contingency Reserve Fund expenditure at the Annual General Meeting.", eq("The Strata Council approved the Contingency Reserve Fund expenditure at the Annual General Meeting."), []);
t("headings preserved", "New Business\nWindow Cleaning Update\nRoof Replacement Quote\nCall to Order\nApproval of Minutes", (o) => !o.includes("[name") || "over-redacted", []);
t("company preserved", "Pacific Plumbing Ltd. submitted a quote; FirstService Residential manages.", has("Pacific Plumbing Ltd."), []);
t("place preserved", "The building at Vancouver, British Columbia", eq("The building at Vancouver, British Columbia"), []);
t("sentence start single word", "Discussion followed. Everyone agreed.", eq("Discussion followed. Everyone agreed."), []);
t("ALL CAPS heading", "ANNUAL GENERAL MEETING MINUTES\nNEW BUSINESS", eq("ANNUAL GENERAL MEETING MINUTES\nNEW BUSINESS"), []);
t("placeholder not re-read", "[Council Member] said hi", eq("[Council Member] said hi"), []);
t("private use chars stripped", "ab", eq("a b"), []);
t("idempotent", "SL061 and [name redacted] at [address redacted]", eq("SL061 and [name redacted] at [address redacted]"), []);
t("many redactions (vault > 16)", Array.from({length: 40}, (_, i) => `Owner${i}@x.com`).join(" "), (o) => (o.match(/\[email redacted\]/g) ?? []).length === 40 || "40", []);

// Documented limits: these get through, and the module header says so.
// Pinned here so a change in behaviour is noticed either way.
t("limit: lone unknown first name, no cue", "ask Kevin about it", eq("ask Kevin about it"), []);
t("limit: lower-case unknown name", "spoke to john smith", eq("spoke to john smith"), []);
