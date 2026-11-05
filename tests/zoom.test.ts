import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { meetingSdkSignature, newPasscode, zoomDisplayName } from "../lib/zoom/signature.ts";
import { videoPeople, type PresenceEvent } from "../lib/meetings/live.ts";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("Meeting SDK signature: HS256 over header.payload, with the fields Zoom requires", () => {
  const now = Date.parse("2026-11-05T20:00:00Z");
  const sig = meetingSdkSignature({ sdkKey: "KEY", sdkSecret: "SECRET", meetingNumber: "81234567890", role: 1, now });
  const [h, p, s] = sig.split(".");
  assert.deepEqual(decode(h!), { alg: "HS256", typ: "JWT" });
  const payload = decode(p!);
  assert.equal(payload.appKey, "KEY");
  assert.equal(payload.mn, "81234567890");
  assert.equal(payload.role, 1);
  assert.equal(payload.iat, now / 1000 - 30);
  assert.equal(payload.exp - payload.iat, 7200);
  assert.equal(payload.tokenExp, payload.exp);
  assert.equal(s, createHmac("sha256", "SECRET").update(`${h}.${p}`).digest("base64url"));
});

test("members join as participants (role 0)", () => {
  const sig = meetingSdkSignature({ sdkKey: "K", sdkSecret: "S", meetingNumber: "1", role: 0 });
  assert.equal(decode(sig.split(".")[1]!).role, 0);
});

test("passcodes: 10 characters Zoom accepts, never the same twice", () => {
  const a = newPasscode();
  assert.match(a, /^[A-Za-z0-9]{10}$/);
  assert.notEqual(a, newPasscode());
});

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
