/**
 * A file's fingerprint: the SHA-256 of its bytes, as lowercase hex. Two
 * files with the same fingerprint are the same file. Works in the browser
 * and on the server (Web Crypto), so an upload can be checked against
 * Documents before it's sent; the stored fingerprint is always the
 * server's own (lib/inngest/fingerprint-document.ts).
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
