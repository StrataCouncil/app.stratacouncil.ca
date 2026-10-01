/**
 * Knowledge-base plumbing that runs on our own servers: text extraction,
 * chunking, and the link-fetch guard. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chunkText } from "../lib/kb/chunk.ts";
import { extractDocumentText, htmlToText } from "../lib/kb/extract.ts";
import { fetchLink, LinkFetchError } from "../lib/kb/fetch-link.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test("PDF with a text layer is extracted", async () => {
  const r = await extractDocumentText(fixture("bylaws.pdf"), "bylaws.pdf", "application/pdf");
  assert.equal(r.status, "ok");
  if (r.status === "ok") assert.match(r.text, /must not cause a nuisance\. Section 29/);
});

test("scanned PDF (no text layer) is flagged, not sent anywhere", async () => {
  const r = await extractDocumentText(fixture("scanned.pdf"), "scan.pdf", "application/pdf");
  assert.equal(r.status, "needs_text");
});

test("docx is extracted", async () => {
  const r = await extractDocumentText(fixture("bylaws.docx"), "bylaws.docx", null);
  assert.equal(r.status, "ok");
  if (r.status === "ok") assert.match(r.text, /Section 1\./);
});

test("txt is extracted and whitespace normalized", async () => {
  const r = await extractDocumentText(new TextEncoder().encode("a  b\r\n\r\n\r\n\r\nc"), "x.txt", "text/plain");
  assert.deepEqual(r, { status: "ok", text: "a b\n\nc" });
});

test("images and spreadsheets are unsupported", async () => {
  const r = await extractDocumentText(new Uint8Array([1, 2, 3]), "photo.jpg", "image/jpeg");
  assert.equal(r.status, "unsupported");
});

test("html to text drops scripts and tags", () => {
  assert.equal(
    htmlToText("<head><title>x</title></head><p>Hello&nbsp;<b>there</b></p><script>alert(1)</script>").replace(/\s+/g, " ").trim(),
    "Hello there"
  );
});

test("chunks: short text is one chunk", () => {
  assert.deepEqual(chunkText("  short  "), ["short"]);
  assert.deepEqual(chunkText(""), []);
});

test("chunks: sizes within bounds, overlap present, nothing lost", () => {
  const text = readFileSync(new URL("./fixtures/bylaws.txt", import.meta.url), "utf8").repeat(3);
  const chunks = chunkText(text);
  assert.ok(chunks.length > 3);
  for (const c of chunks.slice(0, -1)) assert.ok(c.length >= 1300 && c.length <= 2000, `chunk length ${c.length}`);
  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].slice(-60);
    assert.ok(chunks[i].includes(tail.slice(tail.indexOf(" ") + 1, tail.indexOf(" ") + 30)), "overlap with previous chunk");
  }
  const words = new Set(text.split(/\s+/));
  const covered = new Set(chunks.join(" ").split(/\s+/));
  for (const w of words) assert.ok(covered.has(w), `lost word ${w}`);
});

test("chunks: a single unbroken run still splits", () => {
  const chunks = chunkText("x".repeat(5000));
  assert.ok(chunks.every((c) => c.length <= 2000));
  assert.ok(chunks.join("").length >= 5000);
});

for (const [label, url] of [
  ["file scheme", "file:///etc/passwd"],
  ["loopback", "http://127.0.0.1/"],
  ["localhost name", "http://localhost/"],
  ["metadata service", "http://169.254.169.254/latest/meta-data/"],
  ["private range", "http://10.1.2.3/"],
  ["IPv6 loopback", "http://[::1]/"],
  ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/"],
  ["odd port", "http://example.com:8080/"],
  ["credentials", "https://user:pw@example.com/"],
  ["garbage", "not a url"],
] as const) {
  test(`link guard refuses ${label}`, async () => {
    await assert.rejects(fetchLink(url), LinkFetchError);
  });
}
