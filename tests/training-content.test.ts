/** Council Training content model. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockCatalog,
  cloneBlock,
  docText,
  newBlock,
  normalizeDoc,
  normalizeModuleContent,
  publishProblems,
  safeHref,
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
    const round = normalizeModuleContent({ lessons: [{ id: "l1", title: "L", blocks: [b, c] }] });
    assert.equal(round.lessons[0].blocks.length, 2, type);
    assert.equal(round.lessons[0].blocks[0].type, type);
  }
});

test("normalization drops unknown blocks, bad media and fixes a stale correct answer", () => {
  const c = normalizeModuleContent({
    lessons: [
      {
        id: "l1",
        title: "",
        blocks: [
          { type: "iframe", src: "https://evil" },
          { id: "i1", type: "image", src: "http://insecure.example/x.png", alt: "x", caption: "" },
          { id: "k1", type: "knowledge_check", question: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctId: "zzz" },
        ],
      },
      { id: "l1", title: "Dup", blocks: [] },
    ],
  });
  assert.equal(c.lessons[0].title, "Untitled lesson");
  assert.equal(c.lessons[0].blocks.length, 2);
  assert.equal(c.lessons[0].blocks[0].type === "image" && c.lessons[0].blocks[0].src, "");
  assert.equal(c.lessons[0].blocks[1].type === "knowledge_check" && c.lessons[0].blocks[1].correctId, "a");
  assert.notEqual(c.lessons[1].id, "l1");
});

test("publish checks catch what a learner would trip over", () => {
  assert.deepEqual(publishProblems({ lessons: [] }), ["Add at least one lesson."]);
  const img = newBlock("image");
  const kc = newBlock("knowledge_check");
  const problems = publishProblems({ lessons: [{ id: "l", title: "Intro", blocks: [img, kc] }] });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /alt text/);
  assert.match(problems[1], /at least two answers/);
});
