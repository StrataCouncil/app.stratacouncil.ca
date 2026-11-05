import { createHmac, randomInt } from "node:crypto";

/**
 * The Meeting SDK JWT that lets one person join one Zoom meeting from our
 * pages (HS256, signed with the Meeting SDK app's client secret). Role 1
 * starts the meeting as host (the Runner, with the host's ZAK), 0 joins it.
 * Valid for 2 hours; a fresh one is made for every join.
 */
export function meetingSdkSignature(input: { sdkKey: string; sdkSecret: string; meetingNumber: string; role: 0 | 1; now?: number }): string {
  const iat = Math.floor((input.now ?? Date.now()) / 1000) - 30;
  const exp = iat + 2 * 60 * 60;
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { appKey: input.sdkKey, sdkKey: input.sdkKey, mn: input.meetingNumber, role: input.role, iat, exp, tokenExp: exp };
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${part(header)}.${part(payload)}`;
  return `${body}.${createHmac("sha256", input.sdkSecret).update(body).digest("base64url")}`;
}

const PASSCODE_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A 10-character passcode (Zoom's maximum). Nobody types it; the app passes it on. */
export function newPasscode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += PASSCODE_CHARS[randomInt(PASSCODE_CHARS.length)];
  return s;
}

/** How someone appears in Zoom: "Jane Doe, SL012", or just the name for someone without a council lot. */
export function zoomDisplayName(name: string, lot: string | null): string {
  const clean = (name || "Council member").replace(/\s+/g, " ").trim().slice(0, 50);
  return lot ? `${clean}, ${lot}` : clean;
}
