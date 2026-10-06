import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, lockedBehind, minutesLeft, moduleStatuses, nextModule, trackStatus, type ProgressModule, type ProgressTrack } from "../lib/training/progress.ts";

const mod = (id: string, orderIndex: number, over: Partial<ProgressModule> = {}): ProgressModule => ({
  id,
  orderIndex,
  publishedVersion: 1,
  estimatedMinutes: 12,
  completedSections: 0,
  completed: false,
  ...over,
});
const track = (id: string, requiresTrackId: string | null, modules: ProgressModule[], credential: unknown = null): ProgressTrack => ({
  id,
  requiresTrackId,
  credential,
  modules,
});
const done = { completed: true };

test("modules open in order; unpublished ones don't hold anything up", () => {
  const s = moduleStatuses(track("a", null, [mod("1", 1, done), mod("2", 2, { publishedVersion: 0 }), mod("3", 3), mod("4", 4)]));
  assert.deepEqual([...s.values()], ["done", "soon", "open", "locked"]);
});

test("Council Ready waits on Strata Basics; specialty tracks wait on Council Ready", () => {
  const sb = track("sb", null, [mod("1", 1)]);
  const cr = track("cr", "sb", [mod("2", 1)]);
  const t = track("t", "cr", [mod("3", 1)]);
  const all = [sb, cr, t];
  assert.equal(lockedBehind(sb, all), null);
  assert.equal(lockedBehind(cr, all)?.id, "sb");
  assert.equal(lockedBehind(t, all)?.id, "cr", "names the track directly before");
  assert.equal(trackStatus(t, all), "locked");

  sb.modules[0].completed = true;
  assert.equal(lockedBehind(cr, all), null);
  assert.equal(lockedBehind(t, all)?.id, "cr");
  cr.modules[0].completed = true;
  assert.equal(lockedBehind(t, all), null);
  assert.equal(trackStatus(t, all), "not_started");
});

test("a prerequisite with nothing published doesn't block; a started track stays open", () => {
  const sb = track("sb", null, [mod("1", 1, { publishedVersion: 0 })]);
  const cr = track("cr", "sb", [mod("2", 1)]);
  assert.equal(lockedBehind(cr, [sb, cr]), null);
  // Strata Basics gets a module later: someone already in Council Ready keeps going.
  sb.modules[0].publishedVersion = 1;
  cr.modules[0].completedSections = 1;
  assert.equal(lockedBehind(cr, [sb, cr]), null);
  assert.equal(trackStatus(cr, [sb, cr]), "in_progress");
});

test("track status", () => {
  const sb = track("sb", null, [mod("1", 1, done)], { issuedAt: "x" });
  const empty = track("e", null, []);
  assert.equal(trackStatus(sb, [sb]), "complete");
  assert.equal(trackStatus(empty, [empty]), "soon");
});

test("next module: one under way first, then the first open one in curriculum order", () => {
  const sb = track("sb", null, [mod("1", 1, done), mod("2", 2)]);
  const cr = track("cr", "sb", [mod("3", 1)]);
  assert.equal(nextModule([sb, cr])?.module.id, "2");
  assert.equal(nextModule([sb, cr])?.position, 2);
  sb.modules[1].completed = true;
  assert.equal(nextModule([sb, cr])?.module.id, "3");
  const other = track("t", null, [mod("4", 1, { completedSections: 2 })]);
  sb.modules[1].completed = false;
  assert.equal(nextModule([sb, cr, other])?.module.id, "4");
  sb.modules[1].completed = true;
  cr.modules[0].completed = true;
  other.modules[0].completed = true;
  assert.equal(nextModule([sb, cr, other]), null);
});

test("minutes left and their wording", () => {
  assert.equal(minutesLeft([track("a", null, [mod("1", 1, done), mod("2", 2), mod("3", 3, { publishedVersion: 0 })])]), 12);
  assert.equal(formatMinutes(12), "about 10 min");
  assert.equal(formatMinutes(35), "about 35 min");
  assert.equal(formatMinutes(120), "about 2 h");
  assert.equal(formatMinutes(98), "about 1 h 40 min");
});
