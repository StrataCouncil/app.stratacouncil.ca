import { test } from "node:test";
import assert from "node:assert/strict";
import { isDownloadableKind, isTemplateLocked, knowledgeResources, knowledgeResourceKindLabels } from "../lib/library/catalogue.ts";

test("forms are a Library category, behind the subscription like policy templates", () => {
  assert.equal(knowledgeResourceKindLabels.form, "Form");
  assert.ok(isDownloadableKind("form") && isDownloadableKind("policy_template"));
  assert.ok(!isDownloadableKind("playbook"));
  assert.equal(isTemplateLocked({ kind: "form" }, false), true);
  assert.equal(isTemplateLocked({ kind: "form" }, true), false);
  assert.equal(isTemplateLocked({ kind: "playbook" }, false), false);
});

test("the alterations placeholder is gone", () => {
  assert.ok(!knowledgeResources.some((r) => /alteration agreement/i.test(r.title)));
});
