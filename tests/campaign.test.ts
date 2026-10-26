import { test } from "node:test";
import assert from "node:assert/strict";
import { readCampaign } from "../lib/campaign.ts";

test("reads the five campaign tags from a link", () => {
  const params = new URLSearchParams(
    "utm_source=facebook&utm_medium=social&utm_campaign=council-duties&utm_content=2026-10-27&email=a@b.ca"
  );
  assert.deepEqual(readCampaign(params), {
    utm_source: "facebook",
    utm_medium: "social",
    utm_campaign: "council-duties",
    utm_content: "2026-10-27",
  });
});

test("no tags, no campaign; blanks and other keys are dropped", () => {
  assert.equal(readCampaign(new URLSearchParams("email=a@b.ca")), null);
  assert.equal(readCampaign(new URLSearchParams("utm_source=%20%20")), null);
  assert.deepEqual(readCampaign(new URLSearchParams("utm_source=%20x%20&gclid=1")), { utm_source: "x" });
});

test("each tag is cut to 100 characters, and form files are ignored", () => {
  const form = new FormData();
  form.set("utm_campaign", "c".repeat(300));
  form.set("utm_source", new Blob(["x"]) as unknown as string);
  assert.deepEqual(readCampaign(form), { utm_campaign: "c".repeat(100) });
});
