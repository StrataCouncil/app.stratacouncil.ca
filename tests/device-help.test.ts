import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBrowser, deviceHelp, troubleFrom } from "../lib/meetings/device-help.ts";

const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const WIN_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

test("knows the browser and computer", () => {
  assert.deepEqual(detectBrowser(MAC_CHROME), { browser: "chrome", platform: "mac" });
  assert.deepEqual(detectBrowser(MAC_SAFARI), { browser: "safari", platform: "mac" });
  assert.deepEqual(detectBrowser(WIN_EDGE), { browser: "edge", platform: "windows" });
  assert.deepEqual(detectBrowser(WIN_FIREFOX), { browser: "firefox", platform: "windows" });
  // An iPad says it's a Mac; its touch screen gives it away.
  assert.deepEqual(detectBrowser(MAC_SAFARI, 5), { browser: "safari", platform: "ipad" });
});

test("tells blocked, busy, and missing apart", () => {
  assert.equal(troubleFrom({ name: "NotAllowedError" }), "blocked");
  assert.equal(troubleFrom({ name: "NotReadableError" }), "in-use");
  assert.equal(troubleFrom({ name: "NotFoundError" }), "missing");
  assert.equal(troubleFrom(new Error("something else")), "other");
});

test("help is written for the browser and computer in front of them", () => {
  const macChrome = deviceHelp("blocked", "chrome", "mac");
  assert.match(macChrome.steps.join(" "), /address bar/);
  assert.match(macChrome.steps.join(" "), /System Settings, then Privacy & Security/);
  assert.match(macChrome.steps.join(" "), /turn on Chrome/);
  assert.match(deviceHelp("blocked", "safari", "mac").steps.join(" "), /Settings for This Website/);
  assert.match(deviceHelp("blocked", "edge", "windows").steps.join(" "), /Privacy & security/);
  assert.match(deviceHelp("blocked", "safari", "ipad").steps.join(" "), /Website Settings/);
  assert.match(deviceHelp("in-use", "chrome", "mac").steps.join(" "), /Zoom, Teams, FaceTime/);
  for (const h of [macChrome, deviceHelp("missing", "chrome", "windows")]) assert.match(h.steps.at(-1)!, /Try again/);
});

test("a refusal is told apart: the browser, the computer, or a page opened before it was allowed", () => {
  assert.equal(troubleFrom({ name: "NotAllowedError", message: "Permission denied" }, false), "blocked");
  assert.equal(troubleFrom({ name: "NotAllowedError", message: "Permission denied by system" }, true), "system");
  assert.equal(troubleFrom({ name: "NotAllowedError", message: "Permission denied" }, true), "reload");
  assert.match(deviceHelp("system", "chrome", "mac").steps.join(" "), /Privacy & Security/);
  assert.equal(deviceHelp("reload", "chrome", "mac").title, "Reload this page");
});

test("every page may use the camera and microphone (this site only): the app moves between pages without reloading", async () => {
  const { default: config } = await import("../next.config.mjs");
  const rules = await config.headers();
  const site = rules.find((r: { source: string }) => r.source === "/:path*");
  const policy = site.headers.find((h: { key: string }) => h.key === "Permissions-Policy").value as string;
  assert.match(policy, /camera=\(self\)/);
  assert.match(policy, /microphone=\(self\)/);
  assert.match(policy, /geolocation=\(\)/);
  // No page narrows it again.
  for (const r of rules) {
    for (const h of r.headers) if (h.key === "Permissions-Policy") assert.match(h.value, /camera=\(self\)/, r.source);
  }
});
