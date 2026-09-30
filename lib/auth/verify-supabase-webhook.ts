/**
 * Verifies the signature Supabase Auth puts on its Send Email Hook calls
 * (doc04 §7a). Supabase signs these using the Standard Webhooks scheme
 * (the same one Svix uses) — no npm dependency needed, this is ~30 lines
 * of Web Crypto, which is deliberate: adding a new dependency can't be
 * build-verified in this sandbox (persistent registry.npmjs.org 403,
 * doc00), so hand-rolled beats a library here.
 *
 * Scheme (https://www.standardwebhooks.com/):
 *   - Request carries three headers: webhook-id, webhook-timestamp,
 *     webhook-signature.
 *   - The signed content is `${id}.${timestamp}.${rawBody}`.
 *   - The secret Supabase shows you is `whsec_<base64>` — strip the
 *     prefix and base64-decode it to get the raw HMAC key.
 *   - HMAC-SHA256(key, signedContent), base64-encoded, is compared
 *     against each `v1,<signature>` entry in webhook-signature (it can
 *     carry more than one, space-separated, for secret rotation).
 *
 * IMPORTANT: call this with the *raw* request body text, not a
 * JSON.parse()'d-and-restringified version — re-serializing can change
 * whitespace/key order and break the signature check even for a
 * legitimate request.
 */

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]);
  }
  return btoa(binary);
}

/** Constant-time-ish comparison; lengths are public (base64 sig length), only content matters. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifySupabaseWebhook(params: {
  rawBody: string;
  headers: {
    "webhook-id": string | null;
    "webhook-timestamp": string | null;
    "webhook-signature": string | null;
  };
  /** The whsec_-prefixed secret from the Supabase Auth Hooks dashboard. */
  secret: string;
  /** Reject requests older than this many seconds (replay protection). Default 5 minutes. */
  toleranceSeconds?: number;
}): Promise<void> {
  const { rawBody, headers, secret, toleranceSeconds = 300 } = params;
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];

  if (!id || !timestamp || !signatureHeader) {
    throw new WebhookVerificationError(
      "Missing webhook-id, webhook-timestamp, or webhook-signature header."
    );
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new WebhookVerificationError("Invalid webhook-timestamp header.");
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    throw new WebhookVerificationError(
      `Webhook timestamp is outside the allowed tolerance (${Math.round(ageSeconds)}s old).`
    );
  }

  if (!secret.startsWith("whsec_")) {
    throw new WebhookVerificationError(
      "SUPABASE_WEBHOOK_SECRET is missing the expected 'whsec_' prefix."
    );
  }
  const keyBytes = base64ToBytes(secret.slice("whsec_".length));

  const signedContent = `${id}.${timestamp}.${rawBody}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent) as BufferSource
  );
  const expectedSignature = bytesToBase64(signatureBytes);

  // webhook-signature looks like "v1,<base64sig> v1,<base64sig2>" (space-separated,
  // multiple entries during secret rotation).
  const candidates = signatureHeader
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, sig] = entry.split(",");
      return { version, sig };
    })
    .filter((entry) => entry.version === "v1" && entry.sig);

  const isValid = candidates.some((candidate) =>
    timingSafeEqual(candidate.sig, expectedSignature)
  );

  if (!isValid) {
    throw new WebhookVerificationError("Signature mismatch.");
  }
}
