import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPostalCode, joinPostal, normalizePostalCode, splitPostal } from "../lib/postal.ts";

test("postal codes are checked and tidied", () => {
  assert.equal(normalizePostalCode("v0e2s3"), "V0E 2S3");
  assert.equal(normalizePostalCode(" V7G 1G3 "), "V7G 1G3");
  assert.equal(normalizePostalCode("D0E 2S3"), null); // D is never used
  assert.equal(normalizePostalCode("12345"), null);
});

test("addresses split and join around the postal code", () => {
  assert.deepEqual(splitPostal("1702 Coursier Ave, Revelstoke, BC, V0E2S3"), {
    street: "1702 Coursier Ave, Revelstoke, BC",
    postal: "V0E 2S3",
  });
  assert.deepEqual(splitPostal("4540 Strathcona Road, North Vancouver BC, V7G 1G3"), {
    street: "4540 Strathcona Road, North Vancouver BC",
    postal: "V7G 1G3",
  });
  assert.deepEqual(splitPostal("1702 Coursier Ave, Revelstoke, BC"), { street: "1702 Coursier Ave, Revelstoke, BC", postal: "" });
  assert.equal(joinPostal("1702 Coursier Ave, Revelstoke, BC", "v0e2s3"), "1702 Coursier Ave, Revelstoke, BC, V0E 2S3");
  assert.equal(hasPostalCode("1702 Coursier Ave, Revelstoke, BC, V0E 2S3"), true);
  assert.equal(hasPostalCode("1702 Coursier Ave, Revelstoke, BC"), false);
});
