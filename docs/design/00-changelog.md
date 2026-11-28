# StrataCouncil.ca: Project log

**What this is:** a dated record of what was decided, changed, and why, newest first. The design docs beside it (`docs/design/01` to `05`) describe how things work now; this log is how they got that way.

**How it's kept:** every PR that changes behaviour adds to the entry for its date, naming the PR and any migration. Entries say what changed and why, not a transcript.

**Before 2026-10-24:** entries were written in a separate planning chat and copied here when the docs moved into the repo (2026-11-21). They're kept as written, except that the product the early design borrowed from is no longer named; it appears as "the reference product".

---

## 2026-11-28 — Scanned pages read twice, the better reading kept

**Why:** monthly financial statements scanned from paper often showed "some pages unclear". Nothing had got worse (scans weren't read at all before November 3), but tables of figures are the hardest case for OCR, and the confidence score alone can mislead: on a poor test scan the reading reported 93% confidence and found none of the figures.

**What changed:** the background indexer reads each scanned page a second way, at about 300 dots per inch and as one block (Tesseract page segmentation mode 6), and keeps whichever reading recovered more text, weighted by confidence (`betterReading`, `lib/kb/ocr.ts`). Reads someone waits on (historic minutes, an uploaded agenda, a Strata Plan) keep the single, faster reading. Scans read before this are read again once, 20 an hour (`lib/inngest/reread-scans.ts`).

**Measured** on made-up scanned statements (20 accounts, 60 figures): clean scans unchanged (97%); a fax-quality scan 88% to 97%; a poor 120 dpi scan 0% to 70%. A very poor 100 dpi scan stays unreadable either way. Each scanned page takes about twice as long to read in the background.

**Checked:** typecheck; unit tests, including the choice between readings and a careful read of a test scan.

## 2026-11-28 — Agenda links stay on the agenda; spreadsheets and photos are read (0102)

**Why:** links attached to agenda items were also filed in Documents and fetched for Stratasphere, but most point at shared drives that need a sign-in, so they failed ("The link returned an error (401)") and cluttered Documents. Spreadsheets and photos could be uploaded but were never read.

**What changed:**
- **Links:** a link added to an agenda item is kept on that item only: not filed in Documents, not fetched or read. The panel says so and suggests uploading the file instead (`addLinkAttachment`, `components/meetings/ItemEditor.tsx`).
- **0102:** every agenda attachment that pointed at a link document becomes an inline link with the same address and title, adjourned meetings included (the meetings guard is lifted for that update only); the link documents and their passages are removed; `documents_no_links` stops new ones. Safe to re-run; no new grants. (Fixed the same day: the first version stopped at an adjourned meeting with a filed link and changed nothing.)
- **Spreadsheets:** .xlsx (every sheet, one line per row, dates as YYYY-MM-DD, formulas as their saved result) and .csv are read on our own servers (`lib/kb/spreadsheet.ts`).
- **Photos:** .jpg and .png are read by OCR on our own servers, like a scanned page. A file that isn't really an image is marked unreadable rather than crashing the reader.
- **Already uploaded:** spreadsheets and photos stored as "not indexable" are queued by the hourly job, 50 an hour, until none are left (`lib/inngest/reread-scans.ts`).

**Checked:** typecheck; unit tests (521), including a two-sheet workbook, CSV quoting, dates and a photo of a notice read by OCR; database suites, including a new one (`agenda-links`) that runs 0102 over a meeting with a filed link, twice.

## 2026-11-28 — Notes: bringing people into a strata

`docs/joining-a-strata.md`: how invites and access requests differ, the order of steps that keeps a council lot's role when approving a request (roles first, then the lot), the two email fields on a lot, the risk of role mailboxes as sign-ins, and possible improvements not yet built. Docs only; no change to the app.

## 2026-11-28 — Library items keep every source

**Why:** saving a Library item kept only its first 20 sources and dropped the rest without saying so. The budget playbook cites about 40 sections.

**What changed:** no limit on how many sources an item keeps (`lib/library/library.ts`). Duplicates and empty entries are still removed. An item saved before this change keeps only the 20 sources it was saved with; attach any missing ones again.

**Checked:** typecheck and unit tests, including a 45-source item.

## 2026-11-28 — Library Share opens the share sheet; cleaner printing

**Why:** Share copied the link on a computer even where the browser has a share sheet (Messages, Mail). On paper, the item's card edge ran down every sheet, and the browser's page header read "StrataCouncil.ca" rather than the item.

**What changed:** Share opens the device's own share sheet wherever the browser offers one, phone or computer, and copies the link only where it doesn't (`components/library/LibraryShare.tsx`). The item's name is now the page title, so it shows in the browser tab, the share sheet, and the top of a printed page (`app/library/[resourceId]/page.tsx`). Printed, the item has no card border and the page has even margins (`app/globals.css`). The date, page number and address at the very top and bottom of a printed page come from the browser; its "Headers and footers" setting turns them off, and the item's own address still prints at the end.

**Checked:** typecheck and unit tests.

## 2026-11-28 — Stratasphere keeps its conversation; Share and Print in the Library

**Why:** after "Ask" beside a document in a list (Documents), the floating Stratasphere window showed the answer, then emptied. The conversation was saved (the full page had it) but the window had gone back to following the page, which is about no one document. The window also had no "still working" dots, and a document still being read gave no warning until the answer said it couldn't be used. Library items had no way to share or print.

**What changed:**
- **Conversation kept:** the window follows the page only when the page changes what it shows, not when an answer finishes (`components/StratasphereDock.tsx`).
- **Dots:** the pulsing dots from the full page now show in the window, after "Searching your records" and at the end of the text while it writes.
- **Still reading:** asking about a document that's still being read shows "Still reading this document. Answers won't include it until it's done." under "Looking at". It goes away when the document is read (`components/DocumentList.tsx`).
- **Share and Print** under a Library item's date (`components/library/LibraryShare.tsx`). Share opens the phone's share sheet; on a computer it copies the link. Print keeps just the item, then its legislation (the sidebar doesn't print) and the page's address.
- **Printing fixed everywhere:** the print rule for MFA backup codes hid everything on every page; it now applies only to the page that shows backup codes (`app/globals.css`).

**Checked:** typecheck and unit tests. In a browser, with the answer stream simulated: on the old code the conversation and "Looking at" vanished when the answer finished; on the new code both stay, the dots show, and the reading note clears when reading finishes. Share copied the link; the printed page shows the item, its sources, and its address.

## 2026-11-27 — Citing a section finds the right Act

**Why:** in the console's source search (Library and Council Training), "Strata Property Act, s. 37" returned section 37 of five other laws and not the Strata Property Act. The lookup matched the section number only, ignored the Act's name, and kept the first four matches from the whole Knowledge Base.

**What changed:** a reference that names a Knowledge Base entry, by title or by an abbreviation of three or more capitals (SPA, RESA), now returns only that entry's sections. A bare number ("37") returns that section from every entry, up to 20 rather than 4, with the Strata Property Act first, then the Regulation, the Real Estate Services Act, and its Rules (`lib/training/library.ts`, `lib/training/library-server.ts`). The sections suggested for statements flagged when tidying a Library draft use the same lookup, so they're more precise too. When the draft names the section a flagged statement relies on, the tidy step now puts that law's full name and section in the statement's search (`lib/library/tidy.ts`), so the suggestion is that exact section rather than a guess by meaning. Before, "the old company must return the records within 4 weeks" found no section even though the draft cited s. 37.

**Checked:** unit tests for reading labels, matching named entries, and ordering. The lookup itself runs against the live Knowledge Base, so check it in the console after deploying.

## 2026-11-25 — Phone header: no rule above the sections

The thin rule between the header's first row and the centred sections is gone (it wasn't wanted). Nothing else changed.

## 2026-11-25 — App header tidied on phones

**Why:** on a phone the account menu sat beside the logo and the section menu wrapped unevenly under both, left-aligned.

**What changed:** at 720px and narrower, the mark sits on the left, the account menu on the right, and the sections are centred on one row beneath a thin rule. On phones 400px and narrower, Super Admin (staff only) reads "Admin", with "Super Admin" kept as its accessible name, so four sections still fit on one row down to 360px. Wider screens are unchanged.

**Checked:** the header was rendered with the app's stylesheet at 360, 390, 700, and 1280px, with and without Super Admin. Every width kept one row of sections and no sideways scroll.

## 2026-11-25 — New accounts land on the page they were sent to

**Why:** a link to a Library item (the AGM card, say) sent to someone without an account ended on the Training page after they signed up, not on the item. Sign-in already kept the page (`next`), but the links from sign-in to sign-up dropped it, and the sign-up form didn't send it.

**What changed:**

- The sign-in page's "Create an account" and "Start free training" links, and the sign-up page's "Sign in" link, carry `next` (`lib/auth/auth-links.ts`).
- The sign-up form sends `next` with the request, so the confirmation email's link (`/auth/confirm?next=…`) brings the new account to that page.
- Someone already signed in who opens `/login` or `/signup` with a `next` goes straight to that page instead of the dashboard.
- Only pages on the app are ever carried (`safeNext`), so a link can't send people to another site.

**Also fixed:** the `legislation` database suite assumed an empty Knowledge Base. 0101 (#244) adds two BC Laws entries, which broke the suite on main. It now clears them first.

**Checked:** unit tests for the links; every database suite passes. A browser run on a local build followed a Library link through sign-in, sign-up, and back to sign-in, then submitted the sign-up. The request carried `/auth/confirm?next=%2Flibrary%2F…` as the email's link. The last step (clicking the real email) needs the live site.

## 2026-11-22 — Citations repaired when the Knowledge Base changes

**Why:** training slides, Library items, and recall cases cite Knowledge Base passages by ID. When BC Laws publishes a new version (0101) or an entry is deleted (PIPEDA, FIPPA, the Canadian Human Rights Act, the Standard Bylaws PDF), a passage can change ID or disappear, and its citations point at nothing. Sources change as often as monthly, so this has to be automatic.

**What changed:**

- **Certain re-links happen automatically after every re-index and every deletion** (`lib/kb/citation-repair.ts`). A citation is re-linked automatically only when its label names a section of an entry still in the library ("Strata Property Act, s. 45 ...", "Standard Bylaw 20", "Form B") and that section exists. A numbered Standard Bylaw cited from the deleted PDF moves to the Act's Schedule.
- **The published copy is updated too.** Learners read only labels, so the published copy of each affected training module has those labels corrected in place. Library items have both their draft and published sources fixed.
- **Unread references are dropped.** Dangling IDs nobody reads (AI build inputs on training imports, and section suggestions on flagged Library statements) are removed.
- **Guesses go to a person.** Anything that would be a guess goes to **Citations** on the Knowledge Base screen, with up to three suggested sections found by meaning, to "Use" or "Remove". That covers:
  - whole-entry citations (the Rules were cited as a whole while they were filed as guidance, and the PDF had no sections);
  - citations of deleted laws with no same-law successor (federal Acts are never swapped for BC ones automatically);
  - sections that no longer exist.
- **Recall cases keep only IDs,** and their questions hold real records, so they're listed without meaning search.

**Not tested end to end here:** the database side needs a live Supabase API. The matching rules have unit tests. After deploying, press **Check citations** on the Knowledge Base screen.

## 2026-11-22 — Knowledge Base read from BC Laws (migration 0101)

**Why:** an audit found every BC Laws entry out of date. BC Laws had all of them current to November 17, 2026, but the library held:

| Entries | Current to |
| --- | --- |
| Strata Property Act | July 14 |
| Strata Property Regulation, RESA, the Rules, and PIPA | June 2 |
| Everything else | October 6 or earlier |

The Rules had also been filed as guidance, so they were never split by section and couldn't be cited by section. The Real Estate Services Regulation and BC's Human Rights Code (named in SPA s. 121) were missing.

**What changed:**

- **Each Act or regulation carries its BC Laws link.** The app reads the HTML straight from BC Laws, including every part of a long Act: the SPA has 18 parts, the Land Title Act 32, and the Workers Compensation Act 11. It stores the text, indexes it, and every Monday at 1:41 a.m. PT checks for a newer consolidation. It replaces the text only when BC Laws has a newer one. `lib/kb/bclaws.ts`, `lib/inngest/refresh-legislation.ts`.
- **Knowledge Base screen:**
  - Edit takes a BC Laws link;
  - each entry shows when BC Laws was last checked, and any error;
  - "Update from BC Laws" re-reads one entry, and "Check BC Laws now" checks them all.
- **Only BC Laws complete-document links are accepted.** They are checked in code and by a table constraint. Nothing else is fetched.
- **The conversion was checked against the live site for all 22 linked instruments.** The section counts match what the library already had, for example SPA 332, SPR 117, RESA 126, and PIPA 62. Three differ: the Rules now give 103 sections (previously 78 unsplit passages), the Land Title Act 520 (was 523), and the Residential Tenancy Act 135 (was 132). The last two are plausibly changes in the newer consolidations. Spot-check them after the refresh.
- **Migration 0101:**
  - adds `source_url`, `source_checked_at`, and `source_error`;
  - links every existing BC Laws entry by name;
  - files the Rules as a regulation;
  - adds the Real Estate Services Regulation and the Human Rights Code.

  It is safe to re-run, and no grants are needed. Database suite `legislation-sources` covers it.

**After running 0101:** press "Check BC Laws now". The owner was also asked to delete four entries by hand:
- PIPEDA, because privacy is under PIPA only;
- FIPPA, which governs public bodies;
- the Canadian Human Rights Act, which is federal (the Human Rights Code replaces it);
- the separate Standard Bylaws PDF, because the SPA's own Schedule is now the source.

Guidance with no date or publisher still needs its source and published date.

## 2026-11-22 — Motion: cards, menus, completed training

Follow-up to yesterday's motion work (05, Motion), all off under reduced motion:

- **Cards** that open something (Library and Forms & Templates items, training tracks, document folders, flip cards) lift on hover and press in like buttons.
- **Text menus** (top menu, section tabs, account menu) ease their colour, grow a tab's underline from the centre on hover, sink slightly when pressed, and the account menu opens with a short ease-out.
- **Completed training** uses the drawn tick: the circle draws, fills green, and the tick draws in white, staggered down the list, on a track's path, a module's topic menu, and Your progress (whose note now says a green tick means the track is complete).

## 2026-11-21 (evening) — Motion

Small animations that make the app feel finished, on every plan, and off for anyone whose device asks for reduced motion (05, Motion):

- **Buttons** press in to 95% and spring back.
- **Live vote counts** in Meeting Mode roll digit by digit as votes arrive, instead of jumping. How votes are cast, counted, and closed is unchanged.
- **A drawn tick** marks real successes: a member's vote recorded in a meeting or from a Discussion email, a motion carried (runner and members), minutes just finalized (with a new "Minutes finalized" note), and a training module complete.
- **Opening** settles with one 350 ms ease-out: training accordions and flip cards, the People tab sections, Directives, and the Stratasphere window.
- New `components/motion` (RollingNumber, SuccessTick) and `tests/motion.test.ts`.

## 2026-11-21 (later) — Library: management RFP; placeholders removed

- **Hiring a strata management company (migration 0100, then the console):** 0100 added "Request for proposal: strata management services" to the Library as a draft Form. Correction: the RFP material is an Operational Guide, "Hiring a strata management company: running an RFP", written and published in the console rather than by migration. It covers who decides (SPA ss. 4, 26, 27, 97), ending the current agreement (ss. 24, 39), council's duties (ss. 31, 32), and ten steps from defining what the strata needs to the handover. The draft Form 0100 added stays unpublished until a Super Admin reworks or deletes it; a companion RFP template and checklist will be made in the console and linked from the guide's Step 3. It goes with Council Ready Module 5.
- **Placeholder articles removed:** the hard-coded "Coming soon" sample articles (depreciation reports, fire alarm, pet policy and the rest) are gone from the Library and Forms & Templates. Every item is now written and published in the console; an empty list says "Nothing published here yet." Old links to a placeholder land back on the Library.
- 0049 now lists the Form kind in its check, so re-running it never narrows the check under a Library that holds forms.

## 2026-11-21 — Design docs move into the repo; Council Ready Modules 1 and 5

**Design docs (this PR):** docs 00 to 05 now live in `docs/design` and are rewritten to describe what is built. Doc 04 (technical and deployment) is new, written from the code. The reference product is no longer named anywhere, and privacy is stated under PIPA only. From here, each PR updates the docs it changes.

**Council Ready Module 5 rebuilt (PR 238, migration 0098):** "Working with your strata manager and contractors" becomes 20 minutes and 30 steps: the relationship, choosing a company, the management agreement, the brokerage's duties and disclosures, communicating, oversight, problems, changing companies, then contractors and a scenario check. Every legal point was checked against the current Strata Property Act and Real Estate Services Rules on BC Laws. Corrections to the source outline: section 24 covers any agreement made before the first AGM; spending follows sections 96 to 98 fund by fund; statements credited to the BCFSA guide that couldn't be checked are stated as good practice. Added and verified: what a strata management agreement must contain (Rules s. 43), two signatures on reserve fund and special levy trust accounts and monthly statements within 6 weeks (s. 77), the records deadline after termination (s. 88), and moving the money at the end (s. 77). Council Ready is now 114 minutes.

**Council Ready Module 1 (PR 239, migration 0099):** the conflict of interest sentence said to leave the discussion "if asked". Section 32 says the opposite: leave while the matter is discussed unless council asks you to stay to provide information, and while council votes.

## 2026-11-19 — Demo meeting video; your own camera; Next.js 15.5.29

- **Generated council loops (PR 236):** the five sample council members are silent loops made with ElevenLabs (Seedance 2.5 Flash) from text descriptions: each looks at the camera, reads their notes, and looks back up. Each plays forward then back and is slowed by a different amount, so the loops run 20 to 26 seconds and drift apart, and each tile starts at a different point. The rotating "speaking" outline is gone.
- **Your camera in the demo (PR 237):** a Start camera button shows the visitor's own camera, mirrored, in their tile, on their screen only. Nothing is sent anywhere.
- **Security (PR 237):** Next.js 15.5.29 fixes three moderate advisories GitHub reported.

## 2026-11-17 — Meeting video tools; demo fix

- **Meeting video (PR 232):** raised hands with a queue the host keeps (over Zoom's command channel, never stored), chat to everyone only (gone at adjournment, never in the minutes), chair controls (mute, ask to unmute, mute everyone, spotlight, co-hosts, remove), pin, and speaker and gallery views. Co-hosts are anyone who can run meetings. People and Chat tabs replace the In attendance list. Zoom screen sharing stays off; Share on screen is ours. The only thing about video in the minutes is that the meeting was held electronically.
- **Stratasphere floats (PR 232):** a movable, resizable window on every page; the Ask Stratasphere button sits bottom right everywhere except the Stratasphere page.
- **Fixes:** the demo failed to open after Directives (a batch insert sent null for missing columns; PR 233). The People tab's sections start collapsed, one open at a time, and people are matched to the video by the token's user key or name when the session identity is empty (PR 234). Ask to unmute reaches people whose sound hasn't started, over the command channel, and the People list shows "Sound not on" (PR 235). Links in chat open in a new tab (PR 235).

## 2026-11-16 — Directives (PR 231, migration 0097)

Follow-up from what council decided. Carried motions that call for action become directives when the meeting adjourns, and so do Discussions that close with council in favour (cancelled if a later meeting doesn't ratify them). Someone who runs meetings can add one by hand. On a subscription, Stratasphere words them; on the free plan they use the motion's own words. They live in a Directives tab beside Discussions, in the app only (emails and reminders later), never in the agenda or minutes. Council, meeting runners and the strata's managers see them; a manager can only mark one done. Stratasphere reads them.

## 2026-11-15 — Training: download as text (PR 230)

Super Admins can download a module's slides as text, to review outside the builder.

## 2026-11-13 — Stratasphere answers and citations; demo council; sign-in

- **Citations (PR 229):** every record in Stratasphere's context is tagged; answers cite the tags they used, and the app turns them into "Sources used". The recall check now checks answers and their sources.
- **Calculator, strata details, leaner context (PR 228, migration 0096):** a calculator tool so sums aren't done in the model's head; the instruction to answer the question asked; the strata's fiscal year (asked for when blank). Admins edit the building name, address and fiscal year on the Overview; Super Admins also edit the legal name, jurisdiction and lot count, all logged. Identical copies are sent once and same-document passages merged. Answers are plain text, answer first.
- **Demo (PRs 225, 226):** the visitor is president on SL012; a fictional council takes part at once (votes on Discussions, joins meetings, arrives at launch) without waiting on background jobs; sample video tiles.
- **Two-step sign-in (PR 223):** anyone who has set up an authenticator app is asked for its code at sign-in. Setting one up is still optional.
- **Training (PR 224):** the Council page shows "complete" for training, not a certification inside Stratasphere.
- **Security (PR 222):** Zod pinned to 4.6.7 for a high-severity advisory.
- Recall check: document and decision names show beside their checkboxes (PR 227).

## 2026-11-12 — Free and paid; price; navigation; one Stratasphere

The plan in `docs/learn-decide-remember.md`, built in a day:

- **Free and paid (PR 209, migration 0090):** the one-free-meeting trial ends. Council business is free for good: council and committee meetings, Meeting Mode, live voting, minutes, Discussions, storing and downloading documents, the Library, and templates and forms. Stratasphere is the paid tier: the assistant, document reading and search, the decision ledger, built-in video, and AI drafting. It is for council, the strata's managers and its admins, never owners. A free strata can add its own video link to a meeting (PR 215, migration 0092).
- **Price (PRs 210, 211, 213, migration 0091):** Monthly is $30 a strata plus $3 a lot; Yearly is $25 plus $2.50 a lot, a 12-month commitment billed monthly. GST on top. No lot limit; only a monthly charge over Stripe's $3,000 a payment goes to Enterprise ("Talk to us"), as do management companies. The Super Admin sets an Enterprise price or marks a strata complimentary.
- **Navigation (PRs 214, 220, 221):** three sections: Resources (Council Training, the Library, Forms & Templates), Your Strata (Overview, Meetings, Discussions, Documents, Council, Owners, Management, Billing), and Stratasphere (Ask). Documents moved to Your Strata.
- **Access (PR 216, migration 0093):** removal from a strata checked table by table; Discussions are started and run by people who can run meetings.
- **One Stratasphere assistant (PRs 217, 218, migration 0094):** a floating panel on every Your Strata and Stratasphere page that knows what the person is looking at (a meeting, an item, a document, a discussion), and the same assistant inside Meeting Mode.
- **Finding records and cost (PR 219, migration 0095):** keyword search beside meaning search (exact strings such as "SL12" or "bylaw 7.3" first), the whole decision ledger, disclosures of what couldn't be read, and a one-hour cache.
- Super Admins can't delete a strata from the Stratas tab (PR 212).

## 2026-11-11 — Socials editor; bot protection; recall check

- **Socials editor (PRs 199 to 204, migrations 0087, 0088):** layers, a brand kit, saved layouts and post templates, six layouts, animation with entrances and exits, Pixabay video clips, and MP4 export. Newsletter designed and on hold (PR 205).
- **Bot protection (PR 206):** Turnstile, a mail-domain check, and a hidden field on every form that sends email, in the app and on the marketing site.
- **Recall check (PR 208, migration 0089):** Super Admin test cases for "does Stratasphere see the records that answer this?", required before changing how it searches. The Learn, Decide, Remember design written.
- Super Admins delete an account from the person's own page (PR 207).

## 2026-11-10 — Lifecycle emails; Marketing tab

- **Lifecycle emails (PR 196, migration 0086):** setup tips for new sign-ups, built in-house, with unsubscribe links (CASL on top of PIPA). Emails get a centred footer with the company name and mailing address (PR 197).
- **Console (PRs 195, 198):** a Marketing tab holding Socials and Emails; social slide numbers on or off (migration 0085); the automated browser test design written.

## 2026-11-09 — Copy sweep (PR 194)

Oxford commas and Canadian spelling across the app.

## 2026-11-07 — Conflicts follow the person (PR 193, migration 0084)

A conflict declared on a Discussion carries into the meeting that ratifies it. The person running a meeting who declares a conflict hands it to someone else who can run meetings, and gets it back afterwards; the chair steps aside for an elected chair for that item. A Discussion can be closed by its starter or an Admin. The old Zoom Meeting SDK embed was removed (PR 192, migration 0083).

## 2026-11-06 — Meeting Mode polish; video and conflicts

- Stratasphere's start screen is clean, with no suggested questions, and you can read while it writes (PR 185).
- Meeting Mode: roles and plain times in the attendance list; electing a chair is its own procedure and is done by live vote; no decisions while a vote is open; Meeting Runner Notes (PRs 186 to 188).
- Conflicts: an acknowledged conflict steps the member out of the video; the Runner acknowledges declarations (migration 0082); a Test video and audio page (PR 189). Camera and microphone are allowed site-wide (PR 190).
- Fonts served from the site rather than fetched at build time (PR 191).

## 2026-11-05 — Meeting video; Discussions v2

- **Video (PRs 175, 179 to 184):** first on Zoom's Meeting SDK, then moved to Zoom's Video SDK with our own panel and no Zoom interface: sound on a click, choose camera and microphone, clear messages when a device is busy elsewhere. Laptops and desktops.
- **Discussions (PR 176, migration 0081):** vote from the email, comment emails, discussions without a vote, and a table view.
- BC time fix, Hand over instead of Exit, and a clearer activity log (PR 177). OCR runs only where scans are read, for smaller deployments (PR 178).

## 2026-11-04 — Meeting Mode rebuilt around the Runner

- Steps for the Runner with buttons in order, All in favour, Show to everyone and Share on screen (migration 0076), a Procedure box, the vote card at the bottom, and the result recorded as the vote closes (PRs 168 to 170).
- Edit agenda and Launch meeting from the Meetings tab, agenda takeover (migration 0077), clearer item buttons, times in PT (PR 171).
- Discussions for whoever runs meetings (migration 0078), AI motion drafting, your vote on the list (PR 172).
- AGMs and SGMs marked coming soon (PR 173).
- A launched meeting always has someone running it: hand over, take over after 2 minutes without a check-in, pause (PR 174, migration 0079).

## 2026-11-03 — Live voting; sandboxes; meetings

- **Live voting (PR 162, migration 0073):** council members vote from their own screens while the meeting runs; the Runner sees each vote and can enter one for someone on the phone or in the room.
- **Sandboxes (PR 163):** Super Admin test stratas on the demo site with real video.
- **Meetings (PRs 164 to 166, migrations 0074, 0075):** join and leave once launched, a launch email, one agenda editor at a time, the Runner marks people present with the time, and votes follow who is there. Ask before closing the window during a meeting.
- Workflows use a read-only GitHub token (PR 161). Learners can move on before a slide finishes (PR 167).

## 2026-11-02 — Council Discussions; OCR; security review

- **Discussions (PR 157, migration 0070):** votes between meetings, ratified at the next council meeting.
- **OCR (PR 158, migration 0071):** scanned PDFs read on our own servers.
- **Security review (PR 160, migration 0072):** draft minutes for council only, backup codes server-only, column-level reads on meetings. Dependency alerts patched (PR 159).

## 2026-10-26 to 2026-10-28 — Vote math, marketing plumbing, Users tab

- **Vote and quorum math follows the Act and the Standard Bylaws (PR 153).**
- Investor sign-up endpoint and disclaimer page (PR 150); campaign tags saved at sign-up (PR 151, migration 0066); demo requests in the console (PR 152, migration 0067); a social carousel builder (PRs 154, 155, migration 0068); a Users tab with people's activity (PR 156, migration 0069).

## 2026-10-23 to 2026-10-25 — Demo and Library fixes

- The demo offers Strata Basics only in training (PR 145) and a "Setting up your demo" page (PR 146).
- Draft with AI makes every slide with an interactive element text only (PR 147).
- Agenda attachments are filed in the strata's own folders (PR 148, migration 0065).
- The Library's privacy entry covers BC's PIPA, not PIPEDA (PR 149).

---

## 2026-10-23 — Council Ready rebuilt; Stratasphere search fix; Choose photos; owners table fits the page

**Council Ready (PR #142, migration 0063):** the six empty outlines replaced by eight tighter modules, 107 minutes, in teaching order: 1 Your role on council (13); 2 Making valid decisions: meetings and votes (14); 3 Money (14); 4 The building: repairs, insurance and emergencies (14); 5 Working with your strata manager and contractors (13); 6 Owners, bylaws and disputes (14); 7 Special situations (12); 8 Leading well and your first 90 days (13).
- Source: the user's "Council Ready" training blueprint (UBC Sauder licensing course breadth plus CAO director-training methods, rewritten for BC), trimmed to three lessons per module. Depth the role tracks teach stays there: what a strata is (Strata Basics), detailed finances (Treasurer), privacy (Privacy Officer), minutes and records (Secretary).
- Order reasoning: who you are, how you decide, what you decide about (money, building), how it gets done (managers, contractors), people (owners, disputes), exceptions, then practice and the first 90 days.
- Knowledge checks stay inside the presentation: one after each lesson, and a scenario check ending every module. No separate final exam.
- Corrections made from review: council-minutes timing and owners observing council meetings come from the Standard Bylaws, not the Act; disputes go to hearings then the CRT; the 2022 rental and 55+ age bylaw changes stated plainly; reserve fund and depreciation report rules taught from the Legislation Library, not fixed numbers.
- Module keys follow the old modules on the same topics (building cr5, managers cr6, owners and disputes cr4) so 0042's one-time reorder can't apply. 0063 runs only while the track is untouched (description as seeded, nothing built or published).
- Next: build each module's slides with Draft with AI; add BC's short-term rental law to the Legislation Library before Module 7.

**Stratasphere found nothing in the strata's own documents (PR #143, migration 0064):** an indexed document (the September 2026 financial statements) never came back from a search. One HNSW index search across all passages returned only the nearest few dozen, all legislation, before the strata filter. Now each scope is searched separately (strata documents and precedent exactly, legislation through the index). Confirmed fixed by the user. Covers Meeting Mode too; the demo database got it automatically. Also noted: the database test helper `pg_temp.expect` passes on NULL, so checks over zero rows need `coalesce(..., false)` (helper itself not yet changed).

**Training builder: Choose photos (PR #144, no migration):** in Module settings, the AI suggests an Unsplash search for each slide that takes a picture (no interactive element, not text-only), and the author goes through them one at a time, choosing a photo or skipping. Unsplash's guidelines require a person to choose each photo, so nothing is picked automatically.

**Docs corrected: templates and forms are paid.** doc01 §3b, §4a and open question 17, and doc03's overview, said the template library was free. As built, policy templates and forms are visible to every member but download only with a StrataSphere subscription (`isTemplateLocked`, enforced on the download route too); everything else in the Library is free. The docs now say so.

**Owners page (PR #141):** the roster table fits the page (tighter cells, emails wrap); phones still scroll sideways.

**Also this period:** EPS9048 is the founder's own strata (dogfooding only); it won't be used as a public example or testimonial. Marketing spend is on hold until investment is raised.

## 2026-10-22 — Founding offer designed (not built); Google Drive import live

**Founding offer: designed and approved, development on hold.** A self-serve "first year free" on the annual plan for the first N stratas, which the Super Admin switches on and off; it switches itself off when the spots are gone. Full design in doc01 §4b (planned block) and doc03 Stage 6 (planned block). Decisions:
- Payment method (PAD or card) required up front; Stripe charges automatically after 12 months.
- Annual plan only; the 12-month commitment starts after the free year.
- Reminder emails 30 and 7 days before the first charge.
- Shown on the marketing site while on (spots left, from the app), plus an in-app/demo Announcement posted by the Super Admin.
- Built on a Stripe trial with an atomic spot claim in the database; Complimentary access stays the tool for hand-picked pilots.
- Why: drive adoption by council members (not managers, brokers or industry bodies) ahead of a marketing push, which is the next planning topic.

**Google Drive import (PRs #137–#140), live and verified:** one-time import with Google's picker (`drive.file` scope only; Docs as Word, Sheets and Slides as PDF), sign-in as a full-page visit to Google rather than a pop-up (pop-ups were closed silently in a Workspace-managed Chrome profile), and the Google settings trimmed after a pasted line break in the client ID caused "invalid_client". Google Cloud project "StrataCouncil" under trickfilm.com; brand verification approved 2026-10-22. "Download everything" (Admins, emailed one-time 24-hour link) shipped in #137.

## 2026-10-13 — Automatic checks on every pull request

- Order agreed: (1) automatic PR checks, (2) Council Training (first sales call will show training progress), (3) the demo including training, (4) a Playwright end-to-end suite built on the demo's seeding and reset.
- New `.github/workflows/checks.yml`: on every PR and on main, typecheck, unit tests and a production build (placeholder env, no secrets), plus the database tests on Postgres 16 + pgvector.
- The database tests moved into the repo (`supabase/tests/`; previously only in a temporary session folder): Supabase stand-ins, a seed with the core create/join/invite/roles checks, and 16 suites (announcements, conversations, council lots and roles, documents, join requests, knowledge base, legislation, management, meeting close, meetings, owner roster, permissions, Stripe sandbox, Super Admin, two admins). `npm run test:db` runs them locally.
- Migrations from 0016 on are applied twice to enforce the "safe to re-run" rule (0001–0015 predate it).
- Found while moving them: the old local seed granted every permission on every table, masking the real grants. Removed; all suites pass on the migrations' own permissions, including "a user can't make themselves a Super Admin". Production has the right grants (0016 is the only broad grant and it re-restricts profiles straight after).
- Reference: the previous project's Playwright specs were reviewed for ideas only (keep: shared sign-in helpers, no-errors-on-load checks, fixed fixtures, unique emails, cleanup, role and viewport tests, validation, stand-ins for outside services; leave: tests of internals, fixed sleeps, shared-environment state, Super Admin role switching, hard-coded credentials, heavily mocked billing).

## 2026-10-12 (night) — Docs sync; demo mode designed; EPS-9048 to live

**Docs updated (as-built blocks dated 2026-10-12, which supersede older text where they disagree):**
- doc01 §4b: the billing record and Stripe model as built (subscriptions columns through 0032, customer naming, sandbox per strata, Payment Element subscribe with a Business PAD agreement, embedded-Checkout payment-method updates, pending states, plan switches, webhook events).
- doc02 (top): the standalone assistant works on phones.
- doc03 Stage 5 (menu, Overview, phones), Stage 6 (the subscribe dialog and pending gates), Stage 9 (update payment method).
- doc04 §7: Stripe integration as built (libraries, env vars, code map, webhook events, Stripe settings).
- doc05 §5: message and outcome styling.
- "Project state at a glance" below: new 2026-10-12 update; the Checkout/Billing Portal wording in "Consistency status" is superseded.

**Demo mode: designed and approved, not built yet (next work).** For live sales calls with minimal attention:
- A dedicated demo login (not a Super Admin), a fictional strata with a fully authored document kit (Strata Plan PDF, roster CSV, about 10 governance documents pre-indexed, agenda attachments). No real people or data.
- One-click steps: upload the Strata Plan (approved instantly, repository fills), upload the roster (owners and the whole council set up), New meeting (date, time, location, agenda and attachments pre-filled), Launch (call to order, attendance, quorum and agenda approval already done, landing on one featured motion with attachment, rationale, financial implications and risks), Adjourn (every other item gets a realistic decision, so the draft minutes are complete), export minutes, **Subscribe (one-click simulated, demo only)**, ask Stratasphere (real answer from the demo documents), open a playbook.
- A "Reset demo" button returns everything to before the demo, plus a nightly auto-reset. Demo behaviour only for the demo account and demo strata.
- Planned as three PRs: (1) demo kit, flag (one migration) and reset; (2) the shortcuts; (3) simulated subscribe, nightly reset, a one-page script.

**EPS-9048 moving off Sandbox.** The switch refuses while a subscription is active: cancel the sandbox subscription in Stripe first (the webhook deactivates it), then switch. With #48 it starts as "Not subscribed" in live mode, keeping billing contacts and address; subscribing then charges for real.

**Then:** Council Training (training progress on real tables, Super Admin view of a user's training).

## 2026-10-12 (later) — Billing code sweep after three Stripe approaches

- Removed the webhook's handling of Checkout-created subscriptions (none are made that way now; subscriptions arrive as customer.subscription.* events).
- Renamed lib/stripe/checkout-results → payment-results and the subscribe return page /billing/checkout-complete → /billing/payment-complete, so names match what they do.
- Removed unused billing CSS (billing-interval-option(s), billing-pay, billing-step__actions) and stale comments.
- Every remaining billing function is in use. Kept on purpose: embedded Checkout in setup mode for Update payment method; first-payment states (processing / verify / failed); restartSubscription.
- Switching a strata between live and sandbox now also clears its Stripe status and activation date, so it starts as "Not subscribed" in the new mode.

## 2026-10-12 — Billing polish; Stratasphere assistant on phones

- Billing tests all passed (typed-in bank details with micro-deposits, bank sign-in, update to card); PAD agreements show Type: Business.
- "Update payment method" is back to its own width. Success and error messages everywhere (`.form-alert`) now use the Billing outcome style: white, with a coloured rule down the left, instead of a tinted background.
- The Stratasphere assistant works on phones: ScreenGate lets `/assistant` through, the tab shows in the phone nav, the chat fills the screen and the conversation list is a drawer (Conversations / New bar above the chat). The desktop-required notice offers "Ask Stratasphere" first. Meeting Mode and the rest stay desktop-only.

## 2026-10-11 (later) — Subscribe by paying in the dialog (Payment Element)

- Stripe's hosted checkout (embedded or not) doesn't accept Canadian pre-authorized debit in subscription mode ("acss_debit cannot be used in subscription mode"), so #43–#45's approach couldn't work.
- Now: the Payment step creates the subscription in Stripe first, unpaid (`payment_behavior: default_incomplete`), with its PAD agreement set to Business (`payment_settings…acss_debit.mandate_options.transaction_type`), and Stripe's Payment Element inside the dialog confirms its first payment by bank debit or card. `save_default_payment_method: on_subscription`, so that method pays every renewal.
- Unpaid ones are marked `awaiting_payment` and never recorded as pending (lib/stripe/sync); reopening the step reuses one for the same plan, replaces it for a different plan, and one abandoned lapses after a day without touching the strata. The webhook's deactivate now only acts on the subscription on record.
- Results recorded by the form, the return page (`/billing/checkout-complete?subscription_id=…`) and the webhook.
- Admin Stratas: the strata you're on is plain text (its billing is the page you're on).
- Update payment method still uses Stripe's embedded checkout in setup mode (that mode does take bank debits).

## 2026-10-11 — Payment inside the app, PAD as Business; in-app payment method updates

- Why: Stripe locks a saved debit agreement's Type of Service to Personal when it's saved for subscriptions (setup mode with `default_for`), and business PADs have a 10-business-day dispute window against 90 days for personal (Payments Canada Rule H1). Stripe's subscription checkout lets us set Business.
- New subscribe dialog: Plan → Billing details → Review → Payment. The Payment step shows Stripe's own form inside the dialog (embedded Checkout, subscription mode, `transaction_type: business`); confirming there creates the subscription, with no trip out to Stripe and back. Cards work there too. The old separate payment-method step, its return page and the verify-before-subscribing card are gone; a typed-in bank account waiting on micro-deposits now shows as the existing "verify" state on Billing.
- Never a second subscription: opening the Payment step checks Stripe for one first.
- Results are recorded three ways: the form's completion callback, a return page for banks that need a redirect, and the `checkout.session.completed` webhook.
- Update payment method now happens inside the app too (Stripe's form in setup mode in a dialog). A typed-in bank account is used once verified (Billing shows "Verify the new bank account"); the current method keeps paying until then. Stripe still sets the Type of Service itself on updates (its rule for saved agreements), so an updated bank account may show Personal.
- New settings: STRIPE_PUBLISHABLE_KEY (pk_live_…) and STRIPE_TEST_PUBLISHABLE_KEY (pk_test_…). Added @stripe/stripe-js 5 and @stripe/react-stripe-js 3 (matching the server library's API version).

## 2026-10-10 (later) — PAD verification moves on by itself

- From test 1 (typed-in bank details): after entering the micro-deposit amounts on Stripe's page, the app stayed on "Verify the bank account" until clicked away. Billing now re-checks every 5 seconds while a verification is waiting (and when the tab comes back into view); once verified, the dialog moves on to Billing details by itself.
- An admin who leaves before the deposits arrive finds a "Verify the bank account to finish subscribing" card on Billing, with the link to Stripe's page and "Use a different payment method".
- Type of Service can't be set to Business with the current setup (Stripe locks it to Personal when the agreement is saved for subscriptions). The Business tip is removed pending a decision.

## 2026-10-10 — Billing checks Stripe while pending

- Safety net for a missed webhook: while Billing would show Pending, it asks Stripe for the subscription's real status; if Stripe has moved on (active, expired), it records that and shows the real state. `syncSubscription` now reports whether it wrote, so this can't loop.

## 2026-10-09 (later) — Announcements made reliable; Edit added

- Why posts seemed to vanish: React clears a form after its action runs, even when the action fails, and the error text was nearly invisible (a card text style overrode the red error colour, everywhere in the app). A refused post looked like a successful one.
- The form is now submitted by hand: fields stay until it's actually posted, failures show in a red box with the reason (including the database's own message), success shows in a green box, and the list refreshes. A stale page (opened before a site update) says to refresh rather than doing nothing.
- Each posted announcement has Edit (same form, prefilled), Take down or Show again, and Delete (with a confirmation that points to Take down as the keep-it option).
- A failed load of the list says so instead of showing "Nothing posted yet".
- `.form-error` inside cards is red again everywhere (the Stripe error on the payment step was grey for the same reason).

## 2026-10-09 — PAD works end to end; typed-in bank details, Business tip, tighter review

- Sandbox PAD subscription went Active (Simulate bank sign in) after #38.
- Bank details typed in by hand: Stripe confirms them with two micro-deposits, so the setup page came back with nothing usable and the app returned to "Add payment method". Now the payment step shows "Verify the bank account" with a link to Stripe's page for entering the deposit amounts (or use a different payment method). Once verified, subscribing makes it the default.
- Type of Service on Stripe's page defaults to Personal and can't be preset alongside `default_for` (Stripe refuses the combination). The payment step now tells admins to choose Business for a strata corporation's account.
- Review step rows tightened.

## 2026-10-08 (night) — PAD setup: default_for on its own

- #36's setup page failed: Stripe doesn't allow `default_for` together with `payment_schedule`, `interval_description` or `transaction_type` in the ACSS mandate options. The setup page now sends `default_for: invoice, subscription` alone; Stripe words the agreement itself.
- Sandbox error details on the payment step now show up to 800 characters (Stripe's message was cut off at 300).

## 2026-10-08 (evening) — Announcements: choose Home, Overview, or both (migration 0032)

- Posting an announcement now asks where it shows: the Home page, every strata's Stratasphere Overview, or both (both ticked by default; at least one required). Existing announcements keep showing in both.
- The Super Admin list shows each post's placement.

## 2026-10-08 (later) — Pre-authorized debit first payment stuck as pending

- The first PAD payment was created waiting for action (Stripe "Incomplete", `invoice.payment_failed` at creation), so the subscription stayed incomplete. Likely cause: the debit agreement saved through Checkout wasn't marked for invoices and subscriptions, so Stripe wanted it accepted again for each payment.
- Fix: the setup page now saves the agreement with `default_for: invoice, subscription`. If a first payment still comes back waiting on anything other than micro-deposits, the subscription is cancelled at once with a clear message; one already stuck shows "The payment didn't go through" on Billing with "Use a different payment method".

## 2026-10-08 — Subscription pending at every gate

- While a subscription is pending (Stripe confirming the first payment), every Subscribe or Request button is replaced by a "Subscription pending" note: the locked Stratasphere tab dialog, the assistant, decisions and policy-template lock panels, the Meetings lock panel, the launch dialog once the free meeting is used, historic minutes upload, and the home page Stratasphere card. Admins see that a pre-authorized debit can take a few business days, with a link to Billing; members see that their admin has subscribed. Overview's Strata details shows "Subscription pending".
- `getStrataAccess` and the strata context now carry `pending`; connected corporations carry it for the home page.

## 2026-10-07 (evening) — First-meeting checklist: council roles step, hides when done

- "Assign council roles" is now the second step of the "Your first meeting" checklist on Meetings (links to Council). Done once anyone holds a council role.
- The checklist disappears once every step is done.

## 2026-10-07 (later) — News from StrataCouncil.ca on every Overview (migration 0031)

- Super Admin announcements (console, Announcements) now also show on every strata's Overview, under "From StrataCouncil.ca", for every customer, subscribed or not. Newest five there, newest three on the home page. Admin-only posts show on a strata's Overview only to that strata's admins. Hiding one on a device hides it in both places.
- Each post has a category: News, New feature, Change, Training, Library, Legislation. It's the label above the title.
- Links can point to a page in the app (starts with /, like /training), opening in the same tab, as well as an https:// address.

## 2026-10-07 — Strata menu reorder and Overview dashboard

- Billing fix first (PR #30): adding a payment method crashed when the stored Stripe customer had been deleted. The customer is now checked and recreated if gone, and Stripe failures return to the payment step with a message.
- Menu order: Overview, Stratasphere, Library, Council, Owners, Meetings, Minutes, Documents, Billing (admins), Management (admins and managers). Renamed Knowledge Library to Library, Council & Roles to Council, Strata Lots to Owners.
- Overview is the new landing page (`/strata/[corpId]`): admin to-dos (join requests, unaccepted invitations, unfilled President/Secretary/Treasurer), counts (lots and owners recorded, council members, upcoming meetings, documents), the next meeting, the latest minutes, the council's offices, and the strata's details. Getting started moved here from Council.
- Council moved to `/strata/[corpId]/council`; links and the invite-accepted email point there. Owners keeps its `/lots` URL.

## 2026-10-06 — Billing flow, round 2 (migration 0030)

Jeremy's 11 notes from a sandbox run-through, plus the GST gap it found.

- **Subscribing happens in one focused dialog:** Plan → Payment method → Billing details → Review, with Cancel, and Back and Next where they apply.
  - Escape or Cancel closes it; a click outside doesn't.
  - Every "Subscribe" link in the app opens it (`billing?step=plan`).
- **Plans:** Monthly on the left, Annual (recommended) on the right, with "Monthly plan" and "Annual plan" buttons at the bottom right.
- **Billing address (new):** "Same as the building's civic address" by default, or a typed address (for example a management company's office).
  - Saved in `subscriptions.billing_address` and sent to Stripe as the customer's address, which Stripe calculates GST from.
  - The first sandbox subscription was charged $294.66 with no GST because the customer had no address.
- **Review step:**
  - Jeremy's wording for the annual commitment ("You are subscribing to a full year of Stratasphere, billed monthly. …").
  - The statement line ("Appears on your statement as TRICKFILM.") on one line.
  - A plain "Subscribe" button.
- **After Subscribe:**
  - The pay step records the subscription at once (shared `lib/stripe/sync.ts`).
  - A card shows "You're subscribed." immediately.
  - A pre-authorized debit shows "Payment processing" and a Pending pill until it clears, and the page checks every 5 seconds. No subscribe prompt shows meanwhile.
  - A declined first payment is cancelled and reported on the form.
- **Pending (0030):** `subscriptions.stripe_status` keeps Stripe's own status; "incomplete" reads as Pending. The billing page's card is now "Admin Stratas", with a Pending status.
- **Subscribe copy:** sells the benefits (meetings run by the book, minutes the moment you adjourn, a council that never forgets) rather than listing what's free.
- **Sandbox:** the red banner is gone. A sandbox strata shows the same red "Sandbox" pill the Super Admin console uses.
- **Stripe sandbox:** test subscriptions auto-cancel after 90 days (Stripe's own rule). PAD test details: institution 000, transit 11000, account 000123456789, or Stripe's test bank.

## 2026-10-05 (evening) — Stripe sandbox per strata (migration 0029)

- **Why (Jeremy):** switching Stripe live/sandbox meant changing keys and price IDs in Vercel and changing them back. "Once we've got paying customers, I'd only ever turn this on for a Dummy/Test SC."
- **How:** `strata_corporations.stripe_sandbox`, set by a Super Admin from the strata's console page (Stripe billing card, with a confirmation). Every page of a sandbox strata shows a big red banner. Sandbox stratas carry a red "Sandbox" pill in the console list and on their console page.
- **Keys:** the live ones are unchanged. New `STRIPE_TEST_SECRET_KEY` (must be a test key), `STRIPE_TEST_WEBHOOK_SECRET` and `STRIPE_TEST_PRICE_*`. Every billing call uses the strata's mode (`stripeFor(corpId)`).
- **Webhook:** one URL for both. Each event is verified against the live secret, then the sandbox one. An event whose strata bills through the other mode is ignored.
- **Safety:**
  - Switching clears the strata's Stripe IDs, since they belong to one mode.
  - Switching is refused while a Stripe subscription is running.
  - Nobody can change the flag from the browser (no update policy on `strata_corporations`).

## 2026-10-05 (later) — End-to-end round 2: features batch (migration 0028)

- **Auto-refresh (note 4):** the Super Admin console, the Connect page, Council & Roles and Home re-fetch every 20 seconds while the tab is visible, and as soon as you return to the tab (`components/AutoRefresh.tsx`). Typing and open dialogs are kept.
- **Several historic minutes at once (note 7):** up to 10 files. They upload and are read one after another, then are reviewed one at a time ("File 2 of 5"), each saved or skipped. Each is indexed on its own. Documents already took up to 20 files at once.
- **One export file name (note 8):** `PLAN_YYYY-MM-DD_Document-Name.ext`, for example `EPS-9048_2026-10-05_Council-Meeting-Agenda.docx`, `EPS-9048_2026-10-04_Owner-Roster.csv` and `StrataCouncil_2026-10-05_Backup-Codes.txt`.
  - The date is the meeting's date, otherwise the export date in Pacific time.
  - Every export uses `lib/exports/filename.ts`. Uploaded documents keep the names they were uploaded with.
- **Home page (note 3):**
  - **Announcements:** posted from Super Admin console → Announcements (`announcements`, 0028). Each has a title, short text, an optional link (https), an audience (everyone, or strata admins) and an optional end date. They can be taken down or deleted. Home shows the newest three current ones, each hideable per device.
  - **"How Council Training works":** a card until dismissed, or until someone has training progress.
  - **Stratasphere card:** for people whose strata isn't subscribed. The button fits who's looking: Connect to a strata, See plans (admins), or Request (others).
  - **Honest training figures:** every track reads "not started" (Home, Council Training, roster credentials) until training progress is on real tables.

## 2026-10-05 — End-to-end notes, round 2: polish batch (migration 0027)

Jeremy's 12 notes, fixed in three batches: polish, then features (auto-refresh, multiple uploads, export names, home page), then the Stripe sandbox switch.

- **Wordmark (note 1):** sign-in, sign-up, check-your-email, two-factor and welcome screens show the logo with "StrataCouncil.ca", at the header's proportions.
- **Emails (notes 2, 5):**
  - Every email has the logo and wordmark at the top, and "A product of" with the Trickfilm logo at the bottom. The images are PNGs in `public/email/`, rendered from the app's own artwork.
  - Invites now say briefly what StrataCouncil.ca and Stratasphere are.
- **Two admins (notes 6, 11).** Jeremy: "There can be only one of each Council role (except M@L) ... We just need to allow for two admins."
  - Assigning Admin adds a second admin instead of moving it. At most two (database trigger).
  - An admin can step down while another remains.
  - Offices are unchanged: one holder each, one person may hold several, and an office ends Member at Large.
- **Council & Roles layout (note 10):** separate sections for Requests to join and Invitations, each shown only when there are any, then Council & roles, always shown. "Invite a member" is a button beside the Council & roles heading.
- **"Connect to a strata" (note 9)** replaces "Set up your strata".
- **Confirm decision (note 12):** the reason (mover and seconder missing, votes not recorded, and so on) now shows beside the buttons. It used to appear only in a banner at the top of the page.

## 2026-10-04 (late) — Parked: Form B generator for realtors

- **Idea:** realtors pay on the site for a strata's documents for a sale.
- **Status:** parked by Jeremy. A strata corporation earning outside revenue raises its own problems, so this may not be a good fit.
- **Findings, for if it comes back:**
  - A document package (bylaws, rules, minutes, financials, depreciation report) is easy with the existing repository.
  - A real Form B is harder. It needs per-lot money data (fees, arrears, levies, fines) we don't hold, and the strata must sign it and is bound by it, so council sign-off is required.
  - The fee is capped at $35 plus 25 cents a page and belongs to the strata. Rush fees aren't capped.
  - Minutes need a privacy redaction step before release, and realtors need the selling owner's authorization.
  - StrataPress and eStrataHub already serve managed stratas. Self-managed stratas are the gap.

## 2026-10-04 (night) — Sign in no longer creates accounts

- **Bug (Jeremy):** "Sign in" with a new email created an account. That account skipped sign-up's name, Terms and Privacy acceptance, and CASL marketing choice. Both pages sent the same `signInWithOtp` call with `shouldCreateUser: true`.
- **Now:** sign-in uses `shouldCreateUser: false`. An email with no account gets "There's no account for <email>" and **Create an account**, which opens sign-up with the email filled in. Sign-up requires name and Terms on the server as well as in the form.
- **Trade-off (accepted):** the message confirms whether an email has an account.
- **Unaffected:** invites, which create the account when sent (`generateLink`).

## 2026-10-04 (evening) — Plan switches wait for the anniversary (migration 0026)

- **Rule (Jeremy):** "There should be no cancelling or moving off of the annual rate until the end of the commitment term. If a user does switch billing intervals, it should take effect on the next anniversary date."
  - Annual to monthly takes effect at the end of the running 12-month term.
  - Monthly to annual takes effect at the next monthly billing date, which starts a 12-month term.
  - Cancelling annual ends at the term's end, as before. Cancelling monthly ends at the period end.
- **Annual renews into a new 12-month term each anniversary** (doc01 §4b, "ordinary auto-renewing plan").
  - `currentTermEnd()` rolls the stored first-term end forward.
  - This fixes cancelling in year 2 or later, which used to send Stripe a past date.
- **How it works.** Stripe subscription schedule: the current plan runs to the switch date, then the new Prices and `billing_interval` metadata apply.
  - `subscriptions.pending_interval`, `pending_interval_at` and `stripe_schedule_id` (0026) let the billing page show "Switching to monthly on <date>", with "Keep annual" to undo (releases the schedule). Cancelling drops a scheduled switch.
  - The webhook starts the new annual term when the switch lands. The app no longer writes the interval itself, which removes a race that could leave annual with no commitment date.
- **Previously,** an admin could switch annual to monthly immediately and then cancel, escaping the commitment.
- **Stripe customer portal:** turn off "Cancel subscriptions" and "Switch plans" in its settings, so these rules can't be bypassed there.

## 2026-10-04 (later) — Turned-down requests; request-list fix (migration 0025)

- **Turned-down requests** on "Connect a strata" show for 7 days after the decision, with an X to dismiss sooner. The rows stay as the record (`dismissed_at` on both request tables; `dismiss_my_request()` lets only the requester dismiss, and only once turned down).
- **Fix: "Your requests" showed requests that weren't the user's.** The page relied on RLS, which also lets a strata's admin read join requests to their strata and a Super Admin read every request. It now filters to the signed-in user's own.
- **Audit after the fix.**
  - Every public table has RLS. Every app query that means "mine" filters by the user, or is scoped to a strata the reader may see.
  - The data-returning definer functions check the caller.
  - No other case of one user's records showing as another's.
- **Super Admin view of a user's training (Jeremy, requested).** Training progress isn't stored yet (the pages use placeholder data). Build it in when training progress is built.

## 2026-10-04 — End-to-end test notes, batches 1 to 3 (migrations 0023, 0024)

Jeremy's 18 notes from the first full end-to-end run, taken without comment until "NO MORE NOTES", then fixed in three batches.

- **Batches 1 and 2 (merged; 0023 applied).**
  - Postal code box and address lookup on the attestation and approval forms. BC Geocoder never returns postal codes, so the box is filled in by hand.
  - Onboarding: a simple "Getting started" nudge for the strata's own admin.
  - Chair defaults to President, with Vice President, Strata Manager and Elected.
  - Clearer "Delete draft". Popups close on an outside click; agenda editing warns before losing changes.
  - Council members can open agenda items to see details and attachments; attachments open in a new tab.
  - Subscription modal: a clay Request button for non-admins.
  - Stratasphere thinking animation. Remove-member modal no longer steals the cursor.
  - Votes can't exceed the members present.
  - Meeting status pills, including "Adjourned" (no quorum). Jeremy: "an 'Adjourned' pill will suffice for now". Rescheduling rules come later.
  - Billing contacts save with confirmation and are per strata. Billing interval has three states (none, monthly, annual).
- **Batch 3 (0024).**
  - **Super Admin strata page** has tabs: Dashboard | Decision ledger.
    - The dashboard shows people, invites and join requests, the owner roster, documents (indexed, in progress, problems, by folder), meetings (draft, live, held, no quorum, next), the decision ledger, subscription, members and roles, and Stratasphere usage.
  - **Stratasphere usage.** Each answer logs its tokens and an estimated cost at list price (`stratasphere_usage`, Super Admins only; written by the server). Counts start from zero when 0024 is applied.
  - **Management tab** (Jeremy: "Admin, or Manager role. No other roles will even see the Management Tab"; "Per SC for now").
    - Holds the management company's name, address, phone, email, website and logo (PNG or JPEG, 2 MB), plus up to six managers.
    - Stored in `strata_management` (members read it, Admin or Manager edits it) and the private `management-logos` bucket.
  - **Letterhead.** When management details exist, they print at the top of the agenda (Word) and the minutes (Word and PDF). The stored final minutes PDF keeps the letterhead as it was at finalize.
  - The data sweep script clears both new tables; empty `management-logos` in the dashboard afterwards.

## 2026-10-03 — Stratasphere memory and caching; ledger search; executive roles (migration 0022, PR #13); PRs #11, #12 merged

- **Why memory was needed.** Stratasphere "forgot" the sources of a correct insurance answer when asked a follow-up, then retracted it. Jeremy: "not acceptable at all".
  - PR #12: full current bylaws on every question, an Earlier Answers rule, looser search.
  - PR #13: memory.
- **Memory.** Each question is stored with the records it was answered from (`conversation_messages.context`, stripped) and replayed with it on later questions.
- **Prompt caching.** Request layout: system = rules (block 1) + bylaws and ledger (block 2, cache breakpoint); then the conversation with each question's records; plus top-level automatic caching for the growing tail.
- **Estimated cost (Opus 5.5).** About $0.15 per question before; with caching, follow-ups within 5 minutes cost about $0.08 to $0.12. A follow-up after the cache expires costs up to about $0.40 for that one question.
- **Long conversations.** Past about 120k tokens (480k characters), the oldest turns drop in one step to half (`conversations.context_start_at`). Each call logs `[claude cache] read/written/uncached/output`.
- **Meeting Mode.** History from the browser is text only, never records. Stored records aren't sent to the browser.
- **Super Admin ledger.** Searchable (all words must match), and loads up to 5,000 decisions.
- **Roles.** An executive office (President, VP, Treasurer, Secretary) ends Member at Large. This is enforced in the editor and in `set_corporation_member_roles`; Admin is unaffected, and existing overlaps are cleaned up.
- **Open question: BC Government update subscriptions** (gov.bc.ca strata updates, BC Laws). How to subscribe and monitor is not yet decided.

## 2026-10-02 (night) — Super Admins manage every strata; roster pictures (migration 0021, PR #11); PR #10 merged

- **Super Admin = admin of every strata (Jeremy: "Complete control of every SC on the platform").**
  - `is_corporation_member` and `has_corporation_role` now also answer yes for `is_super_admin()`, so every RLS policy and definer function follows.
  - Super Admins don't become members: they never appear in a strata's roster or member directory.
  - Stratasphere conversations stay owner-only.
  - App code checks admin through `isStrataAdmin()` (the database's role check), not by reading role rows.
  - The console search has "Open strata" on every row; each strata's console page has "Open this strata as its admin". Inside, a banner says the Super Admin isn't a member and that changes are real.
- **Complimentary Stratasphere: decided against as a feature.** To give a test strata Stratasphere, set its subscription row to `active` in SQL. With no Stripe subscription attached, the webhook never touches it.
- **Roster pictures.** Council & Roles and the console roster show each member's profile picture (initials if none). `corporation_member_directory` returns `avatar_path`, and the links are signed on the server.

## 2026-10-02 (evening) — Legislation library (migration 0020, PR #10); PR #9 merged, 0019 applied

- **Super Admin console → Legislation library.**
  - Upload Acts, regulations and guidance as PDF, Word, HTML or text.
  - Set the name, short name, type and "current to" date before uploading. The date is read from the BC Laws text when left blank.
  - Each entry shows its indexing status and section count, and can be edited (which re-indexes it), re-indexed, downloaded or deleted.
- **Schema.** Table `legislation_documents`, Super Admins only through RLS. Private `legislation` bucket. `knowledge_chunks.legislation_document_id` cascades on delete.
- **Search.** `match_knowledge_chunks` gained `p_scopes`, so legislation has its own search slots (8) alongside the strata's records and precedent (12).
- **Section-level indexing.** One chunk per section, split further only when long. Each chunk starts with a citation line, e.g. "Strata Property Act (SPA), current to 2026-07-14, section 45: … [Part 4 …; Division 4 …]".
  - The splitter handles the contents page, boilerplate, Parts and Divisions, inserted sections (6.2/6.21/6.3), repealed and spent entries, (0.1) subsections and the Schedule of Standard Bylaws ("Standard Bylaw 3").
  - Each regulation form is indexed as its own chunk.
  - Checked against Jeremy's files for the SPA, the Strata Property Regulation, RESA and REDMA: every live section in each contents page is found.
- **PII.** Guidance is put through the strict stripper (`stripForLibrary`). Acts and regulations are public law and are indexed as written.
- **Sources** name the Act and sections, e.g. "Strata Property Act, s. 45, 48".
- **New cardinal rule.** Standard Bylaws are never presented as a corporation's own bylaws.

## 2026-10-02 (later) — Standalone Stratasphere assistant built (migration 0019, PR #9)

- **Training curriculum on hold.** The training builder (PR #8) was closed unmerged so the curriculum can be designed first. Its code remains on GitHub (commit 0c45d5e). Migration number 0019 went to the assistant instead.
- **Conversations are private (doc02 §4b, as specified).** Tables `conversation_projects`, `conversations` and `conversation_messages` are readable only by their owner: not council, not the strata admin, not Super Admins. Removing a member deletes their history for that strata; `remove_corporation_member` was redefined to do this.
- **Streaming.** `POST /api/stratasphere/chat` streams NDJSON (start, delta, done or error). It checks the subscription before the per-call allowance, so the standalone assistant is never free. It saves the question, then the answer with its sources (`citations` jsonb).
- **Sources under every answer.** Shown as chips: this strata's documents (they open the file), the decision ledger, cross-platform precedent, and legislation by Act.
- **Chat UI.**
  - Sidebar: Pinned, Projects, and Recents (Today, Yesterday, Previous 7 days, Previous 30 days, then by month).
  - Each conversation has an Options menu: pin, rename, move to project, delete. Projects can be created, renamed and deleted; deleting a project moves its conversations back to Recents.
  - Suggested questions when the chat is empty. Enter sends, Shift+Enter adds a new line. A not-legal-advice note sits under the composer.
- **Cardinal rules tightened (Jeremy: "no fluff, no bs, no guesses, no hallucinations, no opinions, no PII, no made-up stuff").**
  - Every fact, including what legislation says, must come from the knowledge base. Nothing comes from the model's own memory.
  - Explicit no-opinions rule.
  - When something isn't in the knowledge base, it says so in one sentence and points to where to look: the specific document type, the strata manager or council officer, or, for law, the Act and section, a lawyer, the CRT, or CHOA.
  - These rules apply to both the standalone and Meeting Mode assistants.
- **What Stratasphere draws on.**
  - The document repository, including finalized meeting minutes and uploaded past minutes, which are indexed as documents.
  - The decision ledger.
  - Cross-platform precedent.
  - Legislation. Ingesting it is **next**: Super Admin uploads of RESA, REDMA, the SPA, PIPA and others into `knowledge_chunks` with `scope='legislation'`. Until then, it says the legislation library doesn't cover a question rather than answering from memory.

## 2026-10-02 — Stripe stays under Trickfilm for now; Trickfilm credited in the app; quieter row actions (PRs #5, #6 merged)

**Decision (user, 2026-10-02): StrataCouncil.ca bills through Trickfilm Entertainment Inc.'s existing Stripe account, in live mode.**
- Trickfilm is the registered corporation. StrataReady and StrataCouncil.ca are its products, and both run through the same Stripe account.
- So Stripe's payment page, receipts and statement descriptor say "Trickfilm". The descriptor is exactly `Trickfilm`.
- **Updated same day: the dedicated StrataCouncil.ca Stripe account will be created BEFORE launch, not after.** The user's call: do it while there are no paying customers, so no subscriptions ever need moving. It's a hard pre-launch item (see "Before going live" in Project state). Until then, testing runs on Trickfilm's account. The work:
  - Create the account under the Trickfilm business, then set its public name, branding, statement descriptor `STRATACOUNCIL.CA`, and card and PAD only (no Google Pay, Apple Pay or Link).
  - Recreate the two products and four prices.
  - Turn on Stripe Tax.
  - Add the webhook, including `invoice.paid`.
  - Swap the Vercel Stripe variables.
  - Clear test `stripe_customer_id`s.
  - Update `lib/company.ts` and the Trickfilm billing notes to match (the footer credit can stay).
  - The switch is configuration only, with no code: new keys, the four price IDs, and the webhook secret in Vercel.
  - Existing subscriptions would have to be moved or re-created at that point. The earlier it happens, the cheaper.
- Meanwhile the app says who's behind it:
  - a footer on every signed-in page ("© Trickfilm Entertainment Inc. StrataCouncil.ca is a product of Trickfilm", plus "Powered by" with the Trickfilm logo)
  - billing step 2 explains Trickfilm appears on Stripe's page
  - the review step and payment method card say charges appear as TRICKFILM
  - emails say "A product of Trickfilm Entertainment Inc."
- Names live in `lib/company.ts`.
- Google Pay, Apple Pay and Link are turned off in the Stripe dashboard. The payment page offers card and Pre-Authorized Debit only.

**Also:**
- Roster upload errors now say why a file has nothing to apply: every row is blank, or columns weren't recognized (named).
- Document rows use text links (Re-index, Download, Move) instead of buttons.
- Council & Roles uses an "Edit roles" text link.
- The Strata Lots council column uses short labels (P, VP, T, S, M@L) with a key. It shows the council member's name without the misleading "Delegate:" prefix; the member is tied to the lot on Council & Roles.

---

## 2026-10-01 (night) — Second end-to-end test: plan parsing, roster cleanup, billing steps, Knowledge Library on phones (migration 0018, PR #5)

**Context:** the user's second clean run went smoothly through account creation and the creation request. Their feedback:
- Strata Plan parsing wasn't built. Typing the lot count invites abuse.
- There was no building name field.
- The civic address should come from a lookup.
- The roster's credential columns were messy: several dots per credential, overflowing the page, with the role editor hidden inside the table.
- Billing should be a sequence: plan, payment method, contacts (several), pay. It should push the annual plan.
- The Knowledge Library should work on phones.

**What was built:**
- **Strata Plan parsing.**
  - The plan is read on our servers and must be the plan that was looked up.
  - The lot count comes from the plan. Only PII-stripped text goes to the AI, cross-checked against the highest lot number in the text.
  - The result is stored server-side (`strata_plan_parses`), so the browser can't change it.
  - Scanned plans fall back to a typed count, flagged for the reviewer.
  - The reference app sent the whole PDF to the model. We don't, under the PII rule. Plans with a text layer (electronic EPS-series plans) parse fully.
- **Building name** and **address lookup.** The lookup uses the BC Address Geocoder (official, free, no key), with Photon for other provinces. Typed addresses are flagged. The Super Admin review shows all of this, and approval carries the building name.
- **Council & Roles:**
  - one circle per credential under GC/P/VP/T/S headers, with a key
  - no sideways scroll
  - role editing and removal in dialogs
- **Billing:** four steps.
  1. Plan. Annual is first, recommended and pre-selected, showing its saving.
  2. Payment method, on Stripe's hosted page in setup mode.
  3. Billing contacts, comma-separated.
  4. Review and pay.

  The webhook copies paid invoices to every contact after the first.
- **Phones:** the Knowledge Library works on phones, with the other tabs hidden. The rest stays desktop-only, and the gate links to the library.

**Docs:** as-built additions in doc01 §4, doc03 Stage 5, doc04 §5 and doc05 §5.

**User actions needed:**
- Run 0018.
- Enable `invoice.paid` on the Stripe webhook endpoint.

**Not verified live:** the address lookup services and real Stripe setup or payment. The development container can't reach them.

**Open thread:**
- Scanned (older BCS/LMS) plans still need a typed lot count.
- Options:
  - Add OCR on our servers.
  - Accept sending the plan image to the AI. A strata plan is a public LTSA record, but it does carry surveyor and signatory names, so this needs the user's decision under the PII rule.

---

## 2026-10-01 (evening) — Docs reconciled with what was built; reset script keeps Super Admins

**Context:** the governance layer (documents, knowledge base, meetings, Meeting Mode, minutes) was built and deployed today in a Claude Code session. Several of the user's decisions along the way change what docs 01–04 say. No changelog entries had been written for that work yet; the four entries below this one cover it.

**What changed in the docs:**
- **doc01 §4** opens with a new **"As built, 2026-10-01"** block, which supersedes the older schema text wherever they disagree. The stale passages it supersedes are marked inline (search "SUPERSEDED" / "AS BUILT"):
  - the `can_create_meetings`/`can_chair_meetings` pair and the chair-eligibility rules
  - private notes in the minutes
  - the proxy-holder map
  - the trial ending at adjournment
  - the eight-folder list (the ninth, `correspondence`, is confirmed)
  - §7 items 7 and 15
- **doc02** has an as-built block under its header covering:
  - Stripping is applied to everything sent to any AI service, local queries included. This supersedes §2's "global pool only" rule.
  - The `lib/pii.ts` layers and pseudonymize-and-restore.
  - The real indexing pipeline.
  - The AI call sites.
  - Minutes summaries aren't an AI call. §5a is marked not built.
  - The `owners_and_council.owner_type` and `role` comments are corrected.
- **doc03:** Stages 5 and 5a have as-built blocks:
  - single meeting permission, Member at Large, council lots
  - invites and billing
  - trial ends at launch; the launcher runs the meeting
  - chair selection and election; motions
  - minutes, and the built checklist
- **doc04:** §5 has an as-built block (no OCR, stripped corporation chunks, Inngest custom-domain sync). §10 has the current deploy loop:
  - PRs merged by the user
  - migrations handed over as files and written to be re-runnable
  - the 0016 grants lesson
  - the reset script

- **doc05 §5:** two rules added. There is one clay (primary) button per moment, and it moves to the next step (e.g. Save agenda, then Launch). Locked features use a greyed padlock SVG, never an emoji.

**The docs were annotated, not rewritten.** The older text is kept and marked superseded, so the reasoning history survives. A later cleanup pass can fold the as-built blocks into the body and drop the superseded passages.

**Reset script:** `supabase/scripts/reset_all_data.sql` now keeps every Super Admin account, with its profile and two-factor setup, and clears everything else. The user asked for this after re-granting Super Admin following a sweep.

---

## 2026-10-01 (afternoon, cont'd) — Fixes from the first end-to-end test (migration 0017, PR #4)

**Context:** after the clean reset (entry below), the user went end to end on production: signup, strata creation with the real Strata Plan, the roster CSV, invites, roles, historic minutes, a council meeting through to finalized minutes. Most of it worked first time. Fifteen fixes and requests came out of it, all built in one pass, merged as PR #4, with 0017 applied.

**Roster and council**
- **Member at Large** role, with any number of holders.
- **Owner type** is exactly Owner Occupant, Owner Absentee or Developer. The upload had failed on the old values.
- The Email cell accepts **several addresses** for co-owners. The user's real 102-lot file now parses cleanly, and an anonymized copy is a test fixture.
- **Council members tied to strata lots.** The council meeting had shown all 102 lots for attendance because no lots were marked council. Now:
  - the admin sets each member's lot
  - council lots follow from members with council roles
  - council and committee meetings use council lots only and can't launch without them
- **Training columns:** placeholder circles, one per module, until the training tables exist.

**Meetings**
- **Motions:** standard wording for every template item. Custom items get a "Draft with AI" button with stripped input. Always editable.
- **Save Agenda** is the primary button while there are unsaved changes; **Launch** becomes primary once saved.
- **Chair** dropdown: President, Vice President, Manager, someone else, or elected at the meeting. Meeting Mode can add an Elect Chairperson vote, and the winner becomes chair on the minutes.

**Billing**
- **Admin-only.** The user's rule: "Non-admins shouldn't see any billing info." Non-admins are redirected, and locked features say to ask the admin.
- The layout follows the reference app's billing page: payment method and subscription, account statements by period from Stripe, and every strata the admin runs with its monthly cost and total.

**Other**
- **Strata Plan indexing:** creation-time uploads lacked a file name and source type, so they couldn't be indexed ("Only PDF, Word..."). They're now normal documents, indexed on approval.
- **Re-index only:** indexing is automatic on upload, so the manual Index button was removed.
- **Profile photos persist** (private `avatars` bucket).
- **"Super Admin"** header label. Super Admins see a strata's decision ledger for support.
- **Wrong-email invites mitigated:**
  - 7-day expiry, renewed on resend
  - admins emailed on acceptance
  - no roles until assigned

**Checked, not changed:** the user reported a secretary editing the roster. The roster is admin-only in both the UI and the database (RLS and the RPCs). If it recurs, a screenshot with the signed-in account will show what happened.

**Deploy note:** the first paste of 0017 into the SQL editor was truncated ("syntax error at or near raise"). From now on migrations are handed over as files, and 0017 was rewritten to be safe to re-run.

---

## 2026-10-01 (afternoon) — Production "permission denied" (migration 0016, PR #3); clean reset; Inngest sync

**What broke:** after the governance layer merged, the user couldn't reach their own strata.
- Every query a signed-in user made failed with `permission denied for table corporation_memberships`.
- The app read each failure as "no rows": no connected strata, failed join requests, empty rosters.
- **Root cause:** the tables had never been granted to the `authenticated` role. Newer Supabase projects don't expose new tables to the Data API automatically. Local tests missed it because the test setup granted itself access.

**Fix (0016):**
- Grant select/insert/update/delete on all public tables to `authenticated` (every table has RLS) and full access to `service_role`.
- Narrow `profiles` updates to `full_name` and `phone`, so nobody can make themselves Super Admin.
- Set default privileges for future tables.
- Verified against a database built from the migrations alone.

**Also in PR #3:** the temporary debug panel on `/strata` was removed, and a full data reset script was added.

**Clean reset:** rather than repair data seeded from early placeholders, the user swept the database and started over. That set up the end-to-end test in the entry above.

**Inngest:** syncing failed against the `*.vercel.app` URL because Vercel Deployment Protection blocks it. Setting the integration's custom production domain to `app.stratacouncil.ca` and re-syncing fixed it. `index-document` is live. `INNGEST_*` and `VOYAGE_API_KEY` are set in Vercel.

---

## 2026-10-01 (midday) — Governance layer built: documents, knowledge base, meetings, Meeting Mode, minutes (migrations 0012–0015, PR #2)

**Context:** with corp creation and the roster live, the next step toward the paid product was the governance layer. Meeting Mode mechanics were rebuilt from the reference app; identity, roles and billing followed these docs. The user answered a round of questions first. Those answers are the decisions recorded here and in the as-built blocks.

**Decisions (user, 2026-10-01):**
- **Who runs meetings:** whoever currently holds secretary or admin, plus anyone the admin grants a single "Can run meetings" switch. This replaced `can_create_meetings`/`can_chair_meetings`, and existing toggle values carried over. The chair is a label. The secretary training track will include a module on running meetings.
- **One launch per meeting.** Only the launcher runs it.
- **Free trial ends at launch.** Drafting stays unlimited; adjournment-based expiry invited abuse.
- **Private notes:** only the agenda editors and the launcher see them. They're never on the agenda or minutes, never sent to the AI, and deleted forever at finalize. This reverses doc01's "manager section of the minutes."
- **Quorum:** proxies count toward quorum at AGM/SGM only (SPA s.48). No proxy-holder record.
- **Nothing left silently unresolved:** an unreached item is deferred automatically, and adjournment warns "This meeting has unresolved agenda items. Mark all as deferred?"
- **Adjournment is a motion** (moved, seconded, majority). Where the docs and the reference app disagree on mechanics, the reference app wins.
- **Agenda after approval:** items can still be added or edited behind an "already approved, are you sure?" confirm. Attendance stays editable for late arrivals.
- **Exports:** draft agendas and draft minutes export as .docx. Final minutes are a real PDF file rather than a browser print, chosen for a legal record.
- **AI:**
  - Rebuild what the reference app has: the Meeting Mode assistant, the standalone assistant, uploaded-agenda parsing, and historic-minutes extraction.
  - Both assistants retrieve from the knowledge base (Voyage plus pgvector).
  - Use the most capable Claude model.
  - **"PII stripping needs to be flawless. Use the stricter rules. Any data fed to the Stratasphere needs to be PIPA and PIPEDA compliant."** (Later narrowed to PIPA only: BC strata data falls under BC's Personal Information Protection Act.) As a result, everything sent to any AI service is stripped.
- **Link attachments** on agenda items are included. They're indexed and filed in Agenda Attachments.
- **Documents:** nine folders, Correspondence kept.
- **Locked features** are greyed with a padlock icon (not an emoji). Interacting prompts a subscription.

**What was built:**
- PII library (`lib/pii.ts`, tested).
- Document repository (0012): upload, folders, download, move.
- Knowledge base (0013): pgvector, `knowledge_chunks`, Inngest indexing, semantic search.
- Meetings (0014): permission, guarded lifecycle, `launch_meeting`, private notes table, decision ledger, agenda builder with templates, uploaded-agenda parsing, attachments, .docx agenda export.
- Meeting Mode: attendance, quorum, scripts, votes, defer, consensus, embedded assistant, autosave.
- Adjournment and minutes (0015): `adjourn_meeting`, `finalize_minutes`, the AI request cap, historic decisions.
- The Minutes page with draft editing, .docx and PDF exports, and historic-minutes upload with reviewed decision extraction.
- **Bug fix along the way:** the StrataSphere sub-nav and several pages built links from the placeholder corporation, which was broken for every real strata.

---

## 2026-10-01 (cont'd twice more) — `documents.category` taxonomy resolved: the app's eight folder names are the source of truth

**Context:** closing the last open thread from the roster-build entries below. Asked which of the two disagreeing category lists was correct, the user supplied the real list from the app's own Documents screen (seven folders visible in a screenshot, plus a remembered eighth — "Agenda Attachments" — and an uncertain, ultimately-declined ninth, possibly "Minutes"). The user also made the key point that settled how to think about this: `category` is purely a human-filing label — it doesn't affect storage, security, or AI indexing, which treats every uploaded document identically regardless of category — so there was no technical reason to prefer either list, only a consistency one.

**What was decided:** the app's eight folder names are now the documented standard — `building_construction`, `contracts_service_agreements`, `financial_accounting`, `insurance`, `legal_governance`, `meetings_records`, `operations`, `agenda_attachments` — replacing doc01 §4's old seven-value placeholder (`bylaws | policies | financial | insurance | correspondence | minutes | other`), which had never been reconciled against what was actually built. **`agenda_attachments` is assigned automatically, not picked — corrected within this same pass once the user clarified intent.** It's the category stamped on any document uploaded directly through the agenda-item-attachment flow (doc01 §4's `{ type: 'document', document_id, ... }` references) — the uploader never chooses it manually. The other seven categories are user-chosen, in the general Documents screen only. Mechanically identical to any other document otherwise — same storage, same indexing. Left open deliberately: a ninth category can be added later if a real gap shows up — this is the working set, not a closed list.

**What changed:** doc01 §4 — the `documents` table's `category` comment rewritten to the eight-value list, with a new explanatory note on the resolution, the `agenda_attachments`/agenda-item-attachment distinction, and the "may grow to nine" caveat.

**No app code changed this pass** — this was a docs-only decision resolving which existing list is canonical; the app's Documents screen was already built against these eight names, so nothing there needs to change. Worth Claude Code double-checking spelling/casing matches exactly before building anything new against `documents.category` (e.g. the first-meeting checklist's document-upload step).

---

## 2026-10-01 (cont'd once more) — Branch merged to main; migrations 0010 and 0011 applied to production

**Context:** closing out the two "still needed before this is live" items from the entry directly below.

**What happened:** `claude/wizardly-noether-r7mkam` was merged into `main` on GitHub (bringing in both the corp-creation/roster pass and the owner/lot-roster pass in one merge). Migrations `0010_corp_creation_and_roster.sql` and `0011_owner_roster_upload.sql` were then run, in that order, directly in the Supabase SQL Editor against production — both confirmed successful, no errors.

**What this means is now live in production:** real corporation creation with manual review, the real council roster (roles, invites, join requests, meeting-permission toggles), and the owner/lot roster (CSV upload with preview-before-apply, per-lot direct editing, admin-only download) — all previously only verified against a local test database. Not yet separately confirmed by clicking through the live site, but the underlying schema and server-side logic are now the real thing, not placeholder data, for anyone using the production app.

**Still open, unchanged from the entry below:** the `documents.category` taxonomy mismatch (doc01 §4's list vs. the app's nine reference-product folder names) still needs a decision before the document repository gets built; the training-visibility matrix and StrataSphere-conversation deletion-on-removal are still blocked on Education's tables not existing yet.

---

## 2026-10-01 (cont'd) — Owner/lot roster built (CSV upload, per-lot edit, export); a seeding-trigger bug fixed; references to the reference product removed from the codebase

**Context:** with the docs synced back to the Project after the corp-creation/roster pass (entry below), the user asked for a recommendation on the next concrete piece of work. Picked **the owner/lot roster (`owners_and_council`, doc02 §2/§2a)** over the alternatives: it's the most completely specified unbuilt surface (column mapping, diff-only upsert, blank-means-no-change, unknown-lot rejection, direct edit — no open questions), it's the next thing on the path to the product's paid moment (step 1 of doc03 Stage 5a's first-meeting checklist; Meeting Mode attendance is keyed on its lot numbers; doc02 §2's PIPA name→lot pass reads from it), and it sits directly on what had just shipped (approval already pre-seeds SL001…SLnnn). Passed over: moving Training onto real tables (the course content — slides, knowledge checks — doesn't exist yet; the app only has module titles, so it would be empty tables), and the Documents repository (blocked on the open `documents.category` taxonomy mismatch, below). The user also set a standing rule this pass: **nothing in the codebase, naming, or copy references the reference product** — it's reference material for Meeting Mode mechanics only (added to the house-style rules at the bottom of this log).

**What was built (`app.stratacouncil.ca`, same branch `claude/wizardly-noether-r7mkam`, two more commits — still not merged):**
- **References to the reference product removed** from every code comment that cited it (design tokens, logo, documents folders, meetings list, placeholder data, the old lots page) — reworded so the reasoning stays and the reference goes. a search of the tracked codebase for its name now returns nothing.
- **`supabase/migrations/0011_owner_roster_upload.sql`**:
  - `apply_owner_roster_upload(corp, rows jsonb)` — applies a parsed upload atomically: explicit admin check (a non-admin's update would otherwise silently match zero rows and "succeed"), whole-file rejection on unknown or repeated lots, field-level diff via `coalesce` (NULL = blank cell = no change), only rows that actually change are touched. Knows only the ten CSV-mapped columns. Security invoker, so RLS still governs the write.
  - **Bug fix to 0004's pre-seeding trigger:** `lpad(i::text, 3, '0')` *truncates* as well as pads in Postgres, so lot 1000 was seeded as `SL100` — colliding with the real SL100 on the unique key, which would have made approving any strata with 1,000+ lots fail outright. Now pads to three digits and never cuts (`SL1000`, `SL1001`, …). Verified with a 1,002-lot corporation.
- **Strata Lots page (`/strata/[corpId]/lots`)** rewired from placeholder data: every connected member sees the roster; the admin gets an upload card (download template / download current roster / upload CSV → previewed diff → apply) and a per-lot editor covering the ten roster fields plus the four governance fields (on council, role — Member at Large is "on council, no officer role", council delegate name/email).
- **`lib/roster-csv.ts`** — the one definition of the CSV format, shared by upload and export: RFC 4180 parsing (quoted commas/newlines, Excel's BOM, CRLF), header-matched columns in any order (a missing column = no change), per-cell validation, writer with spreadsheet formula-injection guarding that round-trips on re-upload.
- doc02 §2a records the four implementation decisions (whole-file rejection for any problem; preview before apply; lot-number formatting forgiven but existence enforced; download admin-only for PIPA reasons).

**Verified, not assumed:** `tsc` and `next build` pass; CSV parser unit-tested directly (normalization, quoting, BOM, round trip, every error path — the tests caught one real bug, blank template rows not being skipped, fixed before commit); migrations 0001–0011 applied to the local Postgres 16 harness; the earlier 50-check flow plus 15 new roster checks pass under real RLS (first upload, idempotent re-upload with `350.00 = 350` and no `updated_at` churn, blank-never-clears, rejected file writes nothing, governance fields untouched by an upload, member read-only, outsider sees nothing). Not tested against real Supabase, not clicked through in a browser.

**Still needed before this is live:** merge the branch; apply **both `0010` and `0011`**, in order, in the Supabase SQL Editor.

**Open thread, not yet acted on:**
- **First-meeting checklist (doc03 Stage 5a)** — the roster is its step 1; the checklist itself isn't built (steps 3–5 need Meeting Mode).
- **Phased developments adding lots** (doc02 §2a, doc01 §4: a Super Admin `unit_count` edit that also adds the new lots to `owners_and_council`) — not built; nothing in the app can change `unit_count` yet.
- **`owners_and_council.role` vs. `corporation_role_assignments`** — two independent records of "who's treasurer" by design (doc02 §2a: lot-level governance fields are admin-set separately from the account-level role model), but nothing keeps them consistent. Fine for now; worth deciding whether one should derive from the other once Meeting Mode reads them.
- Carried over from the entry below, still open: `documents.category` taxonomy mismatch (note: the app's placeholder data explicitly calls its nine-folder list "the source of truth for the taxonomy going forward," implying doc01 §4's enum is what should change — not yet confirmed or edited), training matrix blocked on Education tables, conversations deletion on removal blocked on doc02 §4b's tables.

---

## 2026-10-01 — Corporation creation (reviewed) and the real council roster built; migration 0010 written, not yet applied

**Context:** continuing the build after Stripe/billing — the user asked for corp creation and the roster "per the reference product's project docs." This session ran in a Claude Code cloud container with the `app.stratacouncil.ca` repo checked out and direct `git push` access to a feature branch (`claude/wizardly-noether-r7mkam`) — not the device-bridge + Terminal-command loop from doc04 §10. The docs themselves were handed over mid-session as uploads (the cloud session can't see this Project). An early pass briefly used the reference product's HTML as a reference before the user stopped that; nothing from it survived into the code, and everything was then reconciled against doc01/03/05 in a second commit.

**What was built (`app.stratacouncil.ca`, branch `claude/wizardly-noether-r7mkam`, two commits — not yet merged to `main`):**
- **`supabase/migrations/0010_corp_creation_and_roster.sql`** — no new tables (all already existed from 0002/0005); adds what the app needs to use them:
  - Pending-uniqueness indexes: one pending join request per (corp, person); one pending invite per (corp, email); **one pending creation request per SP#, from anyone** (doc01 §1 "another pending request already exists → rejected").
  - Private `strata-plans` Storage bucket (no client policies — uploads via a server-minted signed URL, review via a server-minted signed read URL).
  - `security definer` reads that have to cross `profiles`' read-own-row RLS: `lookup_strata_corporation(sp)` (lookup-first, for non-members), `strata_plan_has_pending_request(sp)`, `corporation_member_directory(corp)`, `corporation_join_request_queue(corp)` (admin only), `my_pending_invites()`.
  - Writes: `accept_corporation_invite(id)` (email must match the signed-in account; idempotent; also closes the invitee's own pending join request), `resolve_corporation_join_request(id, approve)` (security invoker — RLS is the gate), `set_corporation_member_roles(corp, user, roles[])`, `remove_corporation_member(corp, user)`, `approve_corporation_creation_request(...)` (Super Admin; creates the corporation, seeds `owners_and_council` via 0004's trigger, makes the requester active member + admin, attaches the plan document — one transaction).
  - Super Admin read policies on `corporation_role_assignments` and `corporation_memberships` (for the admin console's read-only detail view).
- **`/strata`** — the real lookup-first flow (doc01 §1): SP# → existing corp routes to "Request to join" (no upload); no match → upload the Strata Plan PDF (browser-direct to Storage, since Vercel caps request bodies at 4.5 MB) → plan details → attestation → pending request. **Parsing isn't built**: the plan-details fields are typed by hand, and the form says so on screen. Also lists the user's pending invites (accept from here if the email link expired) and their open requests.
- **`/admin`** — real review queue + real corporation list (replacing `allCorporations` mock); **`/admin/requests/[id]`** — reviewer opens the PDF, corrects fields, approves or denies; **`/admin/[corpId]`** — real roster.
- **Council & Roles** — `CouncilRoster`/`RosterTable`/`RosterInvites`/`RosterJoinRequests` rewired from placeholder data to real reads/writes. One-holder roles *move* when assigned to someone else (how a seat changes hands); admin can only be handed over, never dropped, and the admin holder can't be removed; BC president/VP rule enforced in the editor with the 0002 trigger as backstop. Two independent `role="switch"` meeting-permission controls per member; the admin's read on and locked (implicit through the role, doc01 §4).
- **Invites** — `auth.admin.generateLink()` (`invite` for new addresses, `magiclink` for existing) → custom Mailtrap email → `/auth/confirm` → `/invite/[id]`, which accepts. A brand-new invitee gives their own name on a one-step **`/welcome`** page (doc01 §4a). Pending invites can be re-sent (links expire).
- **Notifications (Mailtrap, best-effort):** creation request approved / denied, join request approved (doc03 Stage 4).
- Fixed a pre-existing bug: the switcher's "+ Connect another strata" linked to `/strata`, which immediately redirected back into the current corp.

**Verified, not assumed:** `tsc` and `next build` pass in the container (npm registry reachable there, unlike earlier sessions). Migrations 0001–0010 applied cleanly to a throwaway local Postgres 16 with stubbed `auth`/`storage` schemas; a 50-check SQL script exercised the whole flow under real RLS as the `authenticated` role with six users (creation + competing request, approval, join request + approval, invite + acceptance, role moves, BC bylaw, admin hand-over, removal, permission toggles, outsiders refused). **Not** tested against the real Supabase project, Mailtrap, or Storage, and the UI wasn't clicked through.

**Still needed before this is live:**
- Merge the branch (`claude/wizardly-noether-r7mkam` → `main`), and **apply migration `0010`** in the Supabase SQL Editor (same pattern as 0006–0009).
- Supabase Auth's OTP/link expiry governs invite links (1h default) — Resend covers it; worth deciding whether to lengthen it.

**Doc edits this pass (made directly in the handed-over bundle, per the README's sync workflow):**
- **doc01 §1** — the "duplicate-checking is no longer as clean as a unique-key collision… the review step adjudicates, not the database" paragraph contradicted the flow directly above it ("another pending request already exists → rejected"). Resolved as built: the database enforces one *pending* request per SP#, and the lookup warns the second person before they upload. Paragraph rewritten to say so.
- **doc04 §10** — added the Claude Code cloud-session working mode (repo checked out in a container, real `npm`/`tsc`/`next build`, direct push to a `claude/*` feature branch, user merges) alongside the existing device-bridge loop, which still applies to claude.ai chat sessions.
- **doc04 §9** — the summary table's Billing row still read "Stripe — not yet started", stale since the 2026-09-30 Stripe build; corrected.

**Open thread, not yet acted on:**
- **Training-visibility matrix on Council & Roles (doc03 Stage 5, doc01 §3a) isn't built** — `course_completions` (and the rest of doc01 §3's Education tables) don't exist in any migration yet, so there's no real data to show. The old mock's training columns were removed rather than left showing fake dots. Comes back once Education is on real tables; managers excluded from it per doc03.
- **Removal doesn't delete StrataSphere conversations** (doc02 §4b) — those tables don't exist yet.
- **`documents.category` mismatch:** doc01 §4 lists `bylaws | policies | financial | …`, but the app's Documents screen uses the nine folder keys taken from the reference product (`legal_governance`, …). The uploaded Strata Plan is filed as `legal_governance` to match the app; worth reconciling in the docs.
- The `/strata` TEMPORARY debug panel is still there, untouched — remove once the redirect bug is confirmed fixed.

---

## 2026-09-30 (afternoon, cont'd once more again) — All outstanding migrations (0006–0009) applied to production Supabase; invoice-email delivery confirmed enabled in Stripe

**Context:** closing out the last two infra items from the Stripe/billing-email work above. Asked to apply migrations `0008` and `0009`, the user flagged they didn't recall ever running `0006` (marketing consent) or `0007` (MFA backup codes) either — both had been written and synced to the Mac in earlier sessions but, per this log's own entries at the time, were left for the user to run locally and were never confirmed as actually applied.

**No direct database connector in this session, so nothing here could be verified by querying — ran a diagnostic first rather than assuming.** A short `information_schema` check (does `profiles.marketing_opt_in` exist? does `mfa_backup_codes` exist? does `subscriptions.committed_until` exist? does `subscriptions.billing_email` exist?) confirmed all four were unapplied — genuinely never run, not a false memory. That ruled out the risk of re-running an already-applied migration and hitting a false "column already exists" failure, so all four were bundled into one script, in order, and run as a single paste into the Supabase SQL Editor. Re-ran the same diagnostic afterward: all four now `true`.

**Also confirmed, not assumed:** the user checked Stripe's Settings → Business → Customer emails panel directly — "Successful payments" is already toggled on, meaning Stripe will actually email the invoice to whatever address sits in a Customer's `email` field. This closes the one open item flagged in the billing-contact-email entry below (setting the field alone doesn't guarantee delivery; the toggle is what does).

**What changed:** no code this pass — purely applying already-written migrations to the real database, and confirming an existing Stripe dashboard setting. `app.stratacouncil.ca`'s schema is now caught up to everything this log has described as built: marketing consent, MFA backup codes, the Stripe billing columns, and the billing contact email.

---

## 2026-09-30 (afternoon, cont'd once more, billing contact email) — Invoice/receipt recipient separated from the subscribing admin: required at subscribe time, editable any time after

**Context:** closing the one open item left from the Stripe build (entry below): the Stripe Customer record was being created with no email at all, so Stripe's invoices/receipts — which the user flagged as the actual source documents strata treasurers need for monthly budget reconciliation — had nowhere to go. Asked directly, the user didn't just say "add the admin's email" — they correctly pointed out the admin doing the subscribing often isn't the right recipient at all: it should be whoever handles the corporation's books, the Treasurer or the strata management company, and that person changes over time (a Treasurer rotates out, the corporation switches management companies) independently of who holds the admin role. Two explicit requirements: required on the subscribe flow, and editable after the fact.

**What was built (`app.stratacouncil.ca` repo):**
- **`supabase/migrations/0009_billing_contact_email.sql`** — new `subscriptions.billing_email` column, with a basic regex check constraint as a DB-level backstop. Written only via the service-role path, same as the rest of the table (0005_rls.sql's "no direct client write policy" still holds).
- **`app/strata/[corpId]/billing/actions.ts`**:
  - `getOrCreateStripeCustomer(corporationId, billingEmail)` now takes the billing email and sets it on the Stripe Customer at creation, or updates it on the existing Customer (and mirrors it into `subscriptions.billing_email`) if the corporation is resubscribing under a new contact. Also pinned the Customer's `name` to the strata plan number itself (`corporationId` — e.g. `EPS1234`) rather than the building/legal name, per the user's correction: the plan number is immutable, a building or legal name isn't, and the Customer record shouldn't drift out of sync with the corporation's real identity if either is ever renamed. The (mutable) building/legal name now goes in Stripe's `description` field instead, so it's still visible when scanning the Stripe dashboard. The existing-Customer branch re-asserts `name` on every reactivation too, so any Customer created before this change self-heals rather than staying stuck with the old naming.
  - `startCheckout(corporationId, interval, formData)` reads `billingEmail` from the submitted form (via a small `requireBillingEmail()` validator — non-empty, basic email shape) and throws if it's missing or malformed, rather than letting a Customer get created with no email the way it did before this pass.
  - New **`updateBillingEmail(corporationId, formData)`** — a standalone Server Action, independent of subscribing/changing plan/canceling, admin-gated the same way as everything else in this file. Updates the Stripe Customer's email if one exists yet, and upserts `subscriptions.billing_email` either way, so this works even for a corporation that hasn't subscribed yet (an admin can set the contact ahead of time).
- **`app/strata/[corpId]/billing/page.tsx`** — two UI changes:
  - The "Subscribe" card (shown when not yet subscribed) now has a required email input ahead of the two Subscribe buttons — one `<form>`, two buttons using `formAction` to route to `startCheckout(..., "monthly")` / `(..., "annual")` respectively, so the same email field feeds either plan choice without duplicating the input.
  - A new **"Billing contact"** card, always present once there's a subscription record (active or deactivated), with its own small form (`updateBillingEmail`) so the email can be changed at any time — deliberately not folded into the plan-change or cancellation actions, since a contact handover has nothing to do with the subscription itself. Both inputs follow the app's existing `field`/`field__hint` convention (matching login/signup), not a new ad hoc class.

**Deliberately not done, flagged rather than silently skipped:** whether Stripe actually *emails* the invoice to that address is a separate Stripe Dashboard setting (Settings → Customer emails → "Successful payments"/invoice emails), not something this code controls — worth the user checking that's turned on, since setting the Customer's `email` field alone doesn't guarantee Stripe sends anything to it.

**Synced to the user's Mac** via device-bridge (3 files: the migration, `billing/actions.ts`, `billing/page.tsx`) — verified on disk by re-staging and grepping for the new symbols after the write, not just trusting the commit result, per the practice established earlier this session (a second, in-place `actions.ts` fix within this same pass needed one `force: true` retry to actually land — same reliability issue as the webhook-route fix below). Commit/push handed to the user as the standing Terminal-command workflow. **(Migration `0009` — and `0008` before it — have since been applied to production; see the entry above.)** `npm run build`/`tsc` unverified in this sandbox, same persistent caveat as the rest of this session's code.

---

## 2026-09-30 (afternoon, cont'd yet again, Stripe build) — Real Stripe subscription code built: Checkout, webhook sync, cancellation/plan-change, billing portal, free documents RLS

**Context:** with the billing design fully resolved (the four entries below — monthly-installment annual pricing, Stripe-native `cancel_at`/`cancel_at_period_end` cancellation, free/permanent documents, trial-expires-on-activation), the user said "Let's go ahead with the Stripe subscription code" — moving from design to a real implementation in the `app.stratacouncil.ca` repo.

**What was built:**
- **`supabase/migrations/0008_billing_and_free_documents.sql`** — two independent changes in one migration: (1) adds `committed_until`, `cancel_at`, `current_period_end` to `subscriptions`, all written only via the service-role/webhook path, mirroring Stripe's own fields so the billing page never needs a live Stripe call just to render; (2) drops the two subscription-gated `documents` RLS policies from `0005_rls.sql` and replaces them with membership-only read/insert policies, implementing the free-forever document repository decided two entries below.
- **`lib/stripe/client.ts`** — a lazily-constructed, server-only Stripe client (same shape as `lib/supabase/admin.ts`), reading `STRIPE_SECRET_KEY`.
- **`lib/stripe/prices.ts`** — Price-ID lookup by plan (reading `STRIPE_PRICE_{MONTHLY,ANNUAL}_{BASE,UNIT}`), the billing-estimate math (`calculateBilling`, now using the real $82.50/$2.08 annual rate instead of the old "10 months, 2 free" lump-sum formula the mock had), and `computeCommittedUntil()` (activation + 12 months, computed once).
- **`app/strata/[corpId]/billing/actions.ts`** — the Server Actions behind every button on the billing page, all authorization-checked in code (queries `corporation_role_assignments` for an `admin` row) since `subscriptions` has no client write policy at all:
  - `startCheckout(corpId, interval)` — creates/reuses a Stripe Customer, then a Checkout Session (mode `subscription`, two line items: base qty 1, per-unit qty = unit count, automatic tax on) and redirects there.
  - `changePlan(corpId, newInterval)` — swaps the existing subscription's two line items onto the other plan's Prices in place (not a second subscription), resetting `activated_at`/`committed_until` so the webhook treats it as a fresh 12-month window if switching onto annual.
  - `cancelSubscription(corpId)` — the doc01 §4b mechanism made real: `cancel_at_period_end` for monthly, `cancel_at` set to the stored `committed_until` for annual. No fee, no application-level lock — Stripe itself keeps billing/access alive until the date, then stops.
  - `openBillingPortal(corpId)` — a Stripe Billing Portal session for payment-method updates and invoice history, rather than a hand-built card form or invoice list.
- **`app/api/stripe/webhook/route.ts`** — the receiver that actually writes `subscriptions.status` and the rest of the billing columns, modeled on `app/api/auth/send-email-hook/route.ts`'s one-receiver-many-event-types shape but verified with Stripe's own SDK (`stripe.webhooks.constructEvent`) rather than hand-rolled HMAC. Handles `customer.subscription.created/updated/deleted` and `checkout.session.completed`. Maps any Stripe status other than `active`/`trialing` to our binary `deactivated` (doc01 §4b: no past_due state surfaced). On first activation, also flips `strata_corporations.free_meeting_used` to `true` — the trial-expires-on-activation rule from the entry directly below, now actually implemented, not just designed.
- **`app/strata/[corpId]/billing/page.tsx`** — rewired from `lib/placeholder-data.ts`'s mock `subscription`/`calculateBilling` to real data (a Server Component reading the signed-in user, the `subscriptions` row, and a live Stripe payment-method lookup), with real `<form action={...}>` buttons instead of inert `data-testid`-only buttons. The stale "Annual is billed once, up front — two months free" copy is gone, replaced with the real monthly-installment-both-plans explanation.
- **`package.json`** — added the `stripe` npm dependency.

**Scope choices, stated plainly:**
- **Stripe Checkout (hosted), not a hand-built Stripe Elements card form**, for new subscriptions — PAD/Interac/3DS handling comes for free, and it matches the "don't build for a problem you don't have yet" house rule. Existing-subscription payment-method updates go through the Billing Portal for the same reason.
- **The Stripe Billing Portal is used for invoices and payment-method updates, but *not* for cancellation** — the Portal's default cancel behavior doesn't match the annual "`cancel_at` = 12-month anniversary, no fee" design, so cancellation is its own Server Action calling the Stripe API directly instead.
- **No new `NEXT_PUBLIC_APP_URL`-style env var needed for Checkout/Portal return URLs** — built from the incoming request's own `host`/`x-forwarded-host` header instead, since both routes already know which origin they're being hit from.

**Still needed before this goes live, not done in this pass (infra, not code):**
- **Six new Vercel environment variables** (Production + Preview, same pattern as `SUPABASE_WEBHOOK_SECRET`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY_BASE`, `STRIPE_PRICE_MONTHLY_UNIT`, `STRIPE_PRICE_ANNUAL_BASE`, `STRIPE_PRICE_ANNUAL_UNIT` (the four Price IDs from the Stripe dashboard, confirmed correct two entries below). **(Done — see the entries above this one covering the Vercel walkthrough and confirmation.)**
- **A Stripe webhook endpoint** needs creating in the Stripe dashboard (Developers → Webhooks) pointed at `https://app.stratacouncil.ca/api/stripe/webhook`, subscribed to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `checkout.session.completed` — its signing secret is `STRIPE_WEBHOOK_SECRET` above. **(Done — created as an "event destination," Stripe's current dashboard naming for webhooks, Snapshot payload style, same 4 events.)**
- **The new migration (`0008`) needs applying** to the real Supabase project.
- **`npm run build`/`tsc` unverified in this sandbox** — same persistent `registry.npmjs.org` 403 noted throughout this log; this is real, non-trivial new code (a new npm dependency, two new Server Action files, a new Route Handler) that has not been through a real TypeScript compile yet, more so than most recent entries' smaller fixes. Worth watching the first Vercel build closely rather than assuming success. **(A real build error was in fact caught and fixed — see the fix note directly below.)**

**A real Vercel build failure, caught and fixed after this was deployed:** the webhook route's `current_period_end` read failed to compile (`Property 'current_period_end' does not exist on type 'SubscriptionItem'`) — the `as any` cast covered only the outer Subscription-level access, not the Subscription-Item-level fallback read on the same line. Fixed by casting the whole `sub` object to `any` once (`const subAny = sub as any;`) and reading both shapes off that. **A real device-bridge reliability issue surfaced while landing this fix:** the first `device_commit_files` call reported success, but the user's `git commit` found nothing to commit — the file hadn't actually changed on disk despite the "written" result. Re-staging and grepping confirmed the old broken line was still there. Fixed by re-running `device_commit_files` with `force: true`, then re-staging and grepping *again* to explicitly confirm the new code was present before telling the user it was safe to commit — this verify-after-write step is now treated as mandatory for every device-bridge file write in this session, not optional, and is what caught the same issue recurring on the billing-contact-email pass above.

**Synced to the user's Mac** via device-bridge (7 files: the migration, both new `lib/stripe/` files, `billing/actions.ts`, the webhook route, the rewritten `billing/page.tsx`, `package.json`) — commit/push handed to the user as the standing Terminal-command workflow.

---

**Also checked this session: the stale "mandatory SMS 2FA at every signup" marketing tile the user asked to remove ("Let's remove this for now") turned out to already be gone** — `stratacouncil-marketing/app/page.tsx` has been substantively rewritten since the entry that added it, into a pure training/education homepage with no security/trust section at all. Confirmed against the user's own Vercel deployments screenshot that this is the real, live site. Nothing left to edit.

---

## 2026-09-30 (afternoon, cont'd yet again) — Free trial meeting closed off: expires the instant a subscription is ever activated, not just when it's actually used

**Context:** the user tightened two related rules on the free Meeting Mode trial (`strata_corporations.free_meeting_used`, doc01 §4b/Stage 5a). First, restated plainly: whenever `subscriptions.status` isn't `'active'`, Meeting Mode and the AI assistant are unavailable, full stop — no lingering access just because a corporation never got around to using something. Second, and the real gap this closes: **the free trial only exists in the window before a corporation has ever activated a subscription — the moment a subscription activates, the trial is gone, even if it was never actually used.**

**The gap this closes, stated concretely:** under the design as it stood, `free_meeting_used` only flipped to `true` when the trial meeting was actually adjourned and finalized. That left a real loophole — a corporation could activate a subscription, cancel it again before ever touching Meeting Mode, and still show `free_meeting_used = false`, meaning it would appear to still have an unused trial available once its (now-lapsed) subscription stopped gating things. That's effectively a second free look, never the intent of a *one-time* trial. Closed by having the same code path that sets `subscriptions.activated_at` also set `strata_corporations.free_meeting_used = true`, if it isn't already, at that same moment — so activating a subscription always consumes the trial, whether or not the trial meeting itself was ever run.

**What changed:**
- **doc01 (`01-identity-multitenancy-data-model.md`) §4** — `free_meeting_used`'s schema comment rewritten to state both triggers (trial adjournment, or first subscription activation — whichever comes first). **§4b** — new paragraph after the existing free-trial explanation, stating the always-gated-when-inactive rule and the subscription-activation trigger, with the reasoning for why this was a real gap rather than a hypothetical one.
- **doc03 (`03-user-journey.md`) Stage 5a** — the flow diagram's condition rewritten from a single `free_meeting_used = false?` check to `free_meeting_used = false AND no subscription ever activated?`, with the no-branch split into "trial used" vs. "subscription was activated at some point" vs. "active subscription, no trial logic at all"; new paragraph underneath restating both rules plainly. **Stage 6** — the subscription-activation flow diagram gets a new final line: activation also flips `free_meeting_used` to `true`.
- **No app code changed this pass** — this refines the trial-expiry trigger ahead of building the subscription-activation and meeting-start code paths; nothing has been built against the old (looser) trigger yet. **(Superseded by the entry above — the app code is now built, against this exact trigger.)**
- **This log** — "Consistency status" not otherwise touched this pass; the trial-expiry rule above supersedes "flips at finalization" as the complete picture wherever it's referenced elsewhere in the docs.

---
## 2026-09-30 (afternoon, cont'd again) — Document repository moved to the free tier, permanently; decision ledger confirmed never user-facing; no V1 calendar; immutability reconfirmed as the deliberate moat

**Context:** confirming the cancellation mechanics resolved in the entry immediately below, the user described what a lapsed annual subscription should still give a corporation: continued access to "all of the documents and resources," just not Meeting Mode or StrataSphere itself. Asked to pin down one remaining ambiguity (can a lapsed corporation still upload *new* documents, or only browse what's already there), the user's answer went further than a yes/no: access on any lapse should revert *exactly* to the pre-subscription state — no separate "lapsed" state to design at all — and clarified two more things in the same message: the decision ledger was never meant to be user-facing (it only feeds StrataSphere's AI context), and there's no calendar function in V1. Also restated, as the underlying reason for all of this: the account/corporation is never deleted when a subscription ends — the data staying put, permanently, is explicitly the product's moat.

**What this actually resolves, stated plainly:** the document repository (upload, browse, download every bylaw/minute/financial/contract on file) was, until this pass, listed as part of the *paid* product (doc01 §4a's original split), with only a narrow exception for whatever a corporation already had once its one free trial meeting ran out (Stage 5a). That exception is now the general rule, permanently, in both directions (never-subscribed and lapsed-after-subscribing look identical) — not just a free-trial courtesy. What stays paid, unchanged: querying the AI-searchable knowledge base built from those documents, Meeting Mode, and the AI assistant (standalone and embedded). This is a real, deliberate business-model choice, not just a UX nicety — gating raw access to a corporation's own already-uploaded records behind continued payment would work against the stated goal of accumulating as much governance material as possible (more data on the platform makes a subscription more valuable, not less), and it sits awkwardly next to this design's existing immutability principle, which treats a corporation's own records as permanent regardless of billing state.

**Two related clarifications, not previously stated anywhere:**
- **The decision ledger (`decisions`) has no user-facing browse surface in this design, at all, ever.** It exists purely as backing data that feeds the AI's context (indexed into `knowledge_chunks` the same as documents) — there was never meant to be a "Decisions" screen for members to browse independently, and the earlier draft's mention of one (Stage 7's unlock list, the sub-nav description) was wrong, not a simplification.
- **`governance_calendar` isn't a V1 feature, full stop** — this was already the substance of doc01 §7 item 21 ("keep the schema, defer the UI"), now confirmed explicitly rather than left as a technicality; no further change needed to that resolution, just removed from places in doc03 that still described it as a current (if gated) part of the product.

**What changed:**
- **doc01 (`01-identity-multitenancy-data-model.md`) §4a** — document repository moved from the "Paid" list to the "Free" list, with the reasoning (business case + immutability) spelled out in a new paragraph; `decisions`/`governance_calendar` explicitly called out as not part of this exception (decisions has no browse surface at all; calendar isn't built). **§4b** — the "Document upload and indexing" paragraph rewritten to state browsing is also free, permanently, not just pre-subscription; new paragraph on the reactivation-request section confirming a lapsed corporation's access is identical to a never-subscribed one, and reconfirming nothing is ever deleted. **§6 (RLS shape)** — `documents` moved out of the subscription-gated table bucket into its own membership-only bucket; `meetings`/`decisions`/`governance_calendar`/`knowledge_chunks` stay subscription-gated, unchanged.
- **doc03 (`03-user-journey.md`)** — Platform-structure intro, the naming-risk paragraph, and the sub-nav description all updated to drop Documents from the gated list and drop Decisions/Calendar as nav items entirely. **Stage 5** — document repository added to the free bullet list, with the same reasoning as doc01 §4a. **Stage 5a** — the "what carries over after the free meeting ends" paragraph reframed as a special case of the general rule rather than its own exception. **Stage 7** — "what unlocks" list narrowed to querying the knowledge base, Meeting Mode, and the AI assistant; document repository and decision/calendar references removed. **Stage 8** — deactivation description rewritten: access reverts to exactly the pre-subscription state (no separate "lapsed" state), documents stay free and browsable throughout, and the permanence of the corporation's record is stated as a deliberate product decision, not an implementation detail.
- **No app code changed this pass** — none of this has been built yet; this is the design resolution ahead of implementation, same posture as the billing-mechanics entries below. **(Superseded two entries above — the `documents` RLS policies are now built against this exact rule.)**
- **This log** — "Consistency status" not otherwise touched this pass; the free/paid split above is now the source of truth, superseding the "document repository is paid, with a free-trial exception" framing in any earlier entry.

---

## 2026-09-30 (afternoon, cont'd) — Annual-plan cancellation resolved: Stripe-native `cancel_at`, no fee, no application-level lock — closes the open item from the entry below

**Context:** immediately after setting up the two annual Stripe Prices correctly (monthly-interval, discounted rate — confirmed working in the Stripe dashboard: $99.00/mo + $2.49/mo, $82.50/mo + $2.08/mo, all four `interval=month`), the user clarified exactly how the 12-month commitment should behave on cancellation: the same shape as "pretty much every single software subscription in the world" — commit to 12 monthly payments, auto-renew by default, cancel anytime, but a cancellation doesn't take effect immediately — the subscription stays active through the rest of the term already committed to (billing included), then simply doesn't renew at the anniversary. Monthly works the same way at one month's granularity. Asked directly how Adobe does it, for comparison.

**Worth being explicit about, since it's a real factual difference, not just phrasing:** Adobe's actual "annual, paid monthly" plans charge an early-termination fee (roughly 50% of the remaining months owed) if canceled before the 12-month term completes — they don't just let the term ride out fee-free. What the user described, and what got built into the design, is more lenient than Adobe's real policy: no fee, ever, just "keep paying and keep access until the committed term ends, then stop." Flagged to the user as a deliberate divergence, not an oversight — nothing about the resulting design rules out adding a fee later if that's ever wanted.

**What this resolves:** the open question from the entry immediately below ("the 12-month commitment needs *some* enforcement mechanism... not yet designed") turns out to have a much simpler answer than either of the two options that entry named (a Stripe subscription schedule, or an application-level check blocking the cancel action). **Neither is needed.** Stripe's own `cancel_at` field on an ordinary Subscription already does exactly this: set it to a future timestamp (the pre-computed 12-month anniversary) rather than using the `cancel_at_period_end` boolean, and Stripe keeps auto-invoicing monthly right up to that timestamp, then cancels automatically — no schedule object, no custom logic to refuse a cancel request, no code needed at the anniversary itself. Monthly plans use the ordinary `cancel_at_period_end: true` — standard Stripe behavior, nothing new. A new `subscriptions.committed_until` column (annual only, NULL for monthly) stores the pre-computed anniversary timestamp at subscription creation, so the cancellation handler just reads it and passes it straight to Stripe rather than recomputing it.

**What changed:**
- **doc01 (`01-identity-multitenancy-data-model.md`) §4b** — the annual-plan paragraph rewritten: the hard "cannot cancel before the anniversary" framing replaced with the resolved auto-renew/no-early-effect model, the Adobe comparison recorded explicitly (including the fee difference), and the "Mechanically" paragraph rewritten with the concrete `cancel_at`/`cancel_at_period_end` mechanism and the new `committed_until` column. **§7 item 29** marked resolved.
- **doc03 (`03-user-journey.md`) Stage 6** — new paragraph explaining the resolved cancellation behavior and the Adobe comparison, replacing the old "cannot cancel" line. **Stage 8** — the admin-cancellation bullet rewritten: cancellation is always accepted immediately now, only the *effective date* differs by plan. **Open questions item 17** marked resolved, mirroring doc01 §7 item 29.
- **No app/Stripe code changed yet** — this is the mechanism decision ahead of building the cancellation handler; the two annual Stripe Prices themselves were already created correctly in the dashboard (see the entry below) and needed no further change from this pass. **(Superseded three entries above — the cancellation handler is now built exactly to this mechanism.)**
- **This log** — "Consistency status" not otherwise touched this pass; the cancellation mechanism above is now the source of truth, superseding the "not yet designed" framing in the entry immediately below.

---

## 2026-09-30 (afternoon) — StrataSphere annual billing moved from a lump-sum upfront charge to equal monthly installments, to fix a real ACSS Debit (PAD) blocker

**Context:** while walking through enabling Canadian pre-authorized debits (ACSS Debit) in Stripe's dashboard for the app's production account — Stripe labels it "Canadian pre-authorized debits" in the UI, not "ACSS Debit," which was the first snag — the user flagged a real math problem: the existing annual-billing design (doc01 §4b, doc03 Stage 6) charged the full annual amount as a single upfront Stripe charge, and Stripe's own "Canadian pre-authorized debits" configuration panel surfaces a hard **CAD $3,000 per-transaction cap** (visible on the payment method's own Availability panel, "Transaction amounts: CAD 0.50 - CAD 3,000.00").

**The math that made this a real blocker, not a hypothetical:** at the existing flat pricing ($99/mo base + $2.49/unit/mo), a lump-sum annual charge (10 months' worth) for a 102-unit strata corporation comes to roughly **$3,706 CAD including GST** — comfortably over the cap. Generalizing, any corporation above roughly **80 units** — a routine size, not an edge case — would have been unable to pay annually via PAD at all; Stripe would simply reject or block the charge. Worth noting separately: the "Increase limit" control on that Stripe payment method raises the **weekly aggregate processing limit** (account-wide), not the **per-transaction cap** — the two are different Stripe/network limits, and the per-transaction one is a fixed Payments Canada network rule, not something that scales with account history.

**The user also raised a second, independent reason the lump-sum model was wrong regardless of the PAD cap:** a strata corporation's own revenue (owner strata fees) is itself collected from owners via PAD, which the strata's management trust account only receives **monthly** — so a single large annual draw for StrataSphere never actually matched when the corporation's own account has funds available. This pointed at the same fix as the PAD-cap problem: bill monthly, always, regardless of plan.

**What was decided, with exact numbers:** both `billing_interval` values (`monthly` and `annual`) now bill in equal monthly installments via an ordinary recurring Stripe Subscription (`interval = month`) — they no longer differ in billing mechanics, only in rate and commitment:
- **Monthly:** $99/mo base + $2.49/unit/mo — the existing full rate, unchanged. Cancel anytime, no term.
- **Annual:** **$82.50/mo base + $2.08/unit/mo** — the monthly rate discounted to 10/12 ($82.50 = $99 × 10/12 exactly; $2.08 is $2.49 × 10/12 = $2.075, rounded up to the nearest cent since Stripe unit prices are whole-cent). This realizes the existing "two months free" annual discount as an even monthly reduction rather than two literally-unbilled months — same total annual economics, different shape. **The corporation cannot cancel — and there's nothing to refund — before the 12-month anniversary.** This replaces the old "no refund on mid-term deactivation, forfeits the unused portion" framing: since nothing is ever prepaid any more, there's no unused portion to forfeit; the commitment is enforced purely as a cancellation lock. **(This cancellation-lock framing was itself superseded two entries above — no lock at all, just a delayed effective date.)**

This keeps every monthly charge, on either plan, far under the PAD cap for any realistic corporation size — a corporation would need roughly **1,165 units** before a single monthly installment even approached $3,000 — resolving PAD viability for annual billing without a unit-count cap, installment-splitting logic, or restricting PAD to monthly-only plans.

**What's still open, flagged rather than designed here:** the 12-month commitment needs *some* enforcement mechanism, since an ordinary recurring Stripe Subscription is cancellable by default and nothing about a monthly-cadence Price alone creates a term lock — whether that's a Stripe subscription schedule with a minimum commitment, or a simpler application-level check that just refuses the "cancel" action in the UI/API before the anniversary (new doc01 §7 item 29 / doc03 Open Questions item 17). **(Resolved two entries above.)** Also still open, though now substantially simpler than it was: how a mid-annual-term unit-count change (phased developments) lands — with no large prepaid amount to prorate any more, it narrows to "does a quantity increase apply from the next installment, or wait for renewal" (doc01 §7 item 25, updated).

**What changed:**
- **doc01 (`01-identity-multitenancy-data-model.md`) §4b** — the "Billing interval" paragraph rewritten in full: the PAD-cap and trust-account-cash-flow reasoning, the new $82.50/$2.08 annual pricing, the cancellation-lock replacing the old refund framing, the ~1,165-unit PAD-safety margin, and the still-open 12-month-lock enforcement mechanism. **§7** — item 25 updated to reflect the simplified (not fully resolved) proration question; new item 29 tracks the cancellation-lock enforcement mechanism.
- **doc03 (`03-user-journey.md`) Stage 6** — the subscription flow diagram rewritten with the new per-plan pricing and the monthly-for-both-plans billing cadence, plus a paragraph cross-referencing doc01 §4b for the full reasoning. **Stage 8** — the admin-cancellation bullet now notes the annual-plan exception (can't cancel before the anniversary). **Open questions** — item 7 updated to match doc01 §7 item 25's revision; new item 17 mirrors doc01 §7 item 29; a new closing paragraph records this session's resolution in the same append-only style as the rest of that section's history.
- **No app/Stripe code changed yet** — this is the design correction ahead of implementation. The Stripe "Canadian pre-authorized debits" payment method itself was separately enabled in the dashboard this session (unrelated mechanical step, not a design decision, not otherwise logged here). **(App/Stripe code is now built — see the top entry.)**
- **This log** — "Consistency status" not otherwise touched this pass; the annual-billing pricing numbers above are now the source of truth and supersede the flat $99/$2.49-for-both-plans figures that appear in any older context outside these two docs (e.g. earlier chat discussion) — nothing else in the five design docs referenced the old annual lump-sum mechanic directly, so no further doc needed updating.

---

## 2026-09-30 (morning) — Mailtrap Send Email Hook wired end-to-end: real signup email delivered, confirm link works, session verified

**Context:** continuing straight from the "coming soon" gate entry below. Mailtrap's domain verification for `stratacouncil.ca` was already complete (4 DNS records, all Verified). This entry covers building and actually getting working the Supabase Auth → Mailtrap pipeline specified in doc04 §7a, closing that section's "not yet started" status — and four separate real bugs hit and fixed along the way before an end-to-end test (signup → real inbox → click link → verified session) actually succeeded.

**What was built (`app.stratacouncil.ca` repo):**
- **`lib/email/mailtrap.ts`** (new) — thin wrapper around Mailtrap's Sending API (`POST https://send.api.mailtrap.io/api/send`), one `fetch()` call, no SDK — deliberate, since a new npm dependency's resolution can't be verified in this sandbox (persistent `registry.npmjs.org` 403, unchanged all session). Reads `MAILTRAP_API_TOKEN` and `MAILTRAP_SENDER_EMAIL` from the environment.
- **`lib/email/templates.ts`** (new) — plain, on-brand HTML/text templates for the auth emails Supabase triggers: `magicLinkEmail` (covers both signup and sign-in, since `sendOtp()` uses the same magiclink flow for both), `emailChangeConfirmationEmail`, and a `genericAuthEmail` fallback for any other Supabase auth email type.
- **`lib/auth/verify-supabase-webhook.ts`** (new) — verifies the signature Supabase puts on Send Email Hook calls, hand-rolled with Web Crypto (HMAC-SHA256) rather than a library, same dependency-avoidance reasoning as above. Implements the Standard Webhooks (Svix) scheme: `webhook-id`/`webhook-timestamp`/`webhook-signature` headers, signed content `${id}.${timestamp}.${rawBody}`, replay-tolerance window.
- **`app/api/auth/send-email-hook/route.ts`** (new) — the Route Handler Supabase's hook actually calls: verifies the signature, parses the payload, selects a template by `email_action_type`, builds the confirm link, sends via `sendTransactionalEmail()`.
- **Mailtrap account:** sender address chosen as **`noreply@stratacouncil.ca`**; an API token scoped narrowly to **Admin on the `stratacouncil.ca` domain only** (not Account/Templates/Campaigns/Sandbox), set as `MAILTRAP_API_TOKEN` in Vercel (`app-stratacouncil-ca`, Production + Preview), alongside `MAILTRAP_SENDER_EMAIL`.
- **Supabase Auth "Send Email" hook** created (Authentication → Hooks → Send Email hook → HTTPS), pointed at `https://app.stratacouncil.ca/api/auth/send-email-hook`; its generated signing secret set as `SUPABASE_WEBHOOK_SECRET` in Vercel.

**Four real bugs found and fixed while getting this actually working, in the order hit:**

1. **Supabase's default email rate limit (2 emails/hour) blocked testing, even with the custom hook configured.** This is Supabase's own built-in throttle on its shared email sending, and it's enforced on top of the hook, not bypassed by having one — a failed hook attempt still counted against it. Fixed in the dashboard (Authentication → Rate Limits → "Rate limit for sending emails," raised from `2` to `1000`), since real sending now goes through Mailtrap's own (much higher) limits, not Supabase's shared default provider.

2. **`middleware.ts`'s auth gate was redirecting Supabase's webhook call to `/login`, which only handles GET — producing a 405.** The existing route-protection middleware (built earlier this session for the app itself) redirects any request without a user session to `/login`, and its matcher never excluded `/api/*`. Supabase's webhook call carries no session cookie, so it got redirected, and `/login` being a GET-only page turned that redirect into a 405 for Supabase's POST. Fixed by excluding `/api` from the middleware's matcher entirely — API routes authenticate themselves (a session cookie, this hook's own signature check, or a service-role key), not via this gate.

3. **A TypeScript build error** — `crypto.subtle.importKey`/`sign` rejected a `Uint8Array<ArrayBufferLike>` where newer `lib.dom.d.ts` wants a more specific `BufferSource` generic. This had never been caught before because this sandbox can't run `npm install`/`tsc` itself (same persistent registry 403) — Vercel's own build is the only real type-check, and this was the first time the new webhook-verification code went through it. Fixed with `as BufferSource` casts at both Web Crypto call sites.

4. **Supabase's dashboard shows the hook's signing secret as `v1,whsec_<base64>`, not bare `whsec_<base64>`** — the `v1,` is Supabase's own secret-rotation versioning prefix (it supports multiple space-separated secrets). The verifier originally expected the bare `whsec_` form and rejected the real value with "Hook requires authorization token." Fixed by making `verify-supabase-webhook.ts` strip any `vN,` prefix from each space-separated secret entry before use, and check a candidate signature against all configured secrets — also makes future secret rotation (adding a second `v2,whsec_...` secret without immediately invalidating the first) work with no code change.

**A fifth issue, caught only after the first real end-to-end send succeeded (the four fixes above got an email delivered from `noreply@stratacouncil.ca`, but the link inside it was broken):**

5. **The confirm link pointed at Supabase's own `*.supabase.co` project domain instead of `app.stratacouncil.ca`, even after setting Supabase Auth's Site URL correctly.** The Route Handler had built the link from `email_data.site_url`, the field Supabase's hook payload documents for exactly this purpose — but that field did not reflect the dashboard's configured Site URL in practice, it kept coming through as the Supabase project's own API host, sending clicks to Supabase's bare API gateway (`{"message":"No API key found in request", ...}` — Supabase's generic unmatched-route response, not anything from our code). Fixed by not trusting that payload field at all: `route.ts` now builds the confirm link from a hardcoded/env-overridable **`NEXT_PUBLIC_APP_URL`** (defaulting to `https://app.stratacouncil.ca` in code) instead of `email_data.site_url`. Also separately corrected Supabase Auth's own Site URL/Redirect URLs settings to point at `app.stratacouncil.ca` (was still on the old `.vercel.app` URL) — worth having right regardless, but not what actually fixed the link, which is the reason this is recorded as its own numbered fix rather than folded into "misconfigured Site URL."

**End-to-end test succeeded after fix 5:** signed up with a real account → "Check your email" screen → email arrived from `noreply@stratacouncil.ca` within seconds, correctly branded → clicked "Sign in" → landed on `app.stratacouncil.ca`, session verified, signed in.

**Also fixed in passing, deferred item closed out:** the long-standing "magic links redirect to localhost" issue flagged in earlier entries is resolved as a side effect of the Site URL correction in fix 5 above — Supabase Auth's Site URL and Redirect URLs (`https://app.stratacouncil.ca/**`) are now both set to the real production domain.

**Synced to the user's Mac** via device-bridge across several rounds (new files, then each fix) — commit/push handed to the user as the standing Terminal-command workflow, one command per fix batch rather than holding everything for one giant commit, since each fix needed its own Vercel build to actually verify. `.env.local.example`'s documentation update for the four new environment variables was written but couldn't sync — the device-bridge blocks writes to `.env*` filenames as a blanket safety rule even for a values-free template; the snippet was given to the user directly to paste in by hand if wanted, not blocking on it since it's documentation only, not behavior.

---

## 2026-09-30 (early morning, cont'd again) — Marketing site gated behind a temporary "coming soon" holding page

**Context:** with `stratacouncil.ca` now live on the real domain (entry above), the user flagged that the marketing site itself still has placeholder art and some non-working links, and asked to hide it behind a coming-soon page until it's closer to final — without touching `app.stratacouncil.ca`.

**Built as a purely additive, fully reversible gate, not a rewrite of the existing site.** Two new files in `stratacouncil-marketing`, nothing existing modified except appending a few CSS rules:
- **`app/coming-soon/page.tsx`** (new) — a plain holding page: logo mark, "Something's coming," one line of copy, a support-email contact line. Uses the site's existing design tokens and `Logo` component, `robots: { index: false, follow: false }` in its metadata so it doesn't get indexed while it's temporary.
- **`middleware.ts`** (new — this repo had none before) — redirects every request to `/coming-soon` except the coming-soon page itself and Next's own static assets (`_next/static`, `_next/image`, favicon/icon files, image extensions). The homepage, `/privacy`, `/terms`, and everything else still exist, still build, and still work at their real URLs — they're just not reachable from a cold visit right now.
- **`app/globals.css`** — one new block of `.coming-soon*` rules appended at the end, reusing existing tokens (`--paper`, `--ink`, `--accent`, `--muted`); nothing else in the file touched.

**To take the gate down once the real site is ready:** delete `middleware.ts` and push. Nothing else needs to change — this was designed specifically so reverting is a one-file deletion, not an un-doing of any content work.

**Synced to the user's Mac** via device-bridge (3 files) — commit/push handed to the user as the standing Terminal-command workflow (doc00, earlier entry). `npm run build` still unverified in this session (persistent `registry.npmjs.org` 403) — this is a small enough, well-isolated change (one new page, one new middleware file, additive CSS) that the risk is low, but worth confirming the Vercel build succeeds same as any other push.

---

## 2026-09-30 (early morning, cont'd) — stratacouncil.ca is live: Privacy Policy and Terms & Conditions rewritten in full, DNS moved from GoDaddy to Cloudflare, both Vercel projects wired to the real domain

**Context:** continuing straight from the infrastructure-stood-up entry below. The user supplied full rewrites of both the Privacy Policy and the Terms & Conditions (pasted/attached text, not drafted by Claude this pass — Claude's job was converting each into the site's existing JSX/typography conventions and shipping it), then moved on to the DNS cutover that was deferred from earlier in that same session.

**Privacy Policy and Terms & Conditions — content replaced, not merely edited.** Both `stratacouncil-marketing/app/privacy/page.tsx` and `.../app/terms/page.tsx` had their entire `<article className="legal">` body replaced with JSX conversions of the user's supplied rewrites — the site's header/nav/footer chrome, `EFFECTIVE_DATE` pattern, and typographic entity conventions (`&ldquo;`/`&rdquo;`/`&rsquo;`/`&mdash;`, `<em>` around statute names) were preserved and reused, not redesigned. Both pages' old "before publishing" placeholder banners are gone — the new text has no unresolved placeholders, effective date is a real value (September 29, 2026) in both. Cross-links between the two documents (Terms → Privacy in §2/§7/§8/§12/§14/§21, Privacy → Terms not added since the user's Privacy rewrite didn't reference it) preserved via `<Link>`.

**Flagged to the user, not silently carried over:** the new Terms rewrite drops two things the previous draft explicitly called out for legal review — the §7-equivalent placeholder warning about the future aggregate-data licensing business line (doc00's 2026-09-29 entry, "Terms & Conditions — §7 rewritten," and the entry above it), and the old §5's "no grace period" language on failed payments, now just "we may suspend." The new §19 liability-cap section is the same kind of clause worth a lawyer's pass before real subscription revenue starts, per the same reasoning the old placeholder banner gave. None of this blocked shipping — the user's rewrite is now live — but it's flagged here since the safety net that used to make these gaps visible in the file itself (the placeholder banner) is gone now that the page reads as finished.

**Not yet reconciled against doc00/doc01/doc02/doc04's own descriptions of what the Privacy Policy and Terms say** — the new text is closer to a generic SaaS-terms template (eligibility, subscriptions, acceptable use, IP, indemnification, limitation of liability, governing law) than the earlier StrataCouncil-specific draft was, and doesn't repeat some specifics the design docs treat as settled and previously appeared in the legal pages themselves: the CASL marketing-opt-in mechanism (doc01 §2, still real and live in `sendOtp()`), the PIPA/PIPEDA ten-principles structure the Privacy Policy was previously organized around (doc00's 2026-09-29 "cont'd again" entry), the specific named subprocessors (Mailtrap/Voyage AI/Anthropic/Supabase/Stripe/Vercel/Cloudflare — the new Privacy rewrite speaks in categories, "cloud hosting," "artificial intelligence," rather than naming vendors), and the aggregate/de-identified-data disclosure's re-identification-risk caveat (doc00 flagged this as unresolved and worth more than a redaction checklist once it's real revenue). None of this is a defect in what the user supplied — it's their call how the pages read — just recorded here so a future pass reconciling the design docs against the live site doesn't assume the old structure is still what's published.

**DNS: stratacouncil.ca moved from GoDaddy's default nameservers to Cloudflare, then wired to both Vercel projects.** Registrar (GoDaddy) stays the domain registrar; Cloudflare now hosts DNS. Sequence: added the domain to the user's existing Cloudflare account (Free plan) → copied Cloudflare's two assigned nameservers → user changed GoDaddy's nameservers from default to Custom, pointing at Cloudflare → confirmed Active. Then, per subdomain:
- **`app.stratacouncil.ca`** (the `app-stratacouncil-ca` Vercel project) — one CNAME (`app` → Vercel's assigned `*.vercel-dns-017.com` target), Proxy status set to **DNS only** (grey cloud, not Cloudflare's orange proxy) deliberately, so Vercel's own edge/SSL handling isn't sitting behind a second proxy layer. Valid Configuration on first try.
- **`stratacouncil.ca`** root + **`www.stratacouncil.ca`** (the `stratacouncil-marketing` Vercel project) — Vercel's "Add Domains" dialog defaulted to "Redirect apex domains to www," so the root 308-redirects to `www`, which serves the actual deployment. Two CNAMEs needed (Cloudflare supports CNAME-flattening at the apex, so no A record required): `@` and `www`, both to the same `*.vercel-dns-017.com` target, both DNS only.

**A real snag, not anticipated:** Cloudflare's initial domain scan imported GoDaddy's old parked-domain records automatically — two `A` records at the root (`15.197.148.33`, `3.33.130.190`, both Proxied) and a `www` CNAME pointing back at the bare root (also Proxied) — and Cloudflare refuses to save a CNAME alongside an existing A/CNAME on the same name, so the first save attempt for the root CNAME failed with a conflict error. Resolved by deleting both stale A records and the stale `www` CNAME before re-adding the two correct records. Also found and removed `_domainconnect.stratacouncil.ca` (a GoDaddy dashboard-integration CNAME, harmless clutter, not required for anything) while cleaning up. **Deliberately left alone:** `_dmarc.stratacouncil.ca` (a real DMARC policy TXT record) — flagged to the user as worth keeping intact for when Mailtrap starts sending mail from this domain, not touched.

**End state:** both `stratacouncil.ca` (→ marketing site) and `app.stratacouncil.ca` (→ the app) show Valid Configuration in Vercel and are live on the real domain, no more `.vercel.app` placeholder URLs for either deploy. The still-deferred magic-link-redirects-to-localhost bug (Supabase Auth dashboard Site URL/Redirect URLs, flagged in the entry below) becomes more pressing now that there's a real production domain to point those settings at — worth returning to before real users sign up, not yet done.

**Not yet started:** Mailtrap and Stripe, next in the original GitHub → Vercel → Cloudflare → Mailtrap → Stripe sequencing.

---

## 2026-09-30 (early morning) — Infrastructure stood up: GitHub repos public and pushed, Vercel project created and deployed, first two real build errors caught and fixed; direct Terminal `git` commands adopted as the standing deploy workflow

**Context:** with docs, auth, and legal pages all caught up, the user stepped back and asked the practical question: nothing was actually deployed yet — no Vercel, no Cloudflare, no Mailtrap, no Stripe, just the Supabase DB and empty GitHub repos. This entry covers the session that took `app.stratacouncil.ca` from "code exists locally" to "live on Vercel, building successfully."

**GitHub: repos populated and pushed.** Both `app.stratacouncil.ca` and `stratacouncil-marketing` existed on GitHub as empty repos (README only) under the `StrataCouncil` org. A GitHub Desktop walkthrough to push the real project files went sideways on the user's Mac — a rename-then-clone attempt left three copies of the app repo scattered across two folders (a stray default `~/Documents/GitHub/app.stratacouncil.ca` clone GitHub Desktop created on its own, nested one level deep with a second accidental clone inside itself, plus a files-only copy with no `.git` at all sitting where the real repo should have been). Diagnosed by listing the Mac's actual folder contents directly via the device-bridge file tools rather than guessing from the user's description — the real repo, full git history intact, was sitting untouched at `app.stratacouncil.ca-old`. Fixed by deleting the two broken clone attempts, renaming `-old` back to the real path, adding it to GitHub Desktop as an existing local repository (skipping the clone/copy dance entirely), and pushing directly to a remote emptied out first (deleting the placeholder README on GitHub via the web UI) so there was no merge/unrelated-histories step to navigate. Same clean "Add Local Repository" flow used for `stratacouncil-marketing` afterward with no issues.

**Vercel: both repos are private, under the `StrataCouncil` GitHub org — Vercel's free Hobby plan can't import a private org repo, only a private personal-account repo.** Presented three ways through this (upgrade to Pro, transfer the repos to the user's personal GitHub account, or make them public); **the user chose to make both repos public for now**, explicitly deferring the Pro-plan upgrade until there's paying revenue. Flagged and accepted: this exposes application source code, not secrets (`.env.local` is gitignored and was never committed) — a reversible decision, not a security incident.

**First deploy attempt caught two real, previously-unverified TypeScript errors** — this codebase had never been through a real `next build()` (which runs `tsc`) before today, only ever run via `next dev`, which doesn't type-check as strictly:
1. `components/StratasphereChat.tsx` — `useState(conversations[0]?.id)` let TypeScript infer the state as plain `string`, so the "New chat" button's `setActiveId(undefined)` failed to compile. Fixed with an explicit `useState<string | undefined>(...)` annotation.
2. `lib/placeholder-data.ts` — two `Corporation` mock entries (`bcs-2210`, `bcs-5599`) had a stray `jurisdictionLevel: "provincial"` field copy-pasted in from the unrelated `KnowledgeResource` type, which doesn't exist on `Corporation`. Fixed by deleting the two stray lines.

A full manual audit (this sandbox can't run `npm install`/`tsc` — same persistent `registry.npmjs.org` 403 blocking this session all along — so a subagent read every `.ts`/`.tsx` file under `app/`, `components/`, and `lib/` by hand, cross-checking every object literal against its declared type and every `useState`/prop usage) found nothing else in the same category. Both fixes synced to the user's Mac via device-bridge.

**Vercel project configuration, for the record:** `app-stratacouncil-ca`, under the `Trickfilm` team (Hobby plan), Next.js preset auto-detected, root directory `./`. Four environment variables set, scoped to **Production and Preview** (not Development — that scope is only for local `vercel env pull`, and local dev already reads `.env.local` directly): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MFA_BACKUP_SESSION_SECRET` — closing out the last-outstanding item from the MFA build (see earlier entries). One Supabase project exists today, so Production and Preview correctly share the same values; doc04 §10's future dev/prod Supabase split is still just that, future.

**New standing workflow adopted for getting fixes from this session onto the user's Mac and deployed, replacing GitHub Desktop point-and-click:** this cloud session has no shell access on the user's Mac (confirmed: no `device_bash` tool in this environment, only file list/stage/commit) and no authenticated GitHub access of its own (confirmed: `gh auth status` reports an invalid token, `gh api user` returns "No linked GitHub account" even against now-public repos) — so it cannot push commits directly under any circumstance. The workable pattern, and the one to use going forward: Claude edits files and syncs them straight into the real project folder on the user's Mac via the device-bridge (`device_commit_files`), then hands the user a single ready-to-paste Terminal command that stages, commits, and pushes everything in one shot:

```
cd ~/Documents/StrataCouncil/app.stratacouncil.ca && git add -A && git commit -m "<message>" && git push
```

(same shape as the working pattern already used for the reference product's own deploys, adapted — no branch checkout needed since this repo only has `main`, and no file-copy step needed since the fix already lands directly in the project folder rather than in Downloads). This replaces the earlier GitHub Desktop walkthrough as the default: one paste instead of switching apps, finding the changed-files list, typing a commit summary, and clicking through Commit/Push by hand. **Batch fixes before asking for a commit** — when multiple files need fixing (e.g. hunting down build errors), Claude finds and fixes everything it can in one pass and syncs it all before handing over one commit command, rather than sending the user back to Terminal for every single file.

**Status at entry's end:** `app.stratacouncil.ca`'s first production build failed twice (the two errors above), fixes for both are synced to the Mac, and the commit/push command above is queued for the user to run. Once that build succeeds, `stratacouncil-marketing` still needs to be imported into Vercel the same way (not yet started). Cloudflare, Mailtrap, and Stripe remain fully untouched, per the sequencing agreed earlier this session (GitHub → Vercel → Cloudflare → Mailtrap → Stripe).

---

## 2026-09-29 (night, cont'd yet again, second reversal same night) — 2FA enforcement turned off entirely: magic-link-only sign-in for now, revisit with SMS/Twilio once there's a paying customer

**Context:** immediately after the SMS→TOTP factor-type reversal (entry directly below), the user stepped back and reversed the bigger question — not which 2FA method, but whether to enforce 2FA at all right now. Explicit instruction: keep the TOTP implementation intact, don't delete it, just stop enforcing it.

**What was decided:** `middleware.ts`'s MFA gate is commented out, not removed. Every account — new signups and existing ones — now proceeds straight from a verified magic-link session to the dashboard, with no redirect to `/auth/mfa/enroll` or `/auth/mfa/challenge` regardless of factor status. The entire TOTP build from the immediately-preceding entry (enrollment/challenge screens, `lib/auth/mfa.ts`, the `mfa_backup_codes` table, the signed-cookie backup-session mechanism) stays in the codebase untouched and remains reachable by visiting `/auth/mfa/enroll` directly — re-enabling enforcement later is uncommenting the gate block, not rebuilding anything. The stated future path is explicitly **not** "turn TOTP back on" but "revisit 2FA once there's a paying customer, most likely via SMS/Twilio" — reviving the parked Twilio work (§7b) rather than the TOTP path, since the original audience-usability reasoning that favored SMS over TOTP was never wrong, only overridden by Supabase's Pro-plan cost gate at the moment TOTP was adopted.

**What changed, code:**
- **`middleware.ts`** — removed the `MFA_BACKUP_COOKIE_NAME`/`verifyMfaBackupCookieValue` import and the `MFA_GATE_EXEMPT_PATHS`/`isMfaGateExemptPath` helper; the actual MFA-gate `if` block is replaced with a plain passthrough comment and `return response;`. A long doc comment above `middleware()` explains the reversal in full — why it's off, what's preserved, and how to turn it back on — and reproduces the disabled gate logic verbatim in a comment block so re-enabling it later doesn't require reconstructing it from memory or from this log.
- Synced to the user's Mac via device-bridge.
- No other app code touched — the enrollment/challenge pages, `lib/auth/mfa.ts`, `lib/auth/mfa-session.ts`, and the `mfa_backup_codes` migration are all untouched and still fully functional for anyone who visits the enrollment screen voluntarily.

**What changed, docs:**
- **doc01 (`01-identity-multitenancy-data-model.md`) §1** — signup description updated: no mandatory 2FA enrollment mentioned any more. **§2** — the 2FA section rewritten with the enforcement-off reversal stated up front, the full TOTP mechanism preserved below it explicitly labeled as "how it works if and when re-enabled," and the reasoning for turning enforcement off (zero-revenue funnel, audience unlikely to complete TOTP unassisted, no paying corporation's governance authority yet at stake) laid out plainly as a temporary, revenue-gated trade-off, not a retraction of the original compromise-window security reasoning. **§7** — item 14 re-resolved to point at the enforcement-off state; **new item 28** replaces the old TOTP-specific revisit question with the broader enforcement-revisit trigger (paying customers, SMS/Twilio as the likely next factor).
- **doc03 (`03-user-journey.md`) Stage 2** — signup flow diagram simplified back to ending at the dashboard, no 2FA step. **Stage 2a** — retitled "Two-factor authentication: built, working, not currently enforced," rewritten to describe the mechanism as fully preserved but dormant, with the enforcement-off reasoning stated up front rather than buried. **Stage 4** — the 2FA note in the invite-flow description updated to reflect that a brand-new invitee no longer sees an enrollment screen either. **Open questions** — new closing entry recording this reversal in the same append-only style as the rest of that section's history.
- **doc04 (`04-architecture-and-stack.md`) §3** — Auth bullet updated to state TOTP is built but not enforced, and that Twilio/SMS remain parked with no current cross-border flow either way. **§7b** — rewritten in full, keeping the entire SMS→TOTP→enforcement-off history intact rather than overwriting it, since the reasoning at each step has ongoing reference value. **§9** summary table and **§11** feature-test note updated (the MFA-gate test now expects a no-op — confirms no redirect happens — with the enrollment/verification screens getting their own separate direct tests for the voluntary path). **§12** — item 7 marked superseded twice over; item 28 rewritten as the single enforcement-revisit trigger; item 29 folded into item 28.
- **This log** — "Consistency status" below updated to reflect the current state: 2FA is fully built, fully working, and fully disabled by choice, with one single, clearly-stated trigger (paying customers) for reconsidering it, tracked in one place (doc01 §7 item 28) rather than scattered across per-doc open-questions sections the way earlier reversals had left them.

**Not resolved, still outstanding, unrelated to this reversal:** `MFA_BACKUP_SESSION_SECRET` still needs generating and setting in both Vercel environments. **(Resolved in the entry above — set in Vercel's Production and Preview environments during the deploy session.)**

**Also not yet revisited:** `stratacouncil-marketing/app/privacy/page.tsx` still describes 2FA/TOTP in terms that assume it's active at signup. **(Resolved two entries below — the language was cleaned up the same night, separately from this deploy session.)**

---

## 2026-09-29 (night, cont'd yet again, reversal) — MFA factor switched back to TOTP; SMS/Twilio parked pending revenue

**Context:** mid-way through the live Twilio Console + Supabase configuration walkthrough, the user hit a hard blocker: Supabase gates its native phone-provider configuration behind a paid **Pro plan ($25/mo)** — free-tier Supabase projects can't configure any SMS provider at all, Twilio included. With no revenue yet, the user asked to switch to TOTP for now and revisit SMS later.

**What was decided:** MFA factor type reversed from SMS/phone back to TOTP, effective immediately — a cost-driven reversal, not a retraction of the audience-usability reasoning that originally picked SMS. Flagged as a new open question (doc01 §2 item 28, doc04 §12 item 29) to revisit once there's revenue. **(Superseded the same night — enforcement itself was then turned off entirely.)**

**What changed, code:** `lib/auth/mfa.ts`'s phone-enrollment functions replaced with TOTP equivalents calling `supabase.auth.mfa.enroll({ factorType: 'totp', ... })`; enrollment/challenge screens re-worded for an authenticator app (QR code + manual secret) instead of a phone; `middleware.ts`'s factor check switched from `factorsData?.phone` to `factorsData?.totp`; new `.totp-setup*` CSS classes. All synced to the user's Mac.

**What changed, docs:** doc01 §2, doc03 Stage 2/2a, doc04 §3/§7b/§9/§11/§12 all updated to document the TOTP switch, preserving the SMS reasoning as historical context. The marketing Privacy Policy's Twilio cross-border disclosure was reverted (SMS never shipped to production).

**Not resolved, still outstanding:** `MFA_BACKUP_SESSION_SECRET` still needs generating and setting. **(Resolved in the top entry.)**

---

## 2026-09-29 (night, cont'd once more again, follow-up) — Canadian SMS-provider alternative researched and declined; staying with Twilio

**Context:** immediately after Twilio was confirmed, the user asked whether a Canadian equivalent exists.

**What was found:** Supabase's native phone-MFA provider dropdown only supports Twilio, MessageBird, Vonage, TextLocal — none Canadian. A custom Send SMS Hook could route through any provider but means building/maintaining it. The Canadian developer-facing SMS API market is thin — no Canadian-headquartered provider found with Twilio's reliability/documentation/delivery track record, and a "Canadian" reseller doesn't guarantee an all-Canadian delivery path. Presented three options via AskUserQuestion; **user chose: stick with Twilio.** No doc changes needed.

---

## 2026-09-29 (night, cont'd once more again) — SMS provider resolved: Twilio account created, doc04 §7b/§12 closed out, Privacy Policy's SMS-provider placeholder filled in

**Context:** the user confirmed a Twilio account was created, closing doc04 §12's last blocking open question. No app code needed to change since `lib/auth/mfa.ts` was already provider-agnostic.

**What was resolved:** Provider confirmed as Twilio; remaining work is Supabase-dashboard configuration (provision a number/Messaging Service, enable the Phone provider with Twilio credentials, confirm the Phone factor type is enabled) — steps written into doc04 §7b. A real gap caught: Twilio is itself a cross-border data flow, not Canadian-region-pinned — added to doc04 §3 and the Privacy Policy's cross-border-transfers paragraph and service-providers list (replacing the `[SMS provider — to be confirmed]` placeholder). `MFA_BACKUP_SESSION_SECRET` flagged as a separate, still-unresolved item.

**What changed:** doc04 §3, §7b (retitled, rewritten), §9, §11, §12 item 7 (resolved); `stratacouncil-marketing/app/privacy/page.tsx` placeholder replaced and cross-border paragraph extended. Synced to the user's Mac.

---

## 2026-09-29 (night, cont'd yet again, auth build) — Mandatory SMS 2FA implemented: enrollment/challenge screens, middleware gate, backup-code cookie mechanism

**Context:** with the design fully specified, the user said "I think we can build the auth process now." Scoped to the core enrollment/challenge flow only; Account Settings wiring (change phone number, regenerate backup codes) stays deferred. Mailtrap corrected as email-only, not a phone-MFA provider — build is provider-agnostic (calls only Supabase's own `auth.mfa` API).

**What was built (`app.stratacouncil.ca` repo):**
- **`supabase/migrations/0007_mfa_backup_codes.sql`** — `mfa_backup_codes` table plus RLS (`auth.uid() = user_id`, full stop).
- **`lib/auth/mfa-session.ts`** — a real implementation-time gap: Supabase's MFA model has no "backup code" factor type, so there's no supported way for a backup-code verification to report `aal2`. Resolved with a custom HMAC-SHA256-signed httpOnly cookie (`sc_mfa_backup`), built on Web Crypto, that the middleware gate accepts as an alternative to real Supabase aal2. Requires **`MFA_BACKUP_SESSION_SECRET`**. **(Resolved in the top entry.)**
- **`lib/auth/mfa.ts`** — `startPhoneEnrollment`, `verifyPhoneEnrollment` (also generates 10 backup codes), `startPhoneChallenge`, `verifyPhoneChallenge`, `verifyBackupCode`.
- **`app/auth/mfa/enroll/page.tsx`** — three-step flow (phone → code → backup codes), shown once per account.
- **`app/auth/mfa/challenge/page.tsx`** — returning-session verification screen with a backup-code fallback toggle.
- **`middleware.ts`** — extended with the MFA gate: zero verified phone factors → enroll; enrolled but session not cleared (real aal2 or signed cookie) → challenge.
- **`lib/auth/actions.ts`** — `signOut()` also clears the backup-code cookie.
- **`globals.css`** — new `.link-button`, `.backup-codes`/`.backup-codes__actions`, print rule for backup codes.
- **doc01 §2** — new subsection documenting the signed-cookie mechanism.

**Not done, flagged as follow-ups:** Account Settings wiring (task #31) stays deferred. `MFA_BACKUP_SESSION_SECRET` not yet set.

---

## 2026-09-29 (night, cont'd once more still) — Security/trust section added to the marketing site; corrected against the reference product's copy where it didn't hold; hosting region confirmed

**Context:** the user pasted the reference product's own "Enterprise-grade" security section copy and asked for it adapted onto the StrataCouncil.ca marketing site.

**Real conflicts caught before publishing, not silently carried over:**
- the reference product's copy claims Canada-exclusive hosting, "no cross-border transfers," and ISO 27001 certification. StrataSphere's AI features (Anthropic, Voyage AI) do cross borders, and neither StrataCouncil.ca nor its infrastructure had been confirmed to hold any certification. Flagged via AskUserQuestion.
- **User's answer supplied real, confirmed facts:** production Supabase project (`stratacouncil-prod`) is on a **Canadian server region**; Supabase itself is ISO 27001 compliant as an infrastructure provider (kept distinct from "StrataCouncil.ca is certified," which isn't true); cross-border AI transfers stay disclosed; data is encrypted in transit and at rest.
- the reference product's role-based-access tile listed the reference product's own brokerage hierarchy — doc01 explicitly states this role model doesn't transfer. Replaced with the real roles: Admin, Council Officers, Strata Managers, General Members.
- "StrataSphere only answers from your data" overstated what's true — reworded to note cross-platform precedent and cited legislation are also used, explicitly labeled as such.
- Added one tile the reference product's copy doesn't have: mandatory SMS 2FA at every signup. **(Stale as of the later enforcement-off reversal; the homepage was later rewritten without this section entirely.)**

**What changed:** `stratacouncil-marketing/app/page.tsx` — new `securityFeatures` section (7 tiles) inserted. `globals.css` — one new rule for card heading contrast on the dark trust band. `privacy/page.tsx` — §5 placeholder replaced with confirmed hosting facts. doc04 §3 — new paragraph on confirmed Canadian hosting region and the ISO 27001 distinction. Synced to the user's Mac.

---

## Project state at a glance

Five design docs, in dependency order:

1. **`01-identity-multitenancy-data-model.md`** — foundation: identity, multi-tenancy, corporation creation/join flows, roles, subscriptions, RLS shape. Everything else builds on this.
2. **`02-stratasphere-ai-advisor.md`** — the AI advisor subsystem: knowledge base structure, retrieval priority, cardinal rules, system prompts. Builds on 01.
3. **`03-user-journey.md`** — the end-to-end user journey, marketing → education → corporation → StrataSphere, stage by stage. Builds on 01 and 02.
4. **`04-architecture-and-stack.md`** — how it all actually gets built and hosted (two deploys, Supabase, Inngest, Anthropic API, Stripe, testing). Builds on 01–03.
5. **`05-brand-design-system.md`** — visual language: color tokens, typography, component rules, and how two separate repos stay visually consistent.

All five are marked **"Status: Draft for review"** — none are final yet. Each doc carries its own "Open questions" section at the bottom; that's the authoritative list of what's still undecided in that doc's area, not repeated here.

**Standing house-style rules that apply across every doc, worth knowing once rather than re-deriving:**
- No emoji, anywhere — product UI, marketing copy, AI-generated content, minutes, everything (doc02 Cardinal Rules, doc04 §10, doc05 §5).
- No gradients, no drop shadows beyond a subtle elevation cue, no glassmorphism — flat, restrained visual language (doc05 §5).
- Real semantic HTML/accessible markup, not styled divs — matters for a governance tool's accessibility obligations, not just correctness (doc05 §2, §5).
- "Don't build for a problem you don't have yet" — a recurring, explicit posture (Cloudflare, doc04 §7; Inngest vs. Supabase-native, doc04 §11; token-sharing mechanism, doc05 §6) — flag future options rather than build them preemptively.
- **Nothing in the codebase, naming, or copy references the reference product** (set 2026-10-01). the reference product is reference material only — for Meeting Mode *mechanics* (agenda item types, vote-threshold math, minutes-generation sequence) — never for naming, branding, code comments, identifiers, or product copy. Everything is StrataCouncil-named throughout. (The docs themselves can still cite it as a source, as they do today.)

**Deferred until there are paying customers:**
- **Session timeouts (decided 2026-10-02).** Supabase's inactivity timeout and session time-box need the Pro plan. The recommended settings when it's adopted:
  - 7 days of inactivity
  - 30 days maximum

  Inactivity rather than a flat 7 days, so nobody is logged out mid-meeting. Until then, sessions don't expire, which is Supabase's default.
  - Revisit with the Pro upgrade, or sooner if 2FA stays off and real owner data grows.
  - The same limits could also be enforced in app code without Pro, if needed earlier.

**Before going live (hard pre-launch checklist):**
1. Create the dedicated StrataCouncil.ca Stripe account and move billing to it (decided 2026-10-02; steps in that day's entry). Do this before the first paying customer.
2. Legal review of the Terms and Privacy pages (deferred 2026-09-30), including naming Trickfilm Entertainment Inc. as the operator.

**Consistency status (updated each cleanup pass):** real Stripe subscription code is built and deployed — Checkout, webhook sync, cancellation/plan-change Server Actions, Billing Portal, the free-documents RLS migration — with all six Vercel env vars set and the Stripe webhook ("event destination") created and confirmed working; the one build-breaking TypeScript error hit along the way is fixed and deployed. A follow-up pass added a required, independently-editable billing contact email (`subscriptions.billing_email`). The Stripe Customer's `name` is pinned to the corporation's immutable strata plan number; building/legal name lives in the Customer's `description`. **All migrations through `0009` are now applied to production.** Stripe's "Successful payments" customer-email toggle is confirmed on. Mailtrap transactional email is live end-to-end. The magic-link-redirects-to-localhost issue is resolved. stratacouncil.ca is live end-to-end on Cloudflare DNS with both Vercel projects showing Valid Configuration. The live Privacy Policy and Terms & Conditions no longer match the PIPA/PIPEDA-structured, named-subprocessor draft described in earlier entries — **the user has explicitly deferred reconciling this: legal pages stay as-is until a lawyer reviews them before going live.** `MFA_BACKUP_SESSION_SECRET` is set. The mandatory-2FA design remains deliberately reversed at the enforcement level only: TOTP enrollment/challenge/backup-code/recovery is fully built and documented (doc01 §2), but `middleware.ts`'s gate is disabled — tracked as a single open item (doc01 §7 item 28) with one revisit trigger (a paying customer base). The marketing site's "coming soon" gate is deliberately staying up. StrataSphere's annual-billing mechanics were substantively revised — monthly installments instead of a lump sum, to keep every ACSS Debit charge under Stripe's CAD $3,000 per-transaction cap — and the cancellation mechanism (Stripe-native `cancel_at`/`cancel_at_period_end`, no fee) and free/permanent document repository were both resolved and are now real, deployed code. **The "mandatory SMS 2FA" marketing tile the user asked to remove turned out to already be gone** — the homepage has been substantively rewritten into a pure training/education page with no security/trust section at all; confirmed via the user's own Vercel deployments screenshot. **Corp creation (reviewed), the real council roster, and the owner/lot roster (CSV upload, per-lot edit, export) are built, merged to `main`, and live** — branch `claude/wizardly-noether-r7mkam` merged 2026-10-01, and migrations `0010` and `0011` are both applied to production (user-confirmed success, no errors). No the reference product references remain anywhere in the codebase. Known gaps carried as open threads in that entry: the Council & Roles training-visibility matrix is blocked on Education's tables (`course_completions` et al.) not existing in any migration yet; removal can't delete StrataSphere conversations until those tables exist; `documents.category` is resolved (2026-10-01) — see the top entry.

**Update, 2026-10-12:** PRs through #48 are merged; migrations through `0032` are applied to production.
- **Billing is done and tested end to end in the sandbox:** typed-in bank details with micro-deposits, bank sign-in, update to a card; PAD agreements show Type: Business. Live publishable key is set and the live Stripe account is configured. See doc01 §4b and doc04 §7 (as built 2026-10-12); the Checkout/Billing Portal description in "Consistency status" above is superseded.
- **Also live since 2026-10-05:** Overview dashboard and renamed menu, Super Admin announcements (categories; Home and/or Overview; edit/take down/show again), two admins per strata, "Subscription pending" at every gate, the assistant on phones, uniform export filenames, historic-minutes multi-upload, auto-refresh.
- **Next:** demo mode (designed in the 2026-10-12 night entry), then Council Training.
- **Still open:** training tables (placeholders on the roster and dashboard); possible BC PST on the subscription (accountant); ask Stripe whether payment-method updates can be Business PADs; pre-launch checklist above (dedicated Stripe account question, legal review).

**Update, 2026-10-01 night:** PR #5 (plan parsing, billing steps, roster cleanup, mobile Knowledge Library, migration 0018) is open, awaiting merge, the 0018 run, and `invoice.paid` enabled in Stripe.

**Update, 2026-10-01 evening:** the governance layer is built, merged and live (PRs #2–#4).
- **Migrations:** all of `0012`–`0017` are applied to production. Inngest and Voyage are wired.
- **Fixed:** the production grants bug (0016).
- **Tested:** the user ran an end-to-end test, and its fixes are live. A second clean end-to-end run is next.
- **Docs:** docs 01–04 carry as-built blocks that supersede older text (see the evening entry).
- **Still open:**
  - The training tables don't exist, so the roster's training columns and the dashboard's training cards are placeholders.
  - Decision embedding and legislation indexing aren't built.
  - OCR for scanned PDFs isn't built; they're flagged instead.
  - The `development` branch and environment from doc04 §10 still don't exist; Vercel previews per branch stand in for staging.

---

## How to pick this up cold (for a future session with no chat history)

1. Read this log's "Project state at a glance" section above for the five-doc map and cross-cutting rules, including the "Consistency status" line — that tells you whether a known-stale item is currently sitting unresolved.
2. Read the most recent dated entry for what just happened and what's mid-flight.
3. Each doc's own "Open questions" section (bottom of file) is the authoritative list of undecided items in that doc's area — check there before assuming something is settled.
4. When making a change: identify which doc(s) it touches, make the edit, then add a dated entry here in the same turn describing what changed and why — not just "updated doc03," but the reasoning, the way the entries above are written. That's what makes this log worth reading instead of re-diffing the docs.
5. If a cleanup pass finds a cross-doc inconsistency it doesn't fix immediately, say so in both places: an "Open thread, not yet acted on" paragraph in that entry, and a one-line flag in "Consistency status" above — so it can't quietly get lost between sessions.
