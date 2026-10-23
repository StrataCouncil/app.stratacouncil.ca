import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhotoSearches, photoSearchRequest, wantsPhoto } from "../lib/training/photos.ts";

test("a photo goes on slides without an interactive element, in a layout that shows one", () => {
  assert.equal(wantsPhoto({ element: null, layout: "photo" }), true);
  assert.equal(wantsPhoto({ element: null, layout: "left" }), true);
  assert.equal(wantsPhoto({ element: null, layout: "text" }), false);
  assert.equal(wantsPhoto({ element: { type: "flip_cards", items: [] }, layout: "photo" }), false);
});

test("the request numbers each slide and keeps it short", () => {
  const r = photoSearchRequest("Your role on council", [
    { topic: "What council is", title: "Council governs", body: "Council is the elected governing body.\n- It decides together" },
    { topic: "", title: "Duties", body: "x".repeat(1000) },
  ]);
  assert.match(r, /Module: Your role on council/);
  assert.match(r, /1\. \[What council is\] Council governs\nCouncil is the elected governing body\. - It decides together/);
  assert.match(r, /2\. \[Slide\] Duties/);
  assert.ok(r.length < 900);
});

test("searches go back on their slides; a missing or bad one falls back to the slide's title", () => {
  const slides = [
    { id: "a", title: "Council governs" },
    { id: "b", title: "Your duties" },
    { id: "c", title: "Conflicts of interest" },
  ];
  const out = normalizePhotoSearches(
    { searches: [{ slide: 1, query: "  people at a meeting table! " }, { slide: 3, query: "<b>" }, { slide: 9, query: "nope" }, { slide: 1, query: "again" }] },
    slides
  );
  assert.deepEqual(out, [
    { slideId: "a", query: "people at a meeting table" },
    { slideId: "b", query: "Your duties" },
    { slideId: "c", query: "b" },
  ]);
  assert.deepEqual(normalizePhotoSearches("garbage", slides).map((s) => s.query), ["Council governs", "Your duties", "Conflicts of interest"]);
});
