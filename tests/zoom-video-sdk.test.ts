import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sessionTopic, videoSdkConfig, videoSdkToken } from "../lib/zoom/video-sdk.ts";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const config = { key: "KEY", secret: "SECRET", geoRegions: ["CA"] };

test("Video SDK token: HS256, the fields Zoom requires, signed with the secret", () => {
  const now = Date.parse("2026-11-06T03:00:00Z");
  const t = videoSdkToken({ config, topic: "live-abc", role: 1, userKey: "6f1c2a9e-0000-4000-8000-000000000001", now });
  const [h, p, s] = t.split(".");
  assert.deepEqual(decode(h!), { alg: "HS256", typ: "JWT" });
  const payload = decode(p!);
  assert.equal(payload.app_key, "KEY");
  assert.equal(payload.tpc, "live-abc");
  assert.equal(payload.role_type, 1);
  assert.equal(payload.version, 1);
  assert.equal(payload.iat, now / 1000 - 30);
  // Zoom: at least 30 minutes, at most 48 hours.
  assert.equal(payload.exp - payload.iat, 4 * 3600);
  assert.equal(payload.user_key, "6f1c2a9e-0000-4000-8000-000000000001");
  assert.equal(payload.geo_regions, "CA");
  assert.equal(payload.video_webrtc_mode, 1);
  assert.equal(payload.audio_webrtc_mode, 1);
  assert.equal(s, createHmac("sha256", "SECRET").update(`${h}.${p}`).digest("base64url"));
});

test("nothing in the token asks for recording or transcription", () => {
  const payload = decode(videoSdkToken({ config, topic: "t", role: 0, userKey: "u" }).split(".")[1]!);
  assert.equal(payload.role_type, 0);
  for (const k of Object.keys(payload)) assert.doesNotMatch(k, /record|transcript/);
});

test("regions: Canada unless set; 'none' leaves it to Zoom; unknown codes are dropped", () => {
  assert.equal(videoSdkConfig({}), null);
  assert.equal(videoSdkConfig({ ZOOM_VIDEO_SDK_KEY: "k" }), null);
  const base = { ZOOM_VIDEO_SDK_KEY: " k ", ZOOM_VIDEO_SDK_SECRET: "s" };
  assert.deepEqual(videoSdkConfig(base), { key: "k", secret: "s", geoRegions: ["CA"] });
  assert.deepEqual(videoSdkConfig({ ...base, ZOOM_VIDEO_SDK_GEO_REGIONS: "ca, us" })!.geoRegions, ["CA", "US"]);
  assert.deepEqual(videoSdkConfig({ ...base, ZOOM_VIDEO_SDK_GEO_REGIONS: "none" })!.geoRegions, []);
  assert.deepEqual(videoSdkConfig({ ...base, ZOOM_VIDEO_SDK_GEO_REGIONS: "XX" })!.geoRegions, ["CA"]);
  const noRegion = decode(videoSdkToken({ config: { ...config, geoRegions: [] }, topic: "t", role: 0, userKey: "u" }).split(".")[1]!);
  assert.equal("geo_regions" in noRegion, false);
});

test("one session per meeting, kept apart for the live and demo sites", () => {
  const id = "48E799DF-cccf-4225-a38f-9a6686e8c338";
  assert.equal(sessionTopic(id, false), "live-48e799df-cccf-4225-a38f-9a6686e8c338");
  assert.equal(sessionTopic(id, true), "demo-48e799df-cccf-4225-a38f-9a6686e8c338");
  assert.ok(sessionTopic(id, true).length <= 200);
});
