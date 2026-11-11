import { test } from "node:test";
import assert from "node:assert/strict";
import { clipTime, designMoves, lastEntranceEnd, layerAt, LAYOUT_KEYS, LAYOUT_KINDS, layoutDesign, newLayer, normalizeDesign, roleTexts, STILL, type SlideDesign } from "../lib/social/design.ts";
import { creditLines, normalizeClip, normalizePhoto, normalizeSlides, platformTextFile, slideFileName, toPost } from "../lib/social/post.ts";
import { BUILT_IN_TEMPLATES, builtInTemplate, isBuiltInRef, slidesFromTemplate } from "../lib/social/templates.ts";
import { MAX_CLIP_BYTES, toStockClip } from "../lib/media/pixabay.ts";

const ID = "11111111-1111-1111-1111-111111111111";
const clip = { path: `${ID}/a.mp4`, src: "https://x.supabase.co/signed", duration: 12.5, width: 1920, height: 1080, credit: { source: "pixabay", name: "Lee", pageUrl: "https://pixabay.com/videos/city-123/" } };
const norm = (d: unknown) => normalizeDesign(d, (p) => normalizePhoto(p, ID), (c) => normalizeClip(c, ID));

test("a clip is kept only from the post's own folder, with its length, size, and Pixabay credit", () => {
  const c = normalizeClip(clip, ID)!;
  assert.equal(c.src, "", "signed links are never saved");
  assert.equal(c.duration, 12.5);
  assert.deepEqual(c.credit, clip.credit);
  assert.equal(normalizeClip({ ...clip, path: `2222/a.mp4` }, ID), null);
  assert.equal(normalizeClip({ ...clip, path: `${ID}/../x.mp4` }, ID), null);
  assert.equal(normalizeClip({ ...clip, path: `${ID}/a.exe` }, ID), null);
  assert.equal(normalizeClip({ ...clip, duration: 0 }, ID), null);
  assert.equal(normalizeClip({ ...clip, credit: { source: "pixabay", name: "Lee", pageUrl: "https://evil.example/x" } }, ID)!.credit, null);
});

test("entrances, timing, slide length, and video layers survive a save; nonsense is trimmed", () => {
  const video = { ...newLayer("video", "ink"), clip, trimStart: 2, trimEnd: 6 };
  const text = { ...newLayer("text", "ink"), enter: "rise", enterAt: 1.2, enterFor: 0.8 };
  const d = norm({ bg: "ink", layers: [video, text, { ...newLayer("shape", "ink"), enter: "spin", enterAt: -4, enterFor: 99 }], tall: {}, duration: 7 })!;
  assert.equal(d.duration, 7);
  const [v, t, s] = d.layers;
  assert.ok(v.type === "video" && v.clip && v.trimStart === 2 && v.trimEnd === 6);
  assert.deepEqual([t.enter, t.enterAt, t.enterFor], ["rise", 1.2, 0.8]);
  assert.deepEqual([s.enter, s.enterAt, s.enterFor], ["none", 0, 5]);
  // Old designs (before part 2) get the defaults.
  const old = norm({ bg: "cream", layers: [{ type: "text", text: "Hi" }], tall: {} })!;
  assert.equal(old.duration, 5);
  assert.equal(old.layers[0].enter, "none");
  // A trim can't run past the clip, and the end stays after the start.
  const bad = norm({ bg: "ink", layers: [{ ...video, trimStart: 30, trimEnd: 1 }], tall: {} })!.layers[0];
  assert.ok(bad.type === "video" && bad.trimStart <= 12.4 && bad.trimEnd > bad.trimStart && bad.trimEnd <= 12.5);
  // A clip from another post is dropped, leaving an empty frame.
  const other = norm({ bg: "ink", layers: [{ ...video, clip: { ...clip, path: "other/a.mp4" } }], tall: {} })!.layers[0];
  assert.ok(other.type === "video" && other.clip === null);
  assert.equal(norm({ bg: "ink", layers: [], tall: {}, duration: 500 })!.duration, 60);
});

