import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBillingAddress, parseCivicAddress, readBillingAddress, toStripeAddress } from "../lib/billing-address.ts";

test("a stored civic address splits into Stripe's parts", () => {
  assert.deepEqual(parseCivicAddress("1702 Coursier Ave, Revelstoke, BC, V0E 2S1"), {
    line1: "1702 Coursier Ave",
    line2: "",
    city: "Revelstoke",
    province: "BC",
    postalCode: "V0E 2S1",
  });
});

test("a unit number stays on the street line, and a missing postal code is allowed", () => {
  assert.deepEqual(parseCivicAddress("Unit 4, 100 Main St, Nelson, BC"), {
    line1: "Unit 4, 100 Main St",
    line2: "",
    city: "Nelson",
    province: "BC",
    postalCode: "",
  });
});

test("an address it can't read is left alone", () => {
  assert.equal(parseCivicAddress("somewhere nice"), null);
  assert.equal(parseCivicAddress("1 Main, Town, XX, V0E 2S1"), null);
});

test("a typed address is checked and cleaned", () => {
  const ok = readBillingAddress({ line1: " 200  Burrard St ", city: "Vancouver", province: "bc", postalCode: "v6c3l6" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.address.postalCode, "V6C 3L6");
    assert.equal(formatBillingAddress(ok.address), "200 Burrard St, Vancouver, BC, V6C 3L6");
    assert.deepEqual(toStripeAddress(ok.address), { line1: "200 Burrard St", line2: undefined, city: "Vancouver", state: "BC", postal_code: "V6C 3L6", country: "CA" });
  }
  assert.deepEqual(readBillingAddress({ line1: "1 A St", city: "X", province: "BC", postalCode: "12345" }), { ok: false, error: "Enter a valid postal code, like V0E 2S1." });
});
