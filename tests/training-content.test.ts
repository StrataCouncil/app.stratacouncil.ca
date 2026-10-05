/** Council Training content model. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockCatalog,
  cloneBlock,
  docText,
  flattenScreens,
  newBlock,
  newScreen,
  newSection,
  normalizeDoc,
  normalizeModuleContent,
  publishProblems,
  safeHref,
  screenRequirements,
  videoSource,
} from "../lib/training/content.ts";

test("rich text keeps the safe subset and drops anything else", () => {
  const doc = normalizeDoc({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }, { type: "evil" }] }] },
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    ],
  });
  assert.equal(doc.content?.length, 3);
  assert.equal(doc.content?.[0].attrs?.level, 2);
  assert.deepEqual(doc.content?.[1].content?.[0].marks, [{ type: "bold" }]);
  assert.equal(doc.content?.[2].content?.[0].marks, undefined);
  assert.equal(docText(doc), "Title\nHi\nlink\n");
});

test("links: http(s) and mailto only", () => {
  assert.equal(safeHref("https://www.bclaws.gov.bc.ca/x"), "https://www.bclaws.gov.bc.ca/x");
  assert.equal(safeHref("mailto:a@b.ca"), "mailto:a@b.ca");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,x"), null);
});

test("video links become privacy-friendly embeds", () => {
  assert.deepEqual(videoSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), { kind: "embed", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  assert.deepEqual(videoSource("https://youtu.be/dQw4w9WgXcQ?t=3"), { kind: "embed", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  assert.deepEqual(videoSource("https://vimeo.com/123456/abcdef12"), { kind: "embed", src: "https://player.vimeo.com/video/123456?h=abcdef12" });
  assert.deepEqual(videoSource("https://x.supabase.co/storage/v1/object/public/training-media/a.mp4"), {
    kind: "file",
    src: "https://x.supabase.co/storage/v1/object/public/training-media/a.mp4",
  });
  assert.equal(videoSource("https://example.com/page"), null);
  assert.equal(videoSource("not a url"), null);
});

test("every catalog block type can be created, cloned and normalized", () => {
  for (const { type } of blockCatalog) {
    const b = newBlock(type);
    const c = cloneBlock(b);
    assert.notEqual(c.id, b.id);
    const round = normalizeModuleContent({ sections: [{ id: "s1", title: "S", screens: [{ id: "x1", title: "X", blocks: [b, c] }] }] });
    assert.equal(round.sections[0].screens[0].blocks.length, 2, type);
    assert.equal(round.sections[0].screens[0].blocks[0].type, type);
  }
});

test("normalization drops unknown blocks, bad media and fixes a stale correct answer", () => {
  const c = normalizeModuleContent({
    objectives: ["Explain what council does", "  "],
    sections: [
      {
        id: "s1",
        title: "",
        screens: [
          {
            id: "x1",
            title: "",
            layout: "sideways",
            narration: { src: "javascript:alert(1)" },
            blocks: [
              { type: "iframe", src: "https://evil" },
              { id: "i1", type: "image", src: "http://insecure.example/x.png", alt: "x", caption: "" },
              { id: "k1", type: "knowledge_check", question: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctId: "zzz" },
            ],
          },
        ],
      },
      { id: "s1", title: "Dup", screens: [{ id: "x1", title: "Dup screen" }] },
    ],
  });
  assert.deepEqual(c.objectives, ["Explain what council does"]);
  const screen = c.sections[0].screens[0];
  assert.equal(c.sections[0].title, "Untitled section");
  assert.equal(screen.title, "Untitled screen");
  assert.equal(screen.layout, "full");
  assert.equal(screen.narration.src, "");
  assert.equal(screen.blocks.length, 2);
  assert.equal(screen.blocks[0].type === "image" && screen.blocks[0].src, "");
  assert.equal(screen.blocks[1].type === "knowledge_check" && screen.blocks[1].correctId, "a");
  assert.notEqual(c.sections[1].id, "s1");
  assert.notEqual(c.sections[1].screens[0].id, "x1");
});

test("early drafts made of lessons become one-screen sections", () => {
  const c = normalizeModuleContent({ lessons: [{ id: "l1", title: "Lesson", blocks: [newBlock("text")] }] });
  assert.equal(c.sections.length, 1);
  assert.equal(c.sections[0].title, "Lesson");
  assert.equal(c.sections[0].screens[0].blocks.length, 1);
});

test("a screen waits on narration, questions and reveals, not on reading", () => {
  const screen = newScreen("S");
  assert.deepEqual(screenRequirements(screen), []);
  const kc = newBlock("knowledge_check");
  const reveal = newBlock("reveal");
  screen.blocks.push(kc, reveal);
  assert.deepEqual(screenRequirements(screen), [kc.id]);
  if (reveal.type === "reveal") reveal.items[0] = { ...reveal.items[0], title: "Term", body: "Meaning" };
  screen.narration.src = "https://x.supabase.co/a.mp3";
  assert.deepEqual(screenRequirements(screen), ["narration", kc.id, reveal.id]);
});

test("flattenScreens numbers screens across sections", () => {
  const content = { objectives: [], sections: [newSection("A"), { ...newSection("B"), screens: [newScreen("1"), newScreen("2")] }] };
  const flat = flattenScreens(content);
  assert.equal(flat.length, 3);
  assert.deepEqual(flat.map((f) => f.sectionIndex), [0, 1, 1]);
});

test("publish checks catch what a learner would trip over", () => {
  assert.deepEqual(publishProblems({ objectives: [], sections: [] }), [
    "Add at least one section.",
    "Add the module's learning objectives (Module settings).",
  ]);
  const img = newBlock("image");
  const kc = newBlock("knowledge_check");
  const screen = { ...newScreen("Intro"), layout: "split" as const, blocks: [img, kc] };
  const problems = publishProblems({ objectives: ["x"], sections: [{ id: "s", title: "Intro", screens: [screen] }] });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /side picture/);
  assert.match(problems[1], /alt text/);
  assert.match(problems[2], /at least two answers/);
});
