import { test } from "node:test";
import assert from "node:assert/strict";
import { audioDurationSeconds } from "../lib/media/audio-duration.ts";
import { estimateMinutes, slideSeconds } from "../lib/training/estimate.ts";
import type { PlayerContent, PlayerSlide } from "../lib/training/slides.ts";

/** n frames of MPEG-1 layer III, 128 kbps, 44.1 kHz (417 bytes each, 1152 samples). */
function mp3(n: number, id3 = false) {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const tag = id3 ? new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]) : new Uint8Array(0);
  const out = new Uint8Array(tag.length + n * frame.length);
  out.set(tag);
  for (let i = 0; i < n; i++) out.set(frame, tag.length + i * frame.length);
  return out;
}

function wav(seconds: number) {
  const byteRate = 8000;
  const data = byteRate * seconds;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WAVEfmt "].map((c) => c.charCodeAt(0)), 8);
  v.setUint32(16, 16, true);
  v.setUint32(28, byteRate, true);
  b.set([..."data"].map((c) => c.charCodeAt(0)), 36);
  v.setUint32(40, data, true);
  return b;
}

test("audio length is read from MP3 frames and WAV headers", () => {
  assert.ok(Math.abs(audioDurationSeconds(mp3(100))! - (100 * 1152) / 44100) < 0.001);
  assert.ok(Math.abs(audioDurationSeconds(mp3(100, true))! - (100 * 1152) / 44100) < 0.001, "an ID3 tag is skipped");
  assert.equal(audioDurationSeconds(wav(3)), 3);
  assert.equal(audioDurationSeconds(new Uint8Array(64)), null, "not audio");
});

const slide = (p: Partial<PlayerSlide>): PlayerSlide => ({
  id: "s1",
  title: "Title",
  body: "",
  layout: "text",
  visual: null,
  narration: null,
  music: null,
  element: null,
  citations: [],
  ...p,
});

test("a module's time comes from narration, reading and activities", () => {
  const narrated = slide({ narration: { url: "https://x.test/a.mp3", script: "word ".repeat(150) } });
  // Measured narration wins over the script's word count.
  assert.equal(slideSeconds(narrated, 42), 47);
  // Unmeasured: 150 words spoken at 150 a minute.
  assert.equal(slideSeconds(narrated, null), 65);
  // No narration: the slide is read at 200 words a minute.
  assert.equal(slideSeconds(slide({ title: "", body: "word ".repeat(200) }), null), 65);
  const content: PlayerContent = {
    format: "slides",
    objectives: [],
    furtherReading: [],
    introMusic: null,
    outroMusic: null,
    topics: [{ id: "t1", title: "T", slides: [narrated, { ...narrated, id: "s2" }] }],
  };
  assert.equal(estimateMinutes(content, new Map([["s1", 100], ["s2", 100]])), 4); // 210 seconds
  assert.equal(estimateMinutes({ ...content, topics: [] }, new Map()), 1, "never less than a minute");
});
