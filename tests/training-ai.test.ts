/** The AI module builder's conversions. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleModule, markdownToDoc, normalizePlan, toBlock, toScreens } from "../lib/training/ai.ts";
import { docText, publishProblems, screenRequirements } from "../lib/training/content.ts";

const nulls = {
  text: null, title: null, variant: null, reference: null, style: null, items: null, question: null,
  options: null, explanation: null, studyNote: null, prompt: null, choices: null, rows: null,
};

test("markdown-lite becomes the builder's rich text", () => {
  const doc = markdownToDoc("## Who decides\n\nCouncil **governs**, the *manager* carries out.\n\n- Owners vote\n- Council acts\n\n1. First\n2. Second");
  assert.deepEqual(doc.content?.map((n) => n.type), ["heading", "paragraph", "bulletList", "orderedList"]);
  assert.equal(doc.content?.[0].attrs?.level, 2);
  assert.deepEqual(doc.content?.[1].content?.[1], { type: "text", text: "governs", marks: [{ type: "bold" }] });
  assert.deepEqual(doc.content?.[1].content?.[3], { type: "text", text: "manager", marks: [{ type: "italic" }] });
  assert.equal(docText(doc).includes("Owners vote"), true);
});

test("a knowledge check keeps every option's reason, the study note and the reference", () => {
  const b = toBlock({
    ...nulls,
    type: "knowledge_check",
    question: "Who approves the budget?",
    options: [
      { text: "Council", correct: false, why: "Council proposes it." },
      { text: "The owners at the AGM", correct: true, why: "Owners approve it by majority vote." },
    ],
    explanation: "The budget is the owners' decision.",
    studyNote: "Council proposes, owners approve.",
    reference: "Strata Property Act, s. 103",
  });
  assert.ok(b && b.type === "knowledge_check");
  if (b?.type !== "knowledge_check") return;
  assert.equal(b.options.find((o) => o.id === b.correctId)?.text, "The owners at the AGM");
  assert.equal(b.options[0].feedback, "Council proposes it.");
  assert.equal(b.studyTip, "Council proposes, owners approve.");
  assert.equal(b.reference, "Strata Property Act, s. 103");
});

test("blocks with nothing usable are dropped", () => {
  assert.equal(toBlock({ ...nulls, type: "text", text: "  " }), null);
  assert.equal(toBlock({ ...nulls, type: "knowledge_check", question: "Q?", options: [{ text: "A", correct: true, why: "" }] }), null);
  assert.equal(toBlock({ ...nulls, type: "made_up" }), null);
});

test("screens carry the narration script and wait on their questions and reveals", () => {
  const screens = toScreens({
    screens: [
      {
        title: "Terms",
        narration: "Let's start with three words you'll hear a lot.",
        blocks: [
          { ...nulls, type: "reveal", style: "cards", items: [{ title: "Common property", text: "Hallways, the roof." }] },
          { ...nulls, type: "text", text: "Read these first." },
        ],
      },
      { title: "Empty", narration: "", blocks: [{ ...nulls, type: "text", text: "" }] },
    ],
  });
  assert.equal(screens.length, 1);
  assert.equal(screens[0].narration.transcript, "Let's start with three words you'll hear a lot.");
  assert.equal(screens[0].narration.src, "");
  // No audio yet, so only the reveal holds up Next.
  assert.equal(screenRequirements(screens[0]).length, 1);
});

test("a plan is tidied and an assembled module passes the publish checks", () => {
  const plan = normalizePlan({
    summary: "A guide.",
    modules: [
      {
        title: "Council basics",
        trackCode: "nonsense",
        summary: "What council does.",
        estimatedMinutes: 400,
        objectives: ["Explain what council does", ""],
        sections: [{ title: "Roles", keyPoints: ["Council governs"] }],
      },
    ],
  });
  const m = plan.modules[0];
  assert.equal(m.trackCode, "mal");
  assert.equal(m.estimatedMinutes, 90);
  assert.deepEqual(m.objectives, ["Explain what council does"]);
  assert.equal(m.include, true);
  const content = assembleModule(m, [
    toScreens({ screens: [{ title: "Who does what", narration: "", blocks: [{ ...nulls, type: "text", text: "Council governs." }] }] }),
  ]);
  assert.equal(content.sections[0].title, "Roles");
  assert.deepEqual(publishProblems(content), []);
});
