import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomDisplayName } from "../lib/zoom/video-sdk.ts";
import { videoPeople, type PresenceEvent } from "../lib/meetings/live.ts";

test("Zoom names: name and council lot, tidied", () => {
  assert.equal(zoomDisplayName("  Jane   Doe ", "SL012"), "Jane Doe, SL012");
  assert.equal(zoomDisplayName("Pat Lee", null), "Pat Lee");
  assert.equal(zoomDisplayName("", "SL003"), "Council member, SL003");
  assert.equal(zoomDisplayName("x".repeat(80), null).length, 50);
});

test("demo video tiles: one per person in the meeting, roll names first", () => {
  const ev = (id: number, lot: string | null, event: PresenceEvent["event"], userId: string, name: string): PresenceEvent => ({ id, userId, name, lot, event, at: "2026-11-05T20:00:00Z" });
  const people = videoPeople(
    [ev(1, "SL001", "joined", "a", "A Person"), ev(2, "SL002", "joined", "b", "B Person"), ev(3, "SL002", "left", "b", "B Person"), ev(4, null, "joined", "m", "Manager Name")],
    { SL001: "Ana Ruiz" }
  );
  assert.deepEqual(people, [
    { key: "lot:SL001", name: "Ana Ruiz", lot: "SL001" },
    { key: "user:m", name: "Manager Name", lot: null },
  ]);
});
