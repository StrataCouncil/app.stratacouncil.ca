import { test } from "node:test";
import assert from "node:assert/strict";
import { addChat, applyHand, canCoHost, encodeCommand, MAX_CHAT, myPlace, ordinal, parseCommand, pruneHands, type ChatLine, type Hand, type RoomCommand } from "../lib/meetings/video-room.ts";

test("commands round-trip, and anything else is ignored", () => {
  for (const c of [{ t: "hand", up: true, at: 5 }, { t: "queue", ids: [3, 1] }, { t: "lower" }, { t: "sync" }, { t: "unmute" }] as RoomCommand[]) {
    assert.deepEqual(parseCommand(encodeCommand(c)), c);
  }
  assert.equal(parseCommand("not json"), null);
  assert.equal(parseCommand(JSON.stringify({ t: "hand", up: "yes", at: 1 })), null);
  assert.equal(parseCommand(JSON.stringify({ t: "queue", ids: [1, "x"] })), null);
  assert.equal(parseCommand(JSON.stringify({ t: "delete-everything" })), null);
  assert.equal(parseCommand("null"), null);
});

test("hands queue in the order they went up, and keep their place when re-sent", () => {
  let q: Hand[] = [];
  q = applyHand(q, 7, true, 100, 1);
  q = applyHand(q, 3, true, 200, 2);
  q = applyHand(q, 9, true, 150, 3);
  assert.deepEqual(q.map((h) => h.userId), [7, 9, 3]);
  // The host rejoined and 7 says so again, later: still first.
  q = applyHand(q, 7, true, 999, 4);
  assert.deepEqual(q.map((h) => h.userId), [7, 9, 3]);
  q = applyHand(q, 9, false, 0, 5);
  assert.deepEqual(q.map((h) => h.userId), [7, 3]);
  // Same clock time: whoever the host heard first.
  q = applyHand([], 1, true, 50, 2);
  q = applyHand(q, 2, true, 50, 1);
  assert.deepEqual(q.map((h) => h.userId), [2, 1]);
});

test("people who leave drop out of the queue", () => {
  const q: Hand[] = [
    { userId: 1, at: 1, seq: 1 },
    { userId: 2, at: 2, seq: 2 },
  ];
  assert.deepEqual(pruneHands(q, new Set([2])).map((h) => h.userId), [2]);
});

test("each person sees only their own place", () => {
  assert.equal(myPlace([4, 8, 2], 8), "You're 2nd");
  assert.equal(myPlace([4, 8, 2], 5), null);
  assert.equal(myPlace([4], null), null);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
});

test("chat keeps each message once, in order, and only the latest", () => {
  const line = (id: string, at: number, text = "Hi"): ChatLine => ({ id, fromId: 1, fromName: "Pat, SL001", text, at });
  let lines: ChatLine[] = [];
  lines = addChat(lines, line("b", 20));
  lines = addChat(lines, line("a", 10));
  lines = addChat(lines, line("b", 20));
  lines = addChat(lines, line("c", 30, "   "));
  assert.deepEqual(lines.map((l) => l.id), ["a", "b"]);
  for (let i = 0; i < MAX_CHAT + 5; i++) lines = addChat(lines, line(`m${i}`, 100 + i));
  assert.equal(lines.length, MAX_CHAT);
  assert.equal(lines[lines.length - 1].id, `m${MAX_CHAT + 4}`);
});

test("co-hosts are people who can run meetings, never the host", () => {
  const runners = new Set(["abc", "def"]);
  assert.equal(canCoHost("abc", runners, false), true);
  assert.equal(canCoHost("abc", runners, true), false);
  assert.equal(canCoHost("zzz", runners, false), false);
  assert.equal(canCoHost("", runners, false), false);
});
