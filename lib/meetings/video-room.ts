/**
 * The meeting video's room (components/meetings/VideoRoom.tsx): raised
 * hands, chat, and who may do what. Pure, so tests/video-room.test.ts can
 * check it; the Zoom Video SDK does the sending.
 *
 * Raised hands travel over Zoom's command channel, never through our
 * database: nothing about them is stored, and nothing in Zoom has any
 * bearing on the minutes. Each person keeps their own hand; whoever runs
 * the meeting (the session's host) keeps the order and sends it round, so
 * everyone sees the same queue. When the host joins or rejoins, they ask,
 * and everyone with a hand up says so again, keeping their place.
 */

export type RoomCommand =
  /** A person's own hand, up or down; `at` (their clock) keeps their place when re-sent. */
  | { t: "hand"; up: boolean; at: number }
  /** The host's order of raised hands, by Zoom user id. */
  | { t: "queue"; ids: number[] }
  /** The host or a co-host lowered this person's hand. */
  | { t: "lower" }
  /** The host has joined: everyone with a hand up, say so again. */
  | { t: "sync" }
  /**
   * The host or a co-host asks this person to unmute, when their sound isn't
   * on yet (Zoom's own ask only reaches people whose audio has started).
   */
  | { t: "unmute" };

export function encodeCommand(c: RoomCommand): string {
  return JSON.stringify(c);
}

/** A command from the channel, or null for anything that isn't one of ours. */
export function parseCommand(text: string): RoomCommand | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (c.t === "hand" && typeof c.up === "boolean" && typeof c.at === "number" && Number.isFinite(c.at)) return { t: "hand", up: c.up, at: c.at };
  if (c.t === "queue" && Array.isArray(c.ids) && c.ids.every((x) => Number.isInteger(x))) return { t: "queue", ids: (c.ids as number[]).slice(0, 2000) };
  if (c.t === "lower") return { t: "lower" };
  if (c.t === "sync") return { t: "sync" };
  if (c.t === "unmute") return { t: "unmute" };
  return null;
}

/** One raised hand, as the host keeps it. */
export interface Hand {
  userId: number;
  /** When it went up, by the raiser's clock: the order when the host rebuilds the queue. */
  at: number;
  /** When the host heard of it: breaks ties, and orders hands whose clocks disagree. */
  seq: number;
}

/** The host's queue after someone raises or lowers their hand. */
export function applyHand(queue: Hand[], userId: number, up: boolean, at: number, seq: number): Hand[] {
  const rest = queue.filter((h) => h.userId !== userId);
  if (!up) return rest;
  const existing = queue.find((h) => h.userId === userId);
  // Already up (a re-send after the host rejoined): keep its place.
  if (existing) return queue;
  return [...rest, { userId, at, seq }].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

/** Without anyone who has left the session. */
export function pruneHands(queue: Hand[], present: Set<number>): Hand[] {
  return queue.filter((h) => present.has(h.userId));
}

/** 1 to "1st", 2 to "2nd", 11 to "11th", 23 to "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/** "You're 2nd" for someone whose hand is up; null if it isn't in the queue. */
export function myPlace(queue: number[], me: number | null): string | null {
  if (me === null) return null;
  const i = queue.indexOf(me);
  return i < 0 ? null : `You're ${ordinal(i + 1)}`;
}

export interface ChatLine {
  id: string;
  fromId: number;
  fromName: string;
  text: string;
  at: number;
}

/** The most messages kept on screen; older ones scroll away. */
export const MAX_CHAT = 500;

/** A new message added once (the SDK can report our own as well as return it), oldest first. */
export function addChat(lines: ChatLine[], line: ChatLine): ChatLine[] {
  if (!line.text.trim() || lines.some((l) => l.id === line.id)) return lines;
  const next = [...lines, line].sort((a, b) => a.at - b.at);
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}

/** A piece of a chat message: plain text, or a web address to link. */
export type ChatPiece = { text: string; href?: string };

/**
 * A chat message split so its web addresses can be links: http and https
 * addresses, and ones starting "www." (linked as https). Punctuation that
 * ends a sentence stays out of the link. Nothing else becomes a link, so a
 * "javascript:" address in chat stays plain text.
 */
export function chatPieces(text: string): ChatPiece[] {
  const out: ChatPiece[] = [];
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    // A closing bracket belongs to the address only if it opened one.
    while (/[.,;:!?'")\]]$/.test(url)) {
      const end = url[url.length - 1];
      if (end === ")" && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      if (end === "]" && (url.match(/\[/g)?.length ?? 0) >= (url.match(/\]/g)?.length ?? 0)) break;
      url = url.slice(0, -1);
    }
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The longest chat message; Zoom's own limit is higher. */
export const MAX_CHAT_LENGTH = 1000;

/**
 * Co-hosts: anyone who can run meetings (the same people a meeting can be
 * handed over to), by their identity in the session (our user id without
 * dashes), but never the host.
 */
export function canCoHost(identity: string, runners: Set<string>, isHost: boolean): boolean {
  return !isHost && identity !== "" && runners.has(identity);
}
