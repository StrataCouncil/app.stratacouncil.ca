import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin, hasManagement, imageSize, letterheadLines, emptyManagement } from "../lib/management.ts";

test("letterhead lines", () => {
  const m = {
    ...emptyManagement(),
    companyName: "Alpine Strata Management Ltd.",
    address: "100 Main St, Revelstoke, BC, V0E 2S0",
    phone: "250-555-0100",
    email: "info@alpine.example",
    managers: [
      { name: "Pat Lee", title: "Strata Manager", phone: "250-555-0101", email: "pat@alpine.example" },
      { name: "", title: "", phone: "", email: "" },
    ],
  };
  assert.deepEqual(letterheadLines(m), [
    { text: "Alpine Strata Management Ltd.", bold: true },
    { text: "100 Main St, Revelstoke, BC, V0E 2S0" },
    { text: "250-555-0100 · info@alpine.example" },
    { text: "Pat Lee, Strata Manager · 250-555-0101 · pat@alpine.example" },
  ]);
  assert.equal(hasManagement(emptyManagement()), false);
  assert.equal(hasManagement(m), true);
});

test("image size from PNG and JPEG headers, and fitting", () => {
  // Minimal PNG header: 300 x 120.
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.set([0, 0, 1, 44, 0, 0, 0, 120], 16);
  assert.deepEqual(imageSize(png), { width: 300, height: 120, type: "png" });
  // Minimal JPEG: SOI, APP0 (len 4), SOF0 with height 50, width 200.
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 200, 3, 0, 0, 0]);
  assert.deepEqual(imageSize(jpg), { width: 200, height: 50, type: "jpg" });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(fitWithin(300, 120, 150, 60), { width: 150, height: 60 });
  assert.deepEqual(fitWithin(100, 40, 150, 60), { width: 100, height: 40 });
});
