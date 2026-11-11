import { promises as dns } from "node:dns";

/**
 * Whether an email address's domain can receive mail, checked before we
 * send it a link: a domain with no mail servers (a typo like gmial.com, or
 * a made-up one) only bounces, and hard bounces hurt delivery of everyone's
 * sign-in links (Mailtrap, 2026-11-11).
 *
 * Mail servers (MX) means yes. No MX but an address record means yes too
 * (mail falls back to it). A "null MX" (RFC 7505), or no such domain,
 * means no. Anything uncertain (a timeout, a DNS server error) means yes:
 * we never turn someone away because DNS was slow.
 */

type Resolver = {
  resolveMx: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolve4: (domain: string) => Promise<string[]>;
  resolve6: (domain: string) => Promise<string[]>;
};

const cache = new Map<string, { at: number; ok: boolean }>();
const CACHE_MS = 60 * 60 * 1000;
const code = (err: unknown) => (err as { code?: string } | null)?.code ?? "";
const ABSENT = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

export async function domainTakesMail(email: string, resolver: Resolver = dns, timeoutMs = 3000): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes("..")) return false;
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;

  const remember = (ok: boolean) => {
    cache.set(domain, { at: Date.now(), ok });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return ok;
  };
  try {
    const mx = await withTimeout(resolver.resolveMx(domain), timeoutMs);
    if (mx.length === 0) return remember(await hasAddress(domain, resolver, timeoutMs));
    // A null MX: the domain says it takes no mail.
    if (mx.every((r) => r.exchange === "" || r.exchange === ".")) return remember(false);
    return remember(true);
  } catch (err) {
    if (code(err) === "ENOTFOUND" || code(err) === "NXDOMAIN") return remember(false);
    if (code(err) === "ENODATA") return remember(await hasAddress(domain, resolver, timeoutMs));
    return true;
  }
}

async function hasAddress(domain: string, resolver: Resolver, timeoutMs: number): Promise<boolean> {
  for (const look of [resolver.resolve4, resolver.resolve6]) {
    try {
      if ((await withTimeout(look.call(resolver, domain), timeoutMs)).length) return true;
    } catch (err) {
      if (!ABSENT.has(code(err))) return true;
    }
  }
  return false;
}

/** Only for tests. */
export function clearMailDomainCache() {
  cache.clear();
}
