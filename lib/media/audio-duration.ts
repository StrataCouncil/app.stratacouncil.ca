/**
 * How long an audio file plays, read from the file itself: MP3 (the
 * narration ElevenLabs makes, and most uploads) by walking its frames, and
 * WAV from its header. Other formats return null, and the caller estimates
 * from the script instead.
 */
export function audioDurationSeconds(file: ArrayBuffer | Uint8Array): number | null {
  const b = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (b.length < 12) return null;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return wavSeconds(b);
  return mp3Seconds(b);
}

function ascii(b: Uint8Array, at: number, n: number) {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function wavSeconds(b: Uint8Array): number | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let byteRate = 0;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at, 4);
    const size = v.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= b.length) byteRate = v.getUint32(at + 16, true);
    if (id === "data") return byteRate ? Math.min(size, b.length - at - 8) / byteRate : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

// Bitrates (kbps) by [MPEG-1 | MPEG-2/2.5][index], layer III only.
const BITRATES = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3Seconds(b: Uint8Array): number | null {
  let at = 0;
  // An ID3v2 tag at the start: its size is four 7-bit bytes.
  if (ascii(b, 0, 3) === "ID3" && b.length > 10) at = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  let seconds = 0;
  let frames = 0;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) {
      if (frames) break; // trailing tags or junk after the audio
      at++;
      continue;
    }
    const version = (b[at + 1] >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layer = (b[at + 1] >> 1) & 3; // 1: layer III
    const bitrate = BITRATES[version === 3 ? 0 : 1][b[at + 2] >> 4];
    const rate = SAMPLE_RATES[version]?.[(b[at + 2] >> 2) & 3];
    if (version === 1 || layer !== 1 || !bitrate || !rate) {
      if (frames) break;
      at++;
      continue;
    }
    const padding = (b[at + 2] >> 1) & 1;
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor((samples / 8) * (bitrate * 1000) / rate) + padding;
    seconds += samples / rate;
    frames++;
    at += length;
  }
  return frames ? seconds : null;
}
