import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineParts, parseMarkup, plainText } from "../lib/library/markup.ts";
import { normalizeItem, normalizeSources, normalizeTags, publishProblems } from "../lib/library/library.ts";
import { normalizeTidied } from "../lib/library/tidy.ts";

const FLOOD = `A flood in a strata lot can quickly become a building-wide emergency.

:::summary The first 30 minutes
[ ] **Assess immediate danger** (0–5 min). Call 911 if required.
[ ] **Stop the water** (0–10 min).
:::

## Step 1. Assess the situation immediately {0–5 min}
- Is water actively flowing?
- Is anyone injured?
  Call 911 first.

:::warning
Do not walk through standing water near electrical equipment.
:::

## Step 2. Stop the source {after the safety check}
### A. Leak from a sink
Ask the occupant to stop using the fixture.

1. Try to contact the occupant
2. Confirm your authority

| Question | Who should establish it? |
|---|---|
| What caused the leak? | Plumber |
| What does the strata insurance cover? | Insurer and adjuster |

:::sample Notice to owners
Council has been notified of a water leak affecting your strata lot.
:::

## Step 1. Assess the situation immediately
`;

test("the Library markup reads into blocks", () => {
  const b = parseMarkup(FLOOD);
  assert.equal(b[0].type, "paragraph");

  const summary = b[1];
  assert.equal(summary.type, "box");
  if (summary.type === "box") {
    assert.equal(summary.tone, "summary");
    assert.equal(summary.title, "The first 30 minutes");
    assert.deepEqual(summary.blocks, [
      { type: "list", style: "check", items: ["**Assess immediate danger** (0–5 min). Call 911 if required.", "**Stop the water** (0–10 min)."] },
    ]);
  }

  const h = b[2];
  assert.deepEqual(h, { type: "heading", level: 2, text: "Step 1. Assess the situation immediately", timing: "0–5 min", id: "step-1-assess-the-situation-immediately" });

  // An indented line continues the list item above it.
  assert.deepEqual(b[3], { type: "list", style: "bullet", items: ["Is water actively flowing?", "Is anyone injured? Call 911 first."] });
  assert.equal(b[4].type, "box");
  if (b[4].type === "box") assert.equal(b[4].tone, "warning");

  const table = b.find((x) => x.type === "table");
  assert.deepEqual(table, {
    type: "table",
    head: ["Question", "Who should establish it?"],
    rows: [
      ["What caused the leak?", "Plumber"],
      ["What does the strata insurance cover?", "Insurer and adjuster"],
    ],
  });
  assert.ok(b.some((x) => x.type === "list" && x.style === "number" && x.items.length === 2));

  // Headings with the same text get distinct ids.
  const ids = b.filter((x) => x.type === "heading").map((x) => (x.type === "heading" ? x.id : ""));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("step-1-assess-the-situation-immediately-2"));
});

test("unknown boxes and stray closing lines don't break the content", () => {
  const b = parseMarkup(":::\nJust text.\n:::bogus\nMore text.");
  assert.deepEqual(b, [{ type: "paragraph", text: "Just text." }, { type: "paragraph", text: "More text." }]);
});

test("bold runs split out of a line", () => {
  assert.deepEqual(inlineParts("Call **911** now, **then** wait"), ["Call ", { bold: "911" }, " now, ", { bold: "then" }, " wait"]);
  assert.deepEqual(inlineParts("no bold"), ["no bold"]);
});

test("plain text covers every block", () => {
  const text = plainText(parseMarkup(FLOOD));
  assert.match(text, /Insurer and adjuster/);
  assert.match(text, /Notice to owners/);
  assert.doesNotMatch(text, /\*\*/);
});

test("items are held to the Library's limits", () => {
  const item = normalizeItem({ kind: "nonsense", title: "  Flood response  ", tags: "Flood, WATER, flood, insurance", markup: "x".repeat(70000) });
  assert.equal(item.kind, "playbook");
  assert.equal(item.title, "Flood response");
  assert.deepEqual(item.tags, ["flood", "water", "insurance"]);
  assert.equal(item.markup.length, 60000);
  assert.deepEqual(normalizeTags(["a", "", "B"]), ["a", "b"]);
  assert.deepEqual(
    normalizeSources([{ chunkId: "c1", label: "SPA s. 98" }, { chunkId: "c1", label: "dup" }, { chunkId: "", label: "none" }]),
    [{ chunkId: "c1", label: "SPA s. 98" }]
  );
  assert.deepEqual(publishProblems({ ...item, summary: "" }), ["Add a one-line summary."]);
});

test("the AI's reply never supplies sources, and every claim has a query", () => {
  const t = normalizeTidied({
    kind: "emergency_playbook",
    title: "Flood response",
    summary: "What to do in the first hour.",
    tags: ["flood"],
    markup: "## Step 1\nText.",
    sources: [{ chunkId: "x", label: "made up" }],
    claims: [{ statement: "An owner must allow emergency entry.", query: "" }, { statement: "" }],
  });
  assert.equal(t.item.kind, "emergency_playbook");
  assert.deepEqual(t.item.sources, []);
  assert.deepEqual(t.claims, [{ statement: "An owner must allow emergency entry.", query: "An owner must allow emergency entry." }]);
});

test("a disclaimer can be fine print", () => {
  assert.deepEqual(parseMarkup(":::fineprint\nNot legal advice.\n:::"), [
    { type: "box", tone: "fineprint", title: null, blocks: [{ type: "paragraph", text: "Not legal advice." }] },
  ]);
});
