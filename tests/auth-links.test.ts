import { test } from "node:test";
import assert from "node:assert/strict";
import { authHref } from "../lib/auth/auth-links.ts";

test("carries a Library item through to sign-up", () => {
  assert.equal(authHref("/signup", { next: "/library/agm-checklist" }), "/signup?next=%2Flibrary%2Fagm-checklist");
});

test("keeps the email and the page together", () => {
  assert.equal(
    authHref("/signup", { email: "a@b.ca", next: "/library/agm-checklist?tab=steps" }),
    "/signup?email=a%40b.ca&next=%2Flibrary%2Fagm-checklist%3Ftab%3Dsteps"
  );
});

test("back to sign-in keeps the page too", () => {
  assert.equal(authHref("/login", { next: "/library/agm-checklist" }), "/login?next=%2Flibrary%2Fagm-checklist");
});

test("leaves off nothing, the home page, and anything off the site", () => {
  assert.equal(authHref("/signup"), "/signup");
  assert.equal(authHref("/signup", { next: "" }), "/signup");
  assert.equal(authHref("/signup", { next: "/" }), "/signup");
  assert.equal(authHref("/signup", { next: "https://evil.example" }), "/signup");
  assert.equal(authHref("/signup", { next: "//evil.example" }), "/signup");
  assert.equal(authHref("/signup", { next: "/\\evil.example" }), "/signup");
  assert.equal(authHref("/login", { email: "a@b.ca", next: "//evil.example" }), "/login?email=a%40b.ca");
});
