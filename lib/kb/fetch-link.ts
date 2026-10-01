import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetch an agenda link attachment once, server-side, so its content can be
 * indexed like any other document. Guarded against being turned into a
 * way to reach internal services: http(s) only, standard ports, every
 * redirect hop re-checked, private/loopback/link-local/metadata addresses
 * refused, 10 second timeout, 10 MB cap.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;

export class LinkFetchError extends Error {}

function isPrivateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) {
    // IPv4-mapped: "::ffff:127.0.0.1", or the hex form URL parsing produces, "::ffff:7f00:1".
    const rest = v6.slice(7);
    if (isIP(rest) === 4) return isPrivateAddress(rest);
    const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!m) return true;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // NAT64 and other embedded-IPv4 forms aren't legitimate link targets here.
  if (v6.startsWith("64:ff9b:") || v6.startsWith("2002:")) return true;
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkFetchError("Only http and https links can be indexed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new LinkFetchError("That link uses a non-standard port.");
  if (url.username || url.password) throw new LinkFetchError("Links with embedded credentials can't be indexed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new LinkFetchError("That link's site couldn't be found.");
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new LinkFetchError("That link points at a private address.");
}

export async function fetchLink(raw: string): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkFetchError("That isn't a valid link.");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "StrataCouncil.ca link indexer", Accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.1" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new LinkFetchError(`The link returned an error (${res.status}).`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new LinkFetchError("That page is too large to index.");

    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new LinkFetchError("That page is too large to index.");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.byteLength;
    }
    return { bytes, contentType: res.headers.get("content-type") ?? "", finalUrl: url.toString() };
  }
  throw new LinkFetchError("That link redirects too many times.");
}
