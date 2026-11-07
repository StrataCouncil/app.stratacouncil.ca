import { createHmac } from "node:crypto";
import { videoIdentity } from "./video-identity.ts";

export { videoIdentity };

/**
 * Zoom Video SDK (docs/zoom-video-sdk.md): the meeting's video, drawn by our
 * own panel with none of Zoom's interface. Each council meeting is its own
 * session; nobody can join one without a token our server signs, and the
 * server signs one only for someone who may follow that meeting. Nothing is
 * created on Zoom's side beforehand and nothing is stored here: the session
 * exists while people are in it.
 *
 * Keys come from Vercel environment variables only (Zoom Build Platform,
 * Video SDK credentials; not the API credentials).
 */
export type VideoSdkConfig = {
  key: string;
  secret: string;
  /** Data centre regions for each session (Zoom's codes); empty to leave it to Zoom. */
  geoRegions: string[];
};

const REGIONS = new Set(["AU", "BR", "CA", "DE", "HK", "IN", "JP", "CN", "MX", "NL", "SG", "US"]);

/**
 * Canada by default. ZOOM_VIDEO_SDK_GEO_REGIONS can name others
 * ("CA,US") or "none" to leave routing to Zoom, should the account not
 * allow a region.
 */
export function videoSdkConfig(env: Record<string, string | undefined> = process.env): VideoSdkConfig | null {
  const key = env.ZOOM_VIDEO_SDK_KEY?.trim();
  const secret = env.ZOOM_VIDEO_SDK_SECRET?.trim();
  if (!key || !secret) return null;
  const raw = (env.ZOOM_VIDEO_SDK_GEO_REGIONS ?? "CA").trim().toUpperCase();
  const geoRegions = raw === "NONE" ? [] : raw.split(",").map((r) => r.trim()).filter((r) => REGIONS.has(r));
  return { key, secret, geoRegions: raw === "NONE" ? [] : geoRegions.length ? geoRegions : ["CA"] };
}

/**
 * The session's name: one per meeting, kept apart for the live site and the
 * demo site (they share the Zoom account).
 */
export function sessionTopic(meetingId: string, demo: boolean): string {
  return `${demo ? "demo" : "live"}-${meetingId}`.toLowerCase();
}

/**
 * The token that lets one person join one session (HS256, signed with the
 * Video SDK secret). Role 1 for whoever runs the meeting, 0 for everyone else.
 * Valid 4 hours (Zoom allows 30 minutes to 48 hours); a fresh one is made for
 * every join. WebRTC audio and video: no special page headers needed, and
 * nothing is recorded or transcribed (we never ask for it).
 */
export function videoSdkToken(input: {
  config: VideoSdkConfig;
  topic: string;
  role: 0 | 1;
  /** Our user id: lets Zoom's usage reports tell people apart, without names. */
  userKey: string;
  now?: number;
}): string {
  const iat = Math.floor((input.now ?? Date.now()) / 1000) - 30;
  const exp = iat + 4 * 60 * 60;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: Record<string, string | number> = {
    app_key: input.config.key,
    tpc: input.topic.slice(0, 200),
    role_type: input.role,
    version: 1,
    iat,
    exp,
    user_key: input.userKey.slice(0, 36),
    // Who this is in the session (Zoom allows 35 characters): the user id
    // without its dashes. Lets the Runner's screen find someone who has
    // stepped out for a conflict of interest and remove them.
    user_identity: videoIdentity(input.userKey),
    video_webrtc_mode: 1,
    audio_webrtc_mode: 1,
  };
  if (input.config.geoRegions.length) payload.geo_regions = input.config.geoRegions.join(",");
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${part(header)}.${part(payload)}`;
  return `${body}.${createHmac("sha256", input.config.secret).update(body).digest("base64url")}`;
}
