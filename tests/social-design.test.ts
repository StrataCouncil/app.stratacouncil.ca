import { test } from "node:test";
import assert from "node:assert/strict";
import { cloneDesign, designFromSlide, designPhotos, designTexts, newLayer, normalizeDesign, roleTexts, startingBackground, tallBox, withRoleTexts } from "../lib/social/design.ts";
import { creditLines, normalizePhoto, normalizeSlides, platformTextFile, postTexts, toPost } from "../lib/social/post.ts";

const ID = "11111111-1111-1111-1111-111111111111";
const unsplash = { path: null, src: "https://images.unsplash.com/photo-1", alt: "A roof", credit: { source: "unsplash", name: "Ana", profileUrl: "https://unsplash.com/@ana", photoUrl: "https://unsplash.com/photos/1" }, fit: "cover" };
const photo = normalizePhoto(unsplash, ID)!;
const slide = { kind: "point" as const, number: "1", kicker: "Before the meeting", title: "Send the agenda early", body: "Owners and council need time to read it.", photo };

test("a slide's starting design keeps its words in layers that know what they hold", () => {
  const d = designFromSlide(slide, { template: "list", theme: "paper", index: 0 });
  assert.equal(d.bg, "cream");
  assert.deepEqual(roleTexts(d), { number: "1", kicker: "Before the meeting", title: "Send the agenda early", body: "Owners and council need time to read it." });
  assert.equal(designPhotos(d)[0].src, photo.src);
  assert.ok(d.layers.some((l) => l.type === "auto" && l.what === "handle"));
  assert.ok(d.layers.every((l) => l.x >= -10 && l.y >= -10 && l.x + l.w <= 110));
});

test("every kind and look gets a design in brand colours", () => {
  for (const template of ["list", "story", "editorial"] as const)
    for (const theme of ["paper", "accent", "ink"] as const)
      for (const kind of ["cover", "point", "quote", "photo", "cta"] as const) {
        const d = designFromSlide({ ...slide, kind }, { template, theme, index: 1 });
        assert.equal(normalizeDesign(JSON.parse(JSON.stringify(d)), (p) => normalizePhoto(p, ID))?.layers.length, d.layers.length, `${template} ${theme} ${kind}`);
      }
  assert.equal(startingBackground("list", "paper", "cta", 3), "accent");
  assert.equal(startingBackground("editorial", "ink", "point", 0), "ink");
});

test("saving keeps only the brand kit and safe photos", () => {
  const d = normalizeDesign(
    {
      bg: "hotpink",
      layers: [
        { id: "a", type: "text", text: "Hi", color: "#ff00ff", font: "Comic Sans", weight: 650, size: 999 },
        { id: "a", type: "image", photo: { path: "someone-else/x.png", src: "", alt: "", credit: null, fit: "cover" } },
        { id: "c", type: "image", photo: { path: null, src: "https://evil.example/x.jpg", alt: "", credit: unsplash.credit, fit: "cover" } },
        { id: "d", type: "script", text: "<script>" },
      ],
      tall: { a: { x: 1, y: 2, w: 3, h: 4 }, zz: { x: 1, y: 1, w: 1, h: 1 } },
    },
    (p) => normalizePhoto(p, ID)
  )!;
  assert.equal(d.bg, "cream");
  assert.equal(d.layers.length, 3);
  const [t, i1, i2] = d.layers;
  assert.ok(t.type === "text" && t.color === "ink" && t.font === "serif" && t.weight === 700 && t.size === 40);
  assert.notEqual(i1.id, "a", "a repeated id gets a new one");
  assert.ok(i1.type === "image" && i1.photo === null, "an upload from another post's folder is dropped");
  assert.ok(i2.type === "image" && i2.photo === null, "a photo from anywhere but Unsplash is dropped");
  assert.deepEqual(Object.keys(d.tall), ["a"]);
  assert.equal(normalizeDesign({ layers: "nope" }, () => null), null);
});

test("on TikTok, layers keep their size in pixels and stay clear of its caption", () => {
  const d = designFromSlide(slide, { template: "list", theme: "paper", index: 0 });
  const title = d.layers.find((l) => l.type === "text" && l.role === "title")!;
  const t = tallBox(d, title);
  assert.ok(Math.abs(t.h - title.h * (1350 / 1920)) < 0.02);
  const handle = d.layers.find((l) => l.type === "auto" && l.what === "handle")!;
  assert.ok(tallBox(d, handle).y + tallBox(d, handle).h < 80, "the footer moves above TikTok's caption");
  const bg = { ...newLayer("shape", "cream"), x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(tallBox(d, bg), { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(tallBox({ tall: { [title.id]: { x: 5, y: 6, w: 7, h: 8 } } }, title), { x: 5, y: 6, w: 7, h: 8 });
});

test("an AI rewrite changes the words, not the design; a saved layout gets new ids", () => {
  const d = designFromSlide(slide, { template: "list", theme: "paper", index: 0 });
  const r = withRoleTexts(d, { title: "A new title" });
  assert.equal(roleTexts(r).title, "A new title");
  assert.equal(r.layers.length, d.layers.length);
  const c = cloneDesign({ ...d, tall: { [d.layers[0].id]: { x: 1, y: 1, w: 1, h: 1 } } });
  assert.ok(c.layers.every((l, i) => l.id !== d.layers[i].id));
  assert.equal(Object.keys(c.tall)[0], c.layers[0].id);
});

test("captions, the wording check, and credits read the design", () => {
  const d = designFromSlide(slide, { template: "list", theme: "paper", index: 0 });
  const withEmoji = withRoleTexts(d, { body: "Read it early \u{1F600}" });
  const [s] = normalizeSlides([{ id: "s1", kind: "point", title: "Old title", design: withEmoji }], ID);
  const post = toPost({ id: ID, title: "T", campaign: "c", slides: [s], captions: {} });
  assert.ok(designTexts(post.slides[0].design).some((t) => t.includes("Read it early")));
  assert.ok(postTexts(post).some((t) => t.includes("\u{1F600}")));
  assert.deepEqual(creditLines(post), ["Photo by Ana on Unsplash: https://unsplash.com/photos/1"]);
  const file = platformTextFile(post, "instagram");
  assert.match(file, /slide-01\.png {2}1 Send the agenda early/);
  assert.match(file, /Alt text: A roof/);
});
