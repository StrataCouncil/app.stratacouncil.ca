import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkLegislation, detectCurrentTo, parseSections } from "../lib/kb/legislation.ts";

// Shaped like a BC Laws Act: a contents page, then Parts, headings above
// sections, subsections, and wrapped lines that start with numbers.
const ACT = `Strata Property Act
[SBC 1998] CHAPTER 43
This Act is current to August 5, 2026
Contents
1 Definitions and interpretation
2 Establishment of strata corporation
44 Calling special general meeting
45 Notice of general meetings
46 Repealed
Part 1 — Definitions and Interpretation
Definitions and interpretation
1 (1) In this Act: "common property" means that part of the land and buildings shown on a strata plan that is not part of a strata lot.
Establishment of strata corporation
2 (1) On the deposit of a strata plan in a land title office, the strata corporation is established.
(2) The strata corporation is a corporation as defined in the Interpretation Act.
Part 4 — Meetings
Calling special general meeting
44 (1) The strata corporation must hold a special general meeting if persons holding at least 20% of the strata corporation's votes demand it.
Notice of general meetings
45 (1) The strata corporation must give at least 2 weeks' written notice of an annual or special general meeting to every owner, whether the meeting is called within
45 days or not.
(2) The notice must include the agenda, and
2009 amendments do not apply to this subsection.
46 Repealed. [2009-17-12.]
Agenda and notice of resolutions
46.1 The agenda must include any resolution that requires a 3/4 vote, with the exact wording of the resolution set out in full.
`;

test("sections are split at their numbers, with headings and Parts", () => {
  const sections = parseSections(ACT);
  const numbers = sections.map((s) => s.number);
  assert.deepEqual(numbers, ["1", "2", "44", "45", "46.1"]);
  const s45 = sections.find((s) => s.number === "45")!;
  assert.equal(s45.heading, "Notice of general meetings");
  assert.equal(s45.part, "Part 4 — Meetings");
  assert.match(s45.body, /45 days or not/);
  assert.match(s45.body, /2009 amendments/);
  // The next section's heading isn't left at the end of this one.
  const s44 = sections.find((s) => s.number === "44")!;
  assert.doesNotMatch(s44.body, /Notice of general meetings/);
  assert.equal(sections.find((s) => s.number === "46.1")!.heading, "Agenda and notice of resolutions");
});

test("headings on the same line as the number", () => {
  const text = [
    "Notice of general meetings 45 (1) The strata corporation must give at least 2 weeks' written notice to every owner.",
    "(2) The notice must include the agenda and the proposed budget for the coming year.",
    "Quorum for general meetings 48 (1) Business must not be conducted at an annual or special general meeting unless a quorum is present.",
  ].join("\n");
  const sections = parseSections(text);
  assert.deepEqual(
    sections.map((s) => [s.number, s.heading]),
    [
      ["45", "Notice of general meetings"],
      ["48", "Quorum for general meetings"],
    ]
  );
  assert.match(sections[0].body, /^45 \(1\)/);
});

test("current-to date is read from the text", () => {
  assert.equal(detectCurrentTo(ACT), "2026-08-05");
  assert.equal(detectCurrentTo("nothing here"), null);
});

test("chunks carry the citation", () => {
  const { chunks, sections } = chunkLegislation(ACT, { title: "Strata Property Act", kind: "act", currentTo: "2026-08-05" });
  assert.equal(sections, 5);
  const c = chunks.find((x) => x.title.startsWith("s. 45"))!;
  assert.equal(c.title, "s. 45 Notice of general meetings");
  assert.match(c.text, /^Strata Property Act, current to 2026-08-05, section 45: Notice of general meetings \[Part 4 — Meetings\]\n45 \(1\)/);
});

test("long sections are split, unsectioned text falls back to plain chunks", () => {
  const long = Array.from({ length: 8 }, (_, i) => `Heading ${i}\n${i + 1} (1) ${"The strata corporation must keep records. ".repeat(i === 3 ? 120 : 3)}`).join("\n");
  const { chunks } = chunkLegislation(long, { title: "Test Act", kind: "act", currentTo: null });
  const parts = chunks.filter((c) => c.title.startsWith("s. 4 "));
  assert.ok(parts.length > 1);
  assert.match(parts[0].text, /section 4: Heading 3 \(part 1 of \d+\)/);

  const guide = chunkLegislation("A plain guide about depreciation reports. ".repeat(10), {
    title: "Depreciation report guide",
    kind: "guidance",
    currentTo: null,
  });
  assert.equal(guide.sections, 0);
  assert.equal(guide.chunks[0].title, "Depreciation report guide");
  assert.match(guide.chunks[0].text, /^Depreciation report guide\nA plain guide/);
});

