/**
 * Redirect targets and links people add are only ever same-site paths or
 * web addresses (the 2026-10 audit). Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../lib/safe-next.ts";
import { isWebUrl } from "../lib/web-url.ts";
import { normalizeAgenda } from "../lib/meetings/agenda.ts";

test("safeNext keeps same-site paths", () => {
  assert.equal(safeNext("/strata/BCS-1234"), "/strata/BCS-1234");
  assert.equal(safeNext("/invite/abc?x=1"), "/invite/abc?x=1");
});

test("safeNext refuses anything that leaves the site", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "/\t/evil.com", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(safeNext(bad as string), "/", String(bad));
  }
});

test("isWebUrl accepts only http and https", () => {
  assert.ok(isWebUrl("https://example.com/a"));
  assert.ok(isWebUrl("http://example.com"));
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,x", "vbscript:x", "/relative", "", null, 42]) {
    assert.equal(isWebUrl(bad), false, String(bad));
  }
});

test("an agenda keeps web links and drops script links", () => {
  const [item] = normalizeAgenda([
    {
      id: "i1",
      text: "Roof",
      atts: [
        { id: "a1", kind: "link", documentId: null, url: "https://example.com", title: "ok" },
        { id: "a2", kind: "link", documentId: null, url: "javascript:alert(1)", title: "bad" },
        { id: "a3", kind: "document", documentId: "d1", title: "file" },
      ],
    },
  ]);
  assert.deepEqual(item.atts.map((a) => a.id), ["a1", "a3"]);
});
