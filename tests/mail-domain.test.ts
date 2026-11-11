import { test } from "node:test";
import assert from "node:assert/strict";
import { clearMailDomainCache, domainTakesMail, emailDomain } from "../lib/security/mail-domain.ts";
import { verifyTurnstile } from "../lib/security/turnstile.ts";

const err = (code: string) => Object.assign(new Error(code), { code });
function resolver(map: Record<string, { mx?: Array<{ exchange: string; priority: number }> | string; a?: string[] | string; aaaa?: string[] | string }>) {
  const look = (domain: string, key: "mx" | "a" | "aaaa") => {
    const v = map[domain]?.[key];
    if (v === undefined) return Promise.reject(err(map[domain] ? "ENODATA" : "ENOTFOUND"));
    return typeof v === "string" ? Promise.reject(err(v)) : Promise.resolve(v);
  };
  return {
    resolveMx: (d: string) => look(d, "mx") as Promise<Array<{ exchange: string; priority: number }>>,
    resolve4: (d: string) => look(d, "a") as Promise<string[]>,
    resolve6: (d: string) => look(d, "aaaa") as Promise<string[]>,
  };
}

test("a domain with mail servers takes mail; a made-up or misspelt one doesn't", async () => {
  clearMailDomainCache();
  const r = resolver({ "gmail.com": { mx: [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }] }, "example.net": { mx: [{ exchange: ".", priority: 0 }] } });
  assert.equal(await domainTakesMail("Someone@GMAIL.com", r), true);
  assert.equal(await domainTakesMail("someone@gmial.com", r), false, "no such domain");
  assert.equal(await domainTakesMail("someone@example.net", r), false, "a null MX says no mail");
  assert.equal(await domainTakesMail("no-at-sign", r), false);
  assert.equal(await domainTakesMail("x@localhost", r), false);
});

test("no mail servers but an address record still takes mail; neither means no", async () => {
  clearMailDomainCache();
  const r = resolver({ "old-host.ca": { a: ["203.0.113.5"] }, "parked.ca": {} });
  assert.equal(await domainTakesMail("a@old-host.ca", r), true);
  assert.equal(await domainTakesMail("a@parked.ca", r), false);
});

test("DNS trouble never turns someone away", async () => {
  clearMailDomainCache();
  const r = resolver({ "slow.ca": { mx: "ETIMEOUT" }, "broken.ca": { mx: "ESERVFAIL" } });
  assert.equal(await domainTakesMail("a@slow.ca", r), true);
  assert.equal(await domainTakesMail("a@broken.ca", r), true);
  const hang = { resolveMx: () => new Promise<never>(() => undefined), resolve4: () => Promise.resolve([]), resolve6: () => Promise.resolve([]) };
  assert.equal(await domainTakesMail("a@hangs.ca", hang, 20), true, "a lookup that never answers times out to yes");
});

test("the domain is read after the last @, trimmed and lower-cased", () => {
  assert.equal(emailDomain("first.last@Sub.Example.CA."), "sub.example.ca");
  assert.equal(emailDomain('"odd@name"@example.com'), "example.com");
});

test("without a Turnstile secret (development), the check passes", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal(await verifyTurnstile(""), true);
});
