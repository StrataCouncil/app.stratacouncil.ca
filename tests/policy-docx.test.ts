import { test } from "node:test";
import assert from "node:assert/strict";
import { fillPlaceholders, policyBlocks, policyDocx } from "../lib/exports/policy-docx.ts";
import { parseMarkup } from "../lib/library/markup.ts";

const corp = { planNumber: "EPS9048", name: "Harbourview Gardens" };

test("a policy template fills in the strata's name and plan number", () => {
  assert.equal(fillPlaceholders("[Strata Corporation name] (Strata Plan [Strata Plan number])", corp), "Harbourview Gardens (Strata Plan EPS9048)");
  assert.equal(fillPlaceholders("The Owners of [name of the strata], [plan no.]", corp), "The Owners of Harbourview Gardens, EPS9048");
  assert.equal(fillPlaceholders("[Strata name] and [strata corporation]", corp), "Harbourview Gardens and Harbourview Gardens");
  // Other placeholders are council's to fill in.
  assert.equal(fillPlaceholders("Fine of [amount]", corp), "Fine of [amount]");
});

test("guidance boxes stay out of the downloaded policy", () => {
  const blocks = parseMarkup(
    ["## Purpose", "This policy sets out pets.", ":::note How to use this template", "Adapt it.", ":::", "- One pet", ":::fineprint", "Not legal advice.", ":::"].join("\n")
  );
  const kept = policyBlocks(blocks);
  assert.deepEqual(
    kept.map((b) => b.type),
    ["heading", "paragraph", "list"]
  );
});

test("the policy builds as a Word document", async () => {
  const buf = await policyDocx({ corporation: corp, title: "Pet Policy", markup: "## Purpose\n\n**Bold** text\n\n1. First\n2. Second\n\n[ ] Check\n\n| A | B |\n|---|---|\n| 1 | 2 |" });
  assert.equal(buf.subarray(0, 2).toString(), "PK");
});
