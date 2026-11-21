import { test } from "node:test";
import assert from "node:assert/strict";
import * as catalogue from "../lib/library/catalogue.ts";
import { isDownloadableKind, isTemplateLocked, knowledgeResourceKindLabels } from "../lib/library/catalogue.ts";

test("forms are a Library category, downloadable like policy templates, and free (2026-11-12)", () => {
  assert.equal(knowledgeResourceKindLabels.form, "Form");
  assert.ok(isDownloadableKind("form") && isDownloadableKind("policy_template"));
  assert.ok(!isDownloadableKind("playbook"));
  assert.equal(isTemplateLocked({ kind: "form" }, false), false);
  assert.equal(isTemplateLocked({ kind: "form" }, true), false);
  assert.equal(isTemplateLocked({ kind: "playbook" }, false), false);
});

test("the Library has no hard-coded placeholder articles: everything is published from the console", () => {
  assert.ok(!("knowledgeResources" in catalogue));
});
