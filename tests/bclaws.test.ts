import { test } from "node:test";
import assert from "node:assert/strict";
import { bcLawsDocumentId, bcLawsHtmlToText, bcLawsPartIds, normalizeBcLawsLink } from "../lib/kb/bclaws.ts";
import { detectCurrentTo, parseSections } from "../lib/kb/legislation.ts";

// Shaped like BC Laws markup: whitespace and line breaks inside the
// section-number spans, headings in <h4>, subsections in their own <p>.
const PAGE = `<html><head><title>Strata Property Act</title><style>body { display: none; }</style></head><body>
<div id="toolBar">Search Results | Clear Search</div>
<div class="act"><p>This Act is current to November 17, 2026</p>
<div class="section"><a name="section96"></a><h4>Expenditures from contingency reserve fund</h4>
<p class="sec"><span class="secnum"><span class="secnumholder"><b>96</b>
      </span></span>The strata corporation must not spend money from the contingency reserve fund unless the expenditure is</p>
<p class="para"><span class="num"><span class="holder">(a)</span></span> consistent with the purposes of the fund, and</p></div>
<div class="section"><a name="section97"></a><h4>Expenditures from operating fund</h4>
<p class="sec"><span class="secnum"><span class="secnumholder"><b>97</b>
      </span></span>The strata corporation must not spend money from the operating fund unless the expenditure is</p>
<p class="para"><span class="num"><span class="holder">(a)</span></span> consistent with the purposes of the fund &amp; budget, and</p></div>
<div class="section"><a name="section98"></a><h4>Unapproved expenditures</h4>
<p class="sec"><span class="secnum"><span class="secnumholder"><b>98</b>
      </span></span><span class="num"><span class="holder">(1)</span></span> If a proposed expenditure has not been put forward for approval in the budget, the strata corporation may only make the expenditure in accordance with this section.</p>
<p class="sub"><span class="num"><span class="holder">(2)</span></span> Subject to subsection (3), the expenditure may be made out of the operating fund if it is less than&nbsp;$2&#160;000.</p></div>
<div class="section"><h4>Calculating strata fees</h4>
<p class="sec"><span class="secnum"><b>99</b> </span><span class="num">(1)</span> Subject to section 100, owners must contribute to the strata corporation their strata lots' shares of the total contributions.</p></div>
<div class="section"><h4>Change to basis for calculation of contribution</h4>
<p class="sec"><span class="secnum"><b>100</b> </span><span class="num">(1)</span> At an annual or special general meeting held after the first annual general meeting, the strata corporation may agree to a different formula.</p></div>
</div></body></html>`;

test("BC Laws HTML becomes text that parseSections splits by section", () => {
  const text = bcLawsHtmlToText(PAGE);
  assert.ok(!text.includes("display: none"), "styles are dropped");
  assert.equal(detectCurrentTo(text), "2026-11-17");
  assert.match(text, /^98 \(1\) If a proposed expenditure/m, "a section number and its text share a line");
  assert.match(text, /less than \$2 000\./, "entities are decoded");
  const sections = parseSections(text);
  assert.deepEqual(
    sections.map((s) => `${s.number} ${s.heading}`),
    [
      "96 Expenditures from contingency reserve fund",
      "97 Expenditures from operating fund",
      "98 Unapproved expenditures",
      "99 Calculating strata fees",
      "100 Change to basis for calculation of contribution",
    ]
  );
  assert.match(sections[1].body, /fund & budget/);
});

test("only BC Laws complete-document links are accepted", () => {
  assert.equal(bcLawsDocumentId("https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00"), "98043_00");
  assert.equal(bcLawsDocumentId(" https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/43_2000/ "), "43_2000");
  assert.equal(bcLawsDocumentId("http://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00"), null);
  assert.equal(bcLawsDocumentId("https://bclaws.gov.bc.ca.evil.example/civix/document/id/complete/statreg/98043_00"), null);
  assert.equal(bcLawsDocumentId("https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00?x=1/../../"), "98043_00");
  assert.equal(bcLawsDocumentId("https://www.bclaws.gov.bc.ca/civix/content/complete/statreg/98043_00"), null);
  assert.equal(bcLawsDocumentId("not a link"), null);
  assert.equal(
    normalizeBcLawsLink("https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/16019"),
    "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/16019"
  );
});

test("a contents page lists its parts in order; a whole document has none", () => {
  const toc = `<a href="/civix/document/id/complete/statreg/98043_02">Part 2</a>
    <a href="/civix/document/id/complete/statreg/98043_01">Part 1</a>
    <a href="/civix/document/id/complete/statreg/98043_00">Contents</a>
    <a href="/civix/document/id/complete/statreg/98043_02">Part 2 again</a>
    <a href="/civix/document/id/complete/statreg/980430_01">Not this one</a>`;
  assert.deepEqual(bcLawsPartIds(toc, "98043_00"), ["98043_01", "98043_02"]);
  assert.deepEqual(bcLawsPartIds(toc, "43_2000"), []);
});
