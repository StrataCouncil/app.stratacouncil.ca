import { test } from "node:test";
import assert from "node:assert/strict";
import { openTallyLine, resultLabel, tally } from "../lib/discussions/tally.ts";
import { discussionClosedEmail, discussionCommentEmail, discussionOpenedEmail } from "../lib/email/templates.ts";
import { safeNext } from "../lib/safe-next.ts";

const links = { for: "https://app.stratacouncil.ca/strata/BCS-1/discussions/x/vote?choice=for", against: "https://app.stratacouncil.ca/strata/BCS-1/discussions/x/vote?choice=against", abstain: "https://app.stratacouncil.ca/strata/BCS-1/discussions/x/vote?choice=abstain" };

test("Result column: carried motions wait for ratification; no-vote discussions say so", () => {
  const base = { result: null, voteRequired: true, voted: 3, voters: 7 } as const;
  assert.deepEqual(resultLabel({ ...base, status: "open" }), { label: "Voting: 3 of 7 voted", tone: "open" });
  assert.equal(resultLabel({ ...base, status: "awaiting_ratification", result: "supported" }).label, "Carried, awaiting ratification");
  assert.equal(resultLabel({ ...base, status: "ratified", result: "supported" }).label, "Carried and ratified");
  assert.equal(resultLabel({ ...base, status: "not_ratified", result: "supported" }).label, "Not ratified");
  assert.equal(resultLabel({ ...base, status: "closed", result: "not_supported" }).label, "Defeated");
  assert.equal(resultLabel({ ...base, status: "closed", result: "no_majority" }).label, "No majority");
  assert.equal(resultLabel({ ...base, status: "closed", voteRequired: false }).label, "No vote");
});

test("votes so far, while open", () => {
  assert.equal(openTallyLine(tally(["for", "for", "against", null, null, "recused"])), "2 for, 1 against, 0 abstaining, 2 still to vote, 1 recused");
});

test("opened email: the motion and three vote buttons, each to the confirm page", () => {
  const m = discussionOpenedEmail({ corporationName: "Larchwood", authorName: "Ana", title: "Roof", motion: "THAT council get <three> quotes.", voteLinks: links, openUrl: "https://app/x" });
  assert.match(m.html, /THAT council get &lt;three&gt; quotes\./);
  for (const href of Object.values(links)) assert.ok(m.html.includes(href.replace(/&/g, "&amp;")), href);
  assert.match(m.html, /signed in as you/);
  assert.match(m.text, /In favour: https:/);
});

test("no-vote discussion: no buttons, and closing says there's nothing to ratify", () => {
  const m = discussionOpenedEmail({ corporationName: "Larchwood", authorName: "Ana", title: "Parkade lights", motion: "", voteLinks: null, openUrl: "https://app/x" });
  assert.doesNotMatch(m.html, /Cast your vote/);
  assert.match(m.html, /no vote/);
  const c = discussionClosedEmail({ corporationName: "Larchwood", title: "Parkade lights", result: null, tally: null, passed: false, openUrl: "https://app/x" });
  assert.match(c.text, /nothing to ratify/);
});

test("comment email: the thread, newest first, names and text escaped", () => {
  const m = discussionCommentEmail({
    corporationName: "Larchwood",
    title: "Roof",
    motion: "THAT council get three quotes.",
    tally: "2 for, 0 against, 0 abstaining, 5 still to vote",
    comments: [
      { name: "Liam <b>", body: "Agree.", when: "Nov 5, 2026, 8:42 p.m. PT" },
      { name: "Ana", body: "Here's the report.", when: "Nov 5, 2026, 8:00 p.m. PT" },
    ],
    voteLinks: links,
    openUrl: "https://app/x",
  });
  assert.match(m.html, /Liam &lt;b&gt; commented/);
  assert.ok(m.html.indexOf("Agree.") < m.html.indexOf("Here&#39;s the report.") || m.html.indexOf("Agree.") < m.html.indexOf("Here's the report."));
  assert.match(m.html, /Votes so far:<\/strong> 2 for/);
  assert.equal(m.subject, "New comment: Roof");
});

test("sign-in returns to the confirm page, and only to this site", () => {
  assert.equal(safeNext("/strata/BCS-1/discussions/x/vote?choice=for"), "/strata/BCS-1/discussions/x/vote?choice=for");
  assert.equal(safeNext("https://evil.example/vote"), "/");
  assert.equal(safeNext("//evil.example"), "/");
});
