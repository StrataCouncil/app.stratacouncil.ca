/**
 * StrataCouncil's own Zoom account (docs/zoom-council-meetings.md,
 * docs/zoom-setup.md): a Server-to-Server OAuth app creates and ends
 * meetings, and a Meeting SDK app lets people join them from our pages.
 * Keys come from Vercel environment variables only.
 */
export type ZoomConfig = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  sdkKey: string;
  sdkSecret: string;
  /** Zoom users who can host, one meeting each at a time. */
  hosts: string[];
};

export function zoomConfig(): ZoomConfig | null {
  const e = process.env;
  const hosts = (e.ZOOM_HOST_USERS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (!e.ZOOM_ACCOUNT_ID || !e.ZOOM_CLIENT_ID || !e.ZOOM_CLIENT_SECRET || !e.ZOOM_SDK_CLIENT_ID || !e.ZOOM_SDK_CLIENT_SECRET || !hosts.length) return null;
  return {
    accountId: e.ZOOM_ACCOUNT_ID,
    clientId: e.ZOOM_CLIENT_ID,
    clientSecret: e.ZOOM_CLIENT_SECRET,
    sdkKey: e.ZOOM_SDK_CLIENT_ID,
    sdkSecret: e.ZOOM_SDK_CLIENT_SECRET,
    hosts,
  };
}

export class ZoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null
  ) {
    super(message);
  }
}

let cached: { token: string; until: number } | null = null;

async function accessToken(cfg: ZoomConfig): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cfg.accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; reason?: string };
  if (!res.ok || !body.access_token) throw new ZoomError(`token: ${res.status} ${body.reason ?? ""}`.trim(), res.status, null);
  // A minute's margin before Zoom's expiry (an hour).
  cached = { token: body.access_token, until: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000 };
  return body.access_token;
}

async function zoom<T>(cfg: ZoomConfig, method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(cfg)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return null;
  const json = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  // Zoom's messages are about our request, never about people; safe to log.
  if (!res.ok) throw new ZoomError(`${method} ${path.replace(/\/users\/[^/]+/, "/users/<host>")}: ${res.status} ${json.message ?? ""}`.trim(), res.status, json.code ?? null);
  return json;
}

/**
 * A Zoom meeting for a council meeting starting now. Settings we rely on
 * are set here, not left to the account (docs/zoom-setup.md): waiting room
 * on (conflicts), nobody before the host, no recording, no AI summary.
 */
export async function createZoomMeeting(cfg: ZoomConfig, host: string, input: { topic: string; timezone: string; passcode: string }) {
  const created = await zoom<{ id: number; password?: string }>(cfg, "POST", `/users/${encodeURIComponent(host)}/meetings`, {
    topic: input.topic.slice(0, 200),
    type: 2,
    start_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: 180,
    timezone: input.timezone,
    password: input.passcode,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      waiting_room: true,
      mute_upon_entry: true,
      approval_type: 2,
      meeting_authentication: false,
      auto_recording: "none",
      auto_start_meeting_summary: false,
    },
  });
  if (!created?.id) throw new ZoomError("create: no meeting id", 500, null);
  return { zoomMeetingId: String(created.id), passcode: created.password ?? input.passcode };
}

/** The host's ZAK: lets the Runner start the meeting as host from the browser. */
export async function hostZak(cfg: ZoomConfig, host: string): Promise<string> {
  const r = await zoom<{ token: string }>(cfg, "GET", `/users/${encodeURIComponent(host)}/token?type=zak`);
  if (!r?.token) throw new ZoomError("zak: no token", 500, null);
  return r.token;
}

/** Ends the meeting for everyone and deletes it from the host's list. Errors (already ended, never started) are ignored. */
export async function endZoomMeeting(cfg: ZoomConfig, zoomMeetingId: string): Promise<void> {
  await zoom(cfg, "PUT", `/meetings/${encodeURIComponent(zoomMeetingId)}/status`, { action: "end" }).catch(() => null);
  await zoom(cfg, "DELETE", `/meetings/${encodeURIComponent(zoomMeetingId)}`).catch(() => null);
}
