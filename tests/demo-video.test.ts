import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { demoClip, demoOffset } from "../lib/demo-video.ts";

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

test("each tile's loop starts somewhere different, inside the loop", () => {
  const starts = [0, 1, 2, 3, 4].map((i) => demoOffset(i, 20));
  assert.equal(starts[0], 0);
  assert.equal(new Set(starts.map((s) => Math.round(s))).size, 5);
  for (const s of starts) assert.ok(s >= 0 && s < 20);
  assert.equal(demoOffset(3, 0), 0);
  assert.equal(demoOffset(3, Number.NaN), 0);
});
