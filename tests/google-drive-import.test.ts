import { test } from "node:test";
import assert from "node:assert/strict";
import { finishGoogleDriveSignIn, googleSignInUrl, planImport, safeReturnPath, takeGoogleDriveSignIn } from "../lib/google-drive.ts";

const f = (name: string, mimeType: string, sizeBytes: number | null = 1000) => planImport({ id: "x", name, mimeType, sizeBytes });

test("Google Docs come in as Word; Sheets and Slides as PDF, so Stratasphere can read them", () => {
  assert.equal(f("Bylaws 2024", "application/vnd.google-apps.document", null).fileName, "Bylaws 2024.docx");
  assert.equal(f("Budget 2026", "application/vnd.google-apps.spreadsheet", null).fileName, "Budget 2026.pdf");
  assert.equal(f("AGM slides", "application/vnd.google-apps.presentation", null).fileName, "AGM slides.pdf");
  assert.equal(f("Bylaws 2024", "application/vnd.google-apps.document", null).problem, null);
});

test("ordinary files keep their names; unsupported ones are explained", () => {
  assert.deepEqual([f("Minutes.pdf", "application/pdf").fileName, f("Minutes.pdf", "application/pdf").problem], ["Minutes.pdf", null]);
  assert.match(f("Survey", "application/vnd.google-apps.form", null).problem ?? "", /can't be imported/);
  assert.match(f("Deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation").problem ?? "", /Only/);
  assert.match(f("Huge.pdf", "application/pdf", 60 * 1024 * 1024).problem ?? "", /50 MB/);
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test("Google sign-in is a full-page visit that comes back to our return page, for picked files only", () => {
  const url = new URL(googleSignInUrl("https://app.stratacouncil.ca", "abc:/strata/EPS1/documents"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.stratacouncil.ca/google-drive/return");
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(url.searchParams.get("state"), "abc:/strata/EPS1/documents");
});

test("only a path on this site can be returned to", () => {
  assert.equal(safeReturnPath("/strata/EPS1/documents?x=1"), "/strata/EPS1/documents?x=1");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "", null]) assert.equal(safeReturnPath(bad), "/");
});

test("Google's answer goes back to the starting page, once, and only for a sign-in this tab started", () => {
  const store = memoryStorage();
  store.setItem("google-drive-state", "n1");
  const back = finishGoogleDriveSignIn("#state=n1%3A%2Fstrata%2FEPS1%2Fdocuments&access_token=tok&expires_in=3599", store, 1000);
  assert.equal(back, "/strata/EPS1/documents");
  assert.deepEqual(takeGoogleDriveSignIn(store, 2000), { token: "tok", expiresAt: 1000 + 3599 * 1000 });
  assert.equal(takeGoogleDriveSignIn(store, 2000), null);

  // A token this tab didn't ask for is refused.
  const other = memoryStorage();
  other.setItem("google-drive-state", "mine");
  finishGoogleDriveSignIn("#state=theirs%3A%2F&access_token=tok", other);
  assert.ok("error" in takeGoogleDriveSignIn(other)!);
});

test("cancelling, a Workspace administrator's block and an expired token are explained", () => {
  const read = (hash: string, now?: number) => {
    const store = memoryStorage();
    store.setItem("google-drive-state", "n");
    finishGoogleDriveSignIn(hash, store, 0);
    const r = takeGoogleDriveSignIn(store, now);
    return r && "error" in r ? r.error : "";
  };
  assert.match(read("#state=n%3A%2F&error=access_denied"), /cancelled/);
  assert.match(read("#state=n%3A%2F&error=admin_policy_enforced"), /administrator/);
  assert.match(read("#state=n%3A%2F&access_token=t&expires_in=60", 61_000), /expired/);
});