// Quirks found in real BC Laws text (RESA, the Strata Property Regulation).
const REG = `Copyright © King's Printer,
Victoria, British Columbia, Canada Licence
Disclaimer
This consolidation is current to June 2, 2026.
Contents
Part 5 — Property
5.101 Exclusive use — parking stall
Part 6 — Finances
6.1 Contributions to contingency reserve fund
6.2 Depreciation report
6.21 When depreciation report must be obtained
6.3 Management of contingency reserve fund
Form A
Form B

Part 5 — Property

Exclusive use — parking stall

5.101 For the purposes of section 76 of the Act, a strata corporation may give an owner exclusive use of a parking stall.

Part 6 — Finances

Contributions to contingency reserve fund

6.1 (1)For the purposes of section 93 of the Act, the annual contribution must be determined after consideration of the depreciation report.

Depreciation report

6.2 (0.1)For the purposes of section 94 (1) of the Act, "qualified person" means a person who holds a relevant designation.

When depreciation report must be obtained

6.21 (1)In this section, "specified area" means any of the following areas of the province listed below.

Management of contingency reserve fund

6.3 (1)The strata corporation may only lend money in the contingency reserve fund to the operating fund if conditions are met.

6.4 [Repealed B.C. Reg. 1/2020.]

76-77 [Repealed 2016-27-28.]

Strata Property Act

Form A

(Section 56)

PROXY APPOINTMENT

I/We appoint the following person to act as proxy at the meeting of the strata corporation.
1 General proxy
2 Proxy for the following matters only

Form B

[am. B.C. Reg. 1/2023.]

INFORMATION CERTIFICATE

The owners, Strata Plan ..........., certify that the information below is correct as of the date of this certificate.

Copyright © King's Printer, Victoria, British Columbia, Canada`;

test("real-world layout: blank lines, inserted sections, repeals, forms", () => {
  const sections = parseSections(REG);
  assert.deepEqual(
    sections.map((s) => s.number),
    ["5.101", "6.1", "6.2", "6.21", "6.3", "Form A", "Form B"]
  );
  assert.equal(sections.find((s) => s.number === "6.2")!.heading, "Depreciation report");
  assert.equal(sections.find((s) => s.number === "Form A")!.heading, "Proxy appointment");
  assert.equal(sections.find((s) => s.number === "Form B")!.heading, "Information certificate");
  assert.match(sections.find((s) => s.number === "Form A")!.body, /1 General proxy/);
  assert.ok(!sections.some((s) => /Copyright/.test(s.body)));
  assert.equal(detectCurrentTo(REG), "2026-06-02");

  const { chunks } = chunkLegislation(REG, { title: "Strata Property Regulation", shortName: "SPR", kind: "regulation", currentTo: "2026-06-02" });
  const form = chunks.find((c) => c.title.startsWith("Form B"))!;
  assert.equal(form.title, "Form B Information certificate");
  assert.match(form.text, /^Strata Property Regulation \(SPR\), current to 2026-06-02, Form B: Information certificate\n/);
});

test("suggested names from file names", async () => {
  const { titleFromFileName, guessKind } = await import("../lib/legislation.ts");
  assert.equal(titleFromFileName("real-estate-services-act.txt"), "Real Estate Services Act");
  assert.equal(titleFromFileName("strata-property-regulation.txt"), "Strata Property Regulation");
  assert.equal(titleFromFileName("Personal_Information_Protection_Act.pdf"), "Personal Information Protection Act");
  assert.equal(titleFromFileName("guide-to-the-strata-property-act.pdf"), "Guide to the Strata Property Act");
  assert.equal(titleFromFileName("1780853222429-working-with-strata-management-company.pdf"), "Working With Strata Management Company");
  assert.equal(titleFromFileName("2024 Strata Guide.pdf"), "2024 Strata Guide");
  assert.equal(guessKind("Strata Property Regulation"), "regulation");
  assert.equal(guessKind("Real Estate Services Act"), "act");
  assert.equal(guessKind("CHOA bulletin on depreciation reports"), "guidance");
  assert.equal(guessKind("Guide to the Strata Property Act"), "guidance");
});
