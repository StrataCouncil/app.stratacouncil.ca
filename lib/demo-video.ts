/**
 * The demo's sample meeting video (public/demo/council, CREDITS.md there):
 * a 20-second silent loop (looking at the camera, then down at their notes,
 * and back) and a still for each fictional person who joins a
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

/**
 * Where a tile's loop starts, in seconds: spread across the loop by the
 * tile's place, so the council doesn't look down at their notes together.
 */
export function demoOffset(index: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return (index * 0.37 * duration) % duration;
}
