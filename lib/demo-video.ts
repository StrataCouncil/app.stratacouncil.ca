/**
 * The demo's sample meeting video (public/demo/council, CREDITS.md there):
 * a short silent loop and a still for each fictional person who joins a
 * visitor's meeting, matched by name (lib/demo-kit/people.ts). Anyone else
 * (the visitor, or someone they invited) gets an ordinary tile.
 */
const CLIPS: Record<string, string> = {
  "Tomasz Kowalczyk": "tomasz",
  "Adaeze Okafor": "adaeze",
  "Liam Fraser": "liam",
  "Ruth Gallagher": "ruth",
  "Dev Malhotra": "dev",
};

export interface DemoClip {
  /** VP9, for browsers without H.264 (and tried first: smaller). */
  webm: string;
  video: string;
  poster: string;
}

export function demoClip(name: string): DemoClip | null {
  const key = CLIPS[name.replace(/,\s*SL\s?-?\d+$/i, "").trim()];
  return key ? { webm: `/demo/council/${key}.webm`, video: `/demo/council/${key}.mp4`, poster: `/demo/council/${key}.jpg` } : null;
}

/** Who looks like they're speaking: one of the people with a clip, changing every few seconds. */
export function nextSpeaker(keys: string[], current: string | null, roll: number = Math.random()): string | null {
  if (!keys.length) return null;
  const others = keys.length > 1 ? keys.filter((k) => k !== current) : keys;
  return others[Math.min(others.length - 1, Math.floor(roll * others.length))];
}
