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

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() }, cache: "no-store" });
  if (!res.ok) throw new NarrationError(await explain(res));
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null }[];
  };
  return (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    description: Object.values(v.labels ?? {})
      .filter(Boolean)
      .join(", "),
    previewUrl: v.preview_url ?? null,
  }));
}

/** One screen's narration as an MP3. */
export async function speak(text: string, voiceId: string): Promise<ArrayBuffer> {
  if (!/^[\w-]{1,64}$/.test(voiceId)) throw new NarrationError("Choose a narration voice first.");
  const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
    cache: "no-store",
  });
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
  if (res.status === 429) return "ElevenLabs is busy. Wait a moment and try again.";
  return "ElevenLabs couldn't make the audio. Try again.";
}
