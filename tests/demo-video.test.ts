import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { demoClip, nextSpeaker } from "../lib/demo-video.ts";

test("each fictional person who joins a demo meeting has a loop and a still", () => {
  for (const name of ["Tomasz Kowalczyk", "Adaeze Okafor", "Liam Fraser", "Ruth Gallagher", "Dev Malhotra"]) {
    const clip = demoClip(name);
    assert.ok(clip, name);
    assert.ok(existsSync(`public${clip.video}`), clip.video);
    assert.ok(existsSync(`public${clip.webm}`), clip.webm);
    assert.ok(existsSync(`public${clip.poster}`), clip.poster);
  }
  assert.equal(demoClip("Liam Fraser, SL008")?.video, "/demo/council/liam.mp4");
});

test("the visitor, and anyone they invite, get an ordinary tile", () => {
  assert.equal(demoClip("Jeremy Visitor"), null);
  assert.equal(demoClip(""), null);
});

test("the speaker changes to someone else, and only among people with a clip", () => {
  assert.equal(nextSpeaker([], null), null);
  assert.equal(nextSpeaker(["a"], "a"), "a");
  for (let i = 0; i < 20; i++) {
    const next = nextSpeaker(["a", "b", "c"], "b");
    assert.ok(next === "a" || next === "c");
  }
  assert.equal(nextSpeaker(["a", "b"], null, 0.99), "b");
});
