/** The AI module builder's conversions. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTightened,
  assembleModule,
  docToMarkdown,
  markdownToDoc,
  normalizePlan,
  onScreenWords,
  screenForTightening,
  toBlock,
  toScreens,
} from "../lib/training/ai.ts";
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
  assert.equal(m.trackCode, "council_ready");
  assert.equal(m.estimatedMinutes, 90);
  assert.deepEqual(m.objectives, ["Explain what council does"]);
  assert.equal(m.include, true);
  const content = assembleModule(m, [
    toScreens({ screens: [{ title: "Who does what", narration: "", blocks: [{ ...nulls, type: "text", text: "Council governs." }] }] }),
  ]);
  assert.equal(content.sections[0].title, "Roles");
  assert.deepEqual(publishProblems(content), []);
});

test("rich text goes back to markdown-lite and round-trips", () => {
  const md = "## Who decides\n\nCouncil **governs** day to day.\n\n- Owners vote\n- Council acts";
  assert.equal(docToMarkdown(markdownToDoc(md)), md);
});

test("Tighten with AI rewrites only the text blocks and keeps narration, questions and order", () => {
  const kc = toBlock({
    ...nulls,
    type: "knowledge_check",
    question: "Q?",
    options: [
      { text: "A", correct: true, why: "" },
      { text: "B", correct: false, why: "" },
    ],
  })!;
  const screen = toScreens({
    screens: [{ title: "Busy", narration: "Long narration.", blocks: [{ ...nulls, type: "text", text: "word ".repeat(80) }] }],
  })[0];
  screen.blocks.push(kc);
  screen.narration.src = "https://x.supabase.co/a.mp3";
  screen.narration.voicedText = "Long narration.";
  assert.equal(onScreenWords(screen), 80);
  assert.equal(screenForTightening(screen).length, 1);

  const tightened = applyTightened(screen, { blocks: [{ ...nulls, type: "callout", variant: "key", text: "Owners share ownership." }] });
  assert.deepEqual(tightened.blocks.map((b) => b.type), ["callout", "knowledge_check"]);
  assert.equal(tightened.blocks[1], kc);
  assert.deepEqual(tightened.narration, screen.narration);
  assert.equal(onScreenWords(tightened), 3);
  // A reply with nothing usable leaves the screen alone.
  assert.equal(applyTightened(screen, { blocks: [] }), screen);
});

test("curriculum builds keep the module's title, track and objectives", async () => {
  const { curriculumPlanRequest, pinToCurriculum, normalizePlan } = await import("../lib/training/ai.ts");
  const target = {
    title: "What a strata is",
    trackCode: "strata_basics" as const,
    summary: "Strata lots and common property.",
    estimatedMinutes: 12,
    objectives: ["Explain common property"],
  };
  const request = curriculumPlanRequest(target, [{ title: "Who decides what", track: "Strata Basics", summary: "" }], "Keep it short.");
  assert.match(request, /Module: What a strata is/);
  assert.match(request, /- Explain common property/);
  assert.match(request, /Strata Basics: Who decides what/);
  assert.match(request, /Keep it short\./);

  const plan = normalizePlan({
    summary: "s",
    modules: [
      { title: "Something else", trackCode: "treasurer", objectives: ["Other"], sections: [1, 2, 3, 4, 5].map((n) => ({ title: `S${n}`, keyPoints: [] })) },
      { title: "Extra module" },
    ],
  });
  const pinned = pinToCurriculum(plan, target);
  assert.equal(pinned.modules.length, 1);
  assert.equal(pinned.modules[0].title, "What a strata is");
  assert.equal(pinned.modules[0].trackCode, "strata_basics");
  assert.deepEqual(pinned.modules[0].objectives, ["Explain common property"]);
  assert.equal(pinned.modules[0].sections.length, 4);
  assert.equal(pinned.modules[0].estimatedMinutes, 12);
});