test("a layer's entrance: hidden before it starts, moving during, still after", () => {
  const rise = { enter: "rise" as const, enterAt: 1, enterFor: 1 };
  assert.deepEqual(layerAt(rise, 0.5), { opacity: 0, lift: 0, scale: 1, reveal: 0 });
  const mid = layerAt(rise, 1.5);
  assert.ok(mid.opacity > 0.5 && mid.opacity < 1 && mid.lift > 0 && mid.lift < 6);
  assert.deepEqual(layerAt(rise, 2), STILL);
  assert.deepEqual(layerAt({ enter: "none", enterAt: 3, enterFor: 1 }, 0), STILL);
  const wipe = layerAt({ enter: "wipe", enterAt: 0, enterFor: 1 }, 0.5);
  assert.ok(wipe.reveal > 0.5 && wipe.reveal < 1 && wipe.opacity === 1);
  const pop = layerAt({ enter: "pop", enterAt: 0, enterFor: 1 }, 0.2);
  assert.ok(pop.scale < 1 && pop.scale >= 0.82);
});

test("a slide is a video once something moves or plays; clips loop their trimmed part", () => {
  const still: SlideDesign = { bg: "cream", layers: [newLayer("text", "cream")], tall: {}, duration: 5 };
  assert.equal(designMoves(still), false);
  assert.equal(designMoves({ ...still, layers: [{ ...still.layers[0], enter: "fade" }] }), true);
  assert.equal(designMoves({ ...still, layers: [{ ...still.layers[0], enter: "fade", hidden: true }] }), false);
  assert.equal(designMoves({ ...still, layers: [newLayer("video", "cream")] }), false, "an empty video frame doesn't make a video");
  assert.equal(designMoves({ ...still, layers: [{ ...newLayer("video", "cream"), clip: normalizeClip(clip, ID) } as never] }), true);
  assert.equal(lastEntranceEnd({ ...still, layers: [{ ...still.layers[0], enter: "fade", enterAt: 2, enterFor: 1.5 }] }), 3.5);
  const trim = { trimStart: 2, trimEnd: 4 };
  assert.equal(clipTime(trim, 0), 2);
  assert.equal(clipTime(trim, 1.5), 3.5);
  assert.equal(clipTime(trim, 2.5), 2.5);
});

test("the six layouts are valid brand designs that keep the slide's words", () => {
  const words = { number: "64%", kicker: "Owners", title: "Read the minutes", body: "First\nSecond\nThird", photo: null };
  for (const key of LAYOUT_KEYS) {
    for (const bg of ["cream", "ink", "accent", "paper"] as const) {
      const d = layoutDesign(key, words, bg);
      const again = norm(JSON.parse(JSON.stringify(d)));
      assert.equal(again?.layers.length, d.layers.length, `${key} on ${bg}`);
      assert.ok(d.layers.every((l) => l.x >= -10 && l.y >= -10 && l.x + l.w <= 110 && l.y < 100), `${key} on ${bg} stays on the slide`);
      assert.ok(d.layers.some((l) => l.type === "auto" && l.what === "handle"), `${key} has the handle`);
    }
  }
  assert.equal(roleTexts(layoutDesign("stat", words, "cream")).number, "64%");
  assert.equal(roleTexts(layoutDesign("quote", words, "cream")).kicker, "Owners");
  const list = layoutDesign("checklist", words, "cream");
  assert.deepEqual(list.layers.filter((l) => l.type === "text" && l.name.startsWith("Line")).map((l) => (l.type === "text" ? l.text : "")), ["First", "Second", "Third"]);
  assert.equal(layoutDesign("bigCta", words, "ink").bg, "accent");
  assert.equal(LAYOUT_KINDS.fullPhoto, "photo");
});

test("built-in templates are complete posts; a post from one shares no ids with it", () => {
  for (const key of BUILT_IN_TEMPLATES) {
    const t = builtInTemplate(key);
    assert.ok(t.slides.length >= 1 && t.name && t.description, key);
    const saved = normalizeSlides(JSON.parse(JSON.stringify(t.slides)), ID);
    assert.equal(saved.length, t.slides.length, `${key} survives a save`);
    assert.ok(saved.every((s) => s.design), `${key} slides all have designs`);
    const copy = slidesFromTemplate(t.slides);
    const ids = (s: typeof copy) => s.flatMap((x) => [x.id, ...(x.design?.layers.map((l) => l.id) ?? [])]);
    assert.equal(ids(copy).filter((id) => ids(t.slides).includes(id)).length, 0, `${key} copy has fresh ids`);
  }
  assert.equal(builtInTemplate("singleStat").showSlideNumbers, false);
  assert.equal(isBuiltInRef("builtin:tips"), "tips");
  assert.equal(isBuiltInRef("builtin:nope"), null);
  assert.equal(isBuiltInRef(ID), null);
});

