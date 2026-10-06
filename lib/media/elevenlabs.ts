/**
 * Narration audio from ElevenLabs text-to-speech (server only; the key,
 * ELEVENLABS_API_KEY, is restricted to Text to Speech and reading voices).
 * Only narration scripts are sent: course text, never anyone's details.
 */
const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

export class NarrationError extends Error {}

function key() {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new NarrationError("Narration isn't set up yet (missing ElevenLabs key).");
  return k;
}

export interface Voice {
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
}

/**
 * Every voice on the account (My Voices), a page at a time: the v2 list
 * includes them all, where the older v1 list can leave some out.
 */
export async function listVoices(): Promise<Voice[]> {
  const out: Voice[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    if (token) url.searchParams.set("next_page_token", token);
    const res = await fetch(url, { headers: { "xi-api-key": key() }, cache: "no-store" });
    if (!res.ok) throw new NarrationError(await explain(res));
    const data = (await res.json()) as {
      voices?: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null; description?: string | null }[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    for (const v of data.voices ?? []) out.push(toVoice(v));
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function toVoice(v: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null }): Voice {
  return {
    id: v.voice_id,
    name: v.name,
    description: Object.values(v.labels ?? {})
      .filter(Boolean)
      .join(", "),
    previewUrl: v.preview_url ?? null,
  };
}

/**
 * One voice by its ElevenLabs id, for a voice that isn't in the list (e.g.
 * copied from ElevenLabs). Null when ElevenLabs doesn't know it on this
 * account; a Voice Library voice must be added to My Voices first.
 */
export async function getVoice(voiceId: string): Promise<Voice | null> {
  if (!/^[\w-]{1,64}$/.test(voiceId)) return null;
  const res = await fetch(`${API}/voices/${voiceId}`, { headers: { "xi-api-key": key() }, cache: "no-store" });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new NarrationError(await explain(res));
  return toVoice((await res.json()) as { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null });
}

/** One screen's narration as an MP3. */
export async function speak(text: string, voiceId: string): Promise<ArrayBuffer> {
  if (!/^[\w-]{1,64}$/.test(voiceId)) throw new NarrationError("Choose a narration voice first.");
  const call = () =>
    fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  let res: Response;
  try {
    res = await call();
    // Busy or a passing server error: one more try after a short wait.
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await call();
    }
  } catch (e) {
    console.error("[elevenlabs] request failed", e instanceof Error ? e.message : e);
    throw new NarrationError("ElevenLabs didn't answer in time. Try again.");
  }
  if (!res.ok) throw new NarrationError(await explain(res));
  return res.arrayBuffer();
}

async function explain(res: Response) {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: { status?: string; message?: string } | string };
    detail = typeof body.detail === "string" ? body.detail : `${body.detail?.status ?? ""} ${body.detail?.message ?? ""}`;
  } catch {}
  console.error("[elevenlabs]", res.status, detail.slice(0, 300));
  // ElevenLabs answers 401 for running out of credits too, so read its reason before blaming the key.
  if (/quota|credit|character_limit|limit_reached|usage/i.test(detail) || res.status === 402)
    return "ElevenLabs is out of credits: either the plan's monthly allowance or the usage limit set on the API key is used up. Raise the limit or upgrade the plan, then generate the rest.";
  if (/unusual_activity|free_users_not_allowed|payment/i.test(detail))
    return `ElevenLabs refused the request (${detail.trim().slice(0, 120)}). Check the account at elevenlabs.io.`;
  if (res.status === 401)
    return `ElevenLabs didn't accept the key${detail.trim() ? ` (${detail.trim().slice(0, 120)})` : ""}. Check ELEVENLABS_API_KEY and its permissions.`;
  if (res.status === 429) return "ElevenLabs is busy (too many requests at once). Wait a minute and try again.";
  return `ElevenLabs couldn't make the audio (error ${res.status}${detail.trim() ? `: ${detail.trim().slice(0, 120)}` : ""}). Try again.`;
}

/**
 * Background music from a description (ElevenLabs Music, POST /v1/music),
 * always instrumental. Only the description goes to ElevenLabs.
 */
export async function composeMusic(prompt: string, seconds: number): Promise<ArrayBuffer> {
  const length = Math.max(10, Math.min(120, Math.round(seconds))) * 1000;
  let res: Response;
  try {
    res = await fetch(`${API}/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), music_length_ms: length, force_instrumental: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e) {
    console.error("[elevenlabs] music request failed", e instanceof Error ? e.message : e);
    throw new NarrationError("ElevenLabs didn't finish the music in time. Try a shorter track.");
  }
  if (!res.ok) throw new NarrationError(await explain(res));
  return res.arrayBuffer();
}
