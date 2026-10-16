import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SAMPLE_TEMPLATE_ID, demoSampleTemplate } from "../lib/library/demo-sample.ts";
import { isUuid, normalizeItem, publishProblems } from "../lib/library/library.ts";
import { policyBlocks } from "../lib/exports/policy-docx.ts";
import { parseMarkup } from "../lib/library/markup.ts";

test("the demo's sample policy is a complete, published template", () => {
  const row = demoSampleTemplate(7);
  assert.ok(isUuid(DEMO_SAMPLE_TEMPLATE_ID));
  assert.equal(row.order_index, 7);
  const item = normalizeItem(row.published);
  assert.deepEqual(item, row.published);
  assert.equal(item.kind, "policy_template");
  assert.deepEqual(publishProblems(item), []);
  // Its "this is a sample" note shows on the page but stays out of the Word download.
  assert.ok(parseMarkup(item.markup).some((b) => b.type === "box"));
  assert.ok(!policyBlocks(parseMarkup(item.markup)).some((b) => b.type === "box"));
});