test("a template keeps no uploads or clips from the post it was saved from", () => {
  const NO_POST = "00000000-0000-0000-0000-000000000000";
  const design = { bg: "ink", layers: [{ ...newLayer("video", "ink"), clip }, { ...newLayer("image", "ink"), photo: { path: `${ID}/p.jpg`, src: "", alt: "", credit: null, fit: "cover" } }], tall: {}, duration: 5 };
  const [s] = normalizeSlides([{ id: "s1", kind: "point", title: "T", design }], NO_POST);
  assert.ok(s.design!.layers.every((l) => (l.type === "video" ? l.clip === null : l.type === "image" ? l.photo === null : true)));
});

test("Pixabay results: the sharpest file under the cap, only from Pixabay, with the credit", () => {
  const hit = {
    id: 123,
    pageURL: "https://pixabay.com/videos/city-123/",
    tags: "city, night",
    duration: 14,
    user: "Lee",
    videos: {
      large: { url: "https://cdn.pixabay.com/video/l.mp4", width: 1920, height: 1080, size: MAX_CLIP_BYTES + 1, thumbnail: "https://cdn.pixabay.com/l.jpg" },
      medium: { url: "https://cdn.pixabay.com/video/m.mp4", width: 1280, height: 720, size: 9_000_000, thumbnail: "https://cdn.pixabay.com/m.jpg" },
      tiny: { url: "https://cdn.pixabay.com/video/t.mp4", width: 640, height: 360, size: 900_000, thumbnail: "https://cdn.pixabay.com/t.jpg" },
    },
  };
  const c = toStockClip(hit)!;
  assert.equal(c.url, "https://cdn.pixabay.com/video/m.mp4");
  assert.equal(c.width, 1280);
  assert.equal(c.previewUrl, "https://cdn.pixabay.com/video/t.mp4");
  assert.equal(c.thumbUrl, "https://cdn.pixabay.com/t.jpg");
  assert.equal(toStockClip({ ...hit, pageURL: "https://evil.example/" }), null);
  assert.equal(toStockClip({ ...hit, videos: { medium: { ...hit.videos.medium, url: "https://evil.example/m.mp4" } } }), null);
  assert.equal(toStockClip({ ...hit, duration: 0 }), null);
});

test("the export names MP4s, offers stills, and credits Pixabay", () => {
  assert.equal(slideFileName(1, "mp4"), "slide-02.mp4");
  const moving = { bg: "cream", layers: [{ ...newLayer("text", "cream"), enter: "fade", role: "title", text: "Hello" }], tall: {}, duration: 5 };
  const withClip = { bg: "ink", layers: [{ ...newLayer("video", "ink"), clip }], tall: {}, duration: 5 };
  const post = toPost({
    id: ID,
    title: "T",
    campaign: "t",
    template: "list",
    theme: "paper",
    destination: "home",
    slides: [
      { id: "a", kind: "cover", title: "Hello", design: moving },
      { id: "b", kind: "point", title: "Clip", design: withClip },
    ],
    captions: {},
    created_at: "2026-11-11",
    updated_at: "2026-11-11",
  });
  const ig = platformTextFile(post, "instagram");
  assert.match(ig, /slide-01\.mp4/);
  assert.match(ig, /Also as a still picture: slide-01\.png/);
  assert.match(ig, /Video by Lee on Pixabay/);
  assert.match(platformTextFile(post, "x"), /doesn't mix pictures and video/);
  assert.match(platformTextFile(post, "linkedin"), /shown as their still picture/);
  assert.deepEqual(creditLines(post), ["Video by Lee on Pixabay: https://pixabay.com/videos/city-123/"]);
});
