# Learn, Decide, Remember: design

Status: approved (2026-11-12), being built in the order of section 10.

This is the plan for reorganizing StrataCouncil.ca into three sections, moving
to the new free and paid split and the new price, rebuilding the Stratasphere
assistant as one context-aware assistant, and making it find more of a
strata's records for less money. It replaces the "one free meeting" trial.

---

## 1. Principles

These decide every edge case below.

1. **Free costs us nothing per use.** Anything that costs money each time it's
   used (AI, video, embeddings, OCR, mass email) is paid. Fixed costs that two or
   three paying stratas cover (hosting, the database, the email plan) can serve
   the free tier.
2. **Cash-flow positive from the first customer.** The price covers the worst
   realistic use of every paid feature, at every strata size.
3. **Finding the record comes first.** The worst failure, after a wrong
   answer, is a record that's on file and that Stratasphere doesn't see. No cost
   saving ships if it reduces what Stratasphere can see. The recall check
   (section 7) is a required gate.
4. **A strata's records are kept and available forever.** Unsubscribing or never
   subscribing locks the intelligence, never the records. Minutes, agendas,
   votes, and stored files stay viewable and downloadable, and are never
   deleted for lack of a subscription.
5. **Meeting Mode doesn't change.** Quorum, vote thresholds, live voting,
   conflicts, handovers, minutes, and video behave exactly as they do now. The
   only change is who may start built-in video (subscribers). Every existing
   meetings database test must pass unchanged.
6. **This is not an owner portal.** Owners never sign in. Notices may go to
   owners on the roster (for example an AGM notice), but only council members,
   managers (and their assistants), and the admins named on the Council page
   use the app. Only they use Stratasphere.
7. **Privacy as today.** Stratasphere conversations are private to the person.
   Stratasphere never reads Discussions, Council Training, or billing. PII
   stripping runs before anything leaves for Voyage or Anthropic.
8. **Assistant answers are research, never record.** Nothing the assistant says
   enters minutes, the ledger, or any official document.

---

## 2. The three sections

### Navigation

The top bar becomes three sections, plus Super Admin for Super Admins:

| Section | Holds | Price | Strata needed? | Phones |
|---|---|---|---|---|
| **Learn** | Council Training, the Library, legislation and CRT updates | Free | No | Yes |
| **Decide** | Overview, Meetings, Discussions, Council, Owners, Management, Billing | Free (some features paid, shown locked) | Yes | Desktop (as today) |
| **Remember** | Stratasphere: Ask, Documents, Decision Ledger | Paid | Yes | Ask works on phones |

- **Stratasphere** stops meaning "the strata workspace" (today's top-bar label)
  and becomes the name of the paid tier and its assistant. That matches how we
  sell it: Stratasphere is the memory.
- **The strata switcher** sits on every Decide and Remember page, as today.
  Learn belongs to the person, not a strata.
- **The floating Stratasphere button** appears on every Decide and Remember
  page. It doesn't appear in Learn ("Training is not part of the Stratasphere").
- **URLs stay where they are** (`/training`, `/strata/[corpId]/...`), with
  redirects for anything that moves. Emails already sent keep working.

Within a strata, the second-level nav is grouped by section:

- **Decide:** Overview, Meetings, Discussions, Council, Owners, Management
  (managers and admins only), Billing (billing access only).
- **Remember:** Ask, Documents, Decision Ledger.

### What each section holds

**Learn (free).**
- Council Training (`/training`) as today.
- The Library moves here from the strata's Guides tab: guides, playbooks,
  policy templates, and forms. Templates and forms become free, since they cost
  nothing per download. When the person belongs to a strata, a download is
  filled in for that strata, as today.
- Legislation and CRT updates: a later phase (section 10). The Super Admin
  writes them once, and every strata reads the same text.

**Decide (free for council business).**
- **Council meetings, unlimited:** agendas written by hand, Meeting Mode
  (attendance, quorum, motions, live voting, conflicts, handovers), minutes
  written by hand, minutes PDF and Word downloads, and agenda downloads.
  Committee meetings too.
- **Agenda attachments:** stored and viewable, but not read or indexed (no OCR,
  no embeddings, no AI).
- **Your own video link:** a new optional field on each meeting for the
  council's own Zoom, Teams, or Meet link, shown on the members' join page.
- **Discussions, unlimited.** Today only the first one is free.
- **Council, Owners, and Management,** as today.
- **Email:** meeting notices and minutes to council, invitations, and
  Discussion emails. Nothing goes to the whole owner list from the free tier.
- **Shown in Decide with a lock, part of Stratasphere:**
  - General meetings (AGMs and SGMs). These aren't built yet (`comingSoonMeetingTypes`). They'll be paid when they are.
  - Built-in video.
  - AI drafting: motion wording, and reading an uploaded agenda.

**Remember (paid: Stratasphere).**
- **Ask:** the full-page Stratasphere window (conversations, projects, pinned),
  plus the floating assistant everywhere in Decide and Remember. Unlimited.
- **Documents:** the library, uploaded, read (including OCR), indexed, and
  searchable by meaning and by exact words.
- **The Decision Ledger,** browsable for the first time (today the route is only
  a lock panel): every carried motion, filterable by year, category, and
  meeting, each linked to its minutes, and searchable.
- **Historic minutes import:** AI reads past minutes and adds their decisions to
  the ledger.

### What an unsubscribed strata sees in Remember

- **Documents:** the list stays visible. Every stored file opens and downloads,
  and the full export works. Uploading to the library, search, and Ask are
  locked. This covers stratas that cancel, and files uploaded before this change.
- **Decision Ledger:** locked. The same decisions stay visible in each meeting's
  minutes in Decide, so nothing is lost.
- **Ask:** locked. Past conversations stay saved and private. They're readable
  again on resubscribing, and the person can delete them at any time.
- **Locks explain themselves:** an admin or billing contact can subscribe from
  the lock, and everyone else can ask their admin (`RequestSubscriptionButton`,
  as today).

---

## 3. Free and paid, feature by feature

| Feature | Today | New |
|---|---|---|
| Council Training | Free | Free |
| Library guides | Free | Free (moves to Learn) |
| Library templates and forms | Paid | **Free** |
| Council meetings | 1 free, then paid | **Free, unlimited** |
| Committee meetings | 1 free, then paid | **Free, unlimited** |
| General meetings | Not built | **Paid** when built |
| Meeting Mode, live voting, conflicts | Trial or paid | **Free** |
| Minutes, written by hand | Trial or paid | **Free** |
| Built-in video | Trial or paid | **Paid** |
| Own video link | n/a | **Free** (new field) |
| Draft motion wording (AI) | Trial or paid | **Paid** |
| Read an uploaded agenda (OCR + AI) | Trial or paid | **Paid** |
| Agenda attachments | Indexed | **Free, stored only;** indexed on subscribing |
| Discussions | First free | **Free, unlimited** |
| Discussion motion drafting (AI) | Trial or paid | **Paid** |
| Documents: view and download | Free | Free |
| Documents: upload to library, read, index, search | Free (indexed) | **Paid** |
| Historic minutes import (AI) | Trial or paid | **Paid** |
| Decision Ledger | Lock panel only | **Paid** (new browse page) |
| Stratasphere assistant | Paid; 10 questions in the free meeting | **Paid, unlimited;** no free questions |
| Strata creation: reading the strata plan (AI) | Free | Free; the one exception, see section 9 |

**How this removes today's trial:**
- `launch_meeting` stops checking `free_meeting_used`. The columns stay for history.
- `has_stratasphere_access` drops its trial-meeting clause and becomes "member
  and subscribed".
- The ten free questions (`free_meeting_ai_requests_used`) end.
- Every "your free meeting" line goes: the nudges, Getting Started, the
  lifecycle emails, the billing page, the meetings page, and the marketing site.

---

## 4. Price and billing

### Three plans

| Plan | Price | For |
|---|---|---|
| **Free, forever** | $0 | Learn and Decide (section 3) |
| **Stratasphere, Monthly** | **$30 a month per strata + $3 per strata lot.** Cancel any month. | Any strata, self-serve |
| **Stratasphere, Yearly** | **$25 a month per strata + $2.50 per lot**, a 12-month commitment, billed monthly (two months free over the year). | Any strata, self-serve |
| **Enterprise** | Talk to us | Strata management companies, and stratas whose monthly charge would be over $3,000 (over 1,132 lots) |

GST (5%) on top. No cap: a strata pays its lot count. Both plans bill
monthly, so no single charge comes near Stripe's limit for one bank debit.

| Lots | Monthly | Yearly (per month) | Yearly plan, a year with GST |
|---|---|---|---|
| 6 | $48 | $40 | $504 |
| 20 | $90 | $75 | $945 |
| 45 | $165 | $137.50 | $1,733 |
| 100 | $330 | $275 | $3,465 |

- **The $2,000 a year line:** the Monthly plan passes $2,000 a year with GST at
  43 lots, the Yearly plan at 54. Above that, councils put it in the approved
  budget (the budget pack, section 10, later). We never say a subscription is
  automatically within anyone's spending limit.
- **Enterprise:** the billing page offers "Talk to us" instead of self-serve
  checkout when a plan's monthly charge, GST included, is over Stripe's $3,000
  limit on one payment (`MONTHLY_CHARGE_LIMIT`: Monthly fits up to 942 lots,
  Yearly up to 1,132), and to anyone who asks
  about several stratas. The request goes to the Super Admin console and emails
  the Super Admins. The Super Admin sets a monthly price for that strata, month
  to month or on a 12-month commitment, or marks it complimentary.
- **Lot count** comes from `strata_corporations.unit_count`, verified from the
  strata plan at Super Admin review.

### In Stripe

Two Prices per plan, both billed monthly: a flat base and a per-lot price
(`STRIPE_PRICE_MONTHLY_BASE`/`_UNIT`, `STRIPE_PRICE_ANNUAL_BASE`/`_UNIT`, and the
`STRIPE_TEST_PRICE_*` set for sandbox stratas). An Enterprise subscription gets
a monthly Price made for it, on the same product.

### Unit economics

These use measured costs from EPS9048: **$0.27 per assistant question** and
$0.14 per Meeting Mode question. Built-in video is CA$0.0047 per person per
minute (about $3 per council meeting, plus an AGM a year), and card fees are
2.9% + $0.30. "Typical" means 60 questions a month, and "heavy" means 200.

| Lots | Price | Margin, typical | Margin, heavy |
|---|---|---|---|
| 6 | $48 | 56% | Loss (−23%) |
| 20 | $90 | 75% | 33% |
| 45 | $165 | 85% | 62% |
| 100 | $330 | 90% | 79% |

The heavy-use loss on small stratas closes once section 7's caching work lands.
Section 7 targets well under $0.15 for questions after the first in a session.
If it doesn't get there, the fix is a higher base price, never reading less.
`stratasphere_usage` already records every answer's cost, so the Super Admin
strata page will show AI cost per strata per month next to what it pays.

**Fixed costs:** at least about US$45–60 a month (Supabase Pro and Vercel Pro).
One subscribing strata of about 20 lots covers them.

---

## 5. One Stratasphere assistant

### How it looks

- **A floating button,** bottom right, on every Decide and Remember page.
  - **Desktop:** it opens a panel docked on the right that pushes the page
    narrower instead of covering it.
  - **Phones:** it opens a full-height sheet.
- **Inside Meeting Mode,** the panel takes the place of today's embedded
  assistant in the right column. It never covers the runner's controls, video,
  or voting.
- **A pinned line at the top says what it's looking at,** for example "Looking
  at: March 4 council meeting, item 4, Roof replacement". A "×" clears it for a
  general question.
- **Suggested questions** appear when the conversation is empty. They're built
  from the record's type and title by templates, with no AI cost. For an agenda
  item:
  - "What have we decided about roof replacement before?"
  - "What do our bylaws say about this?"
  - "Summarize the attachments."
- **The panel's header** has "New conversation" and "Open full page".
- **Under each answer:** its sources, as clickable chips (as today), and the
  line "Research only, not part of the minutes."

### Conversations

- **Every question is saved,** whether asked from the panel, the full page, or
  Meeting Mode, in the existing `conversations` and `conversation_messages`
  tables (0019/0033). Today's Meeting Mode assistant forgets its answers; it no
  longer will.
- **The panel continues the conversation open for that page.** If none is open,
  the first question starts one. "Open full page" goes to the same conversation
  in Remember, Ask.
- **The full page** keeps what exists: recents, pinned, projects, rename, move,
  and delete. Each conversation also shows where it started ("Asked during the
  March 4 meeting, item 4"), linked back.
- **Conversations stay private to the person** (existing RLS). Sharing a project
  with council is a later phase (section 10).

### What "looking at" means

The page tells the panel what's on screen as a small reference, never as text:

| Page | Focus reference |
|---|---|
| Meeting Mode or agenda, item open | `{kind: "agenda_item", meetingId, itemId}` |
| A meeting, no item open | `{kind: "meeting", meetingId}` |
| A document | `{kind: "document", documentId}` |
| A ledger entry | `{kind: "decision", decisionId}` |
| Owners, Council, Overview | `{kind: "page", page: "owners"}` (no extra records; the profile already covers them) |
| Discussions | None. Discussions are never sent to Stratasphere. |

- **The server re-reads the record with the person's own access** (RLS) and
  refuses anything they couldn't open themselves. It never trusts text sent from
  the browser.
- **The reference is saved with the question** (new
  `conversation_messages.focus`), so reopening a conversation shows where each
  question was asked.
- **The focused record goes first and in full,** marked "THE RECORD THE PERSON
  IS LOOKING AT (highest priority)":
  - The item and its motion.
  - All its attachments (as Meeting Mode does today).
  - For a decision: its minutes.
  - For a document: the whole document.

  Search still runs across everything else as usual, so focus adds context and
  never narrows it.
- **In a live meeting,** it keeps the fast setting (effort low, 2–4 sentence
  answers) and adds "decisions made so far in this meeting", as today.

### Unlimited, with one safeguard

- **No quota for subscribed stratas.**
- **A per-person limit of 30 questions an hour** stops runaway scripts, shared
  logins, or loops. When hit, the message says when they can ask again. No real
  person should ever see it.
- `consume_stratasphere_request` is replaced by
  `stratasphere_allowed(corp)`: subscribed, council, manager, or admin, and
  under the hourly limit, counted from that person's answers in the last hour.

### For unsubscribed stratas

The button is still there. It opens a panel saying what Stratasphere does, with
one example answer drawn as a picture (no AI call), and Subscribe or "Ask your
admin". It costs nothing.

---

## 6. Who uses the app, and Stratasphere

Decided: **council members, managers (including a manager's assistants), and
the admins named on the Council page.** Owners never sign in. This is a council
tool, not an owner portal.

- **Stratasphere** (Ask, the floating assistant, Documents search, and the
  Decision Ledger) is for the same people, and only while the strata
  subscribes. Someone who leaves council or management loses access the moment
  their role ends.
- **Owners appear only as roster entries,** used for lots, entitlement, quorum
  and vote counts, and, later, notices such as AGM notices sent by council.
- **Building PR 3, I'll audit every way a person who isn't council, a manager,
  or an admin can hold a membership today** (for example an old owner invite),
  and close each one, with a database test for each. Existing memberships like
  that get a one-off script you can run.

---

## 7. Finding records, and the cost per question

### What the code does today (lib/ai/stratasphere.ts)

Every assistant question sends:
- The strata's **whole bylaws** (up to 150,000 characters).
- The **strata profile** (up to 80,000): roster, council, the last 40
  meetings and their agendas, the list of documents on file, management,
  announcements, and the Library.
- The **newest 50 decisions.**
- **22 search passages:** 14 shared between the strata's own documents and the
  precedent pool, plus 8 from legislation.
- In Meeting Mode, **the item's attachments** (up to 150,000).
- **The whole conversation so far,** including each earlier question's records,
  replayed word for word.

Your 33 assistant answers averaged **84,944 tokens in and 1,133 out**,
about $0.27 each. The cache lasts 5 minutes, so most questions pay full price
for the bylaws and profile again.

### Gaps where a record can be missed

Reading the code turned up five. Each is fixed here and each gets recall-check cases.

1. **Precedent competes with the strata's own documents.** The two share 14
   slots, so passages from other stratas can push out the strata's own records.
   - **Fix:** separate slots. The strata's own documents get 16, precedent gets 4.
2. **Only the newest 50 decisions are sent.** In a strata with a long history,
   older decisions only appear if a document passage happens to match.
   - **Fix:** send the whole ledger, one line per decision, in the cached part
     of the request, up to about 120,000 characters. That's roughly 1,000
     decisions; past that, the oldest go through search. Decisions also become
     searchable.
3. **Search is by meaning only.** It can miss exact strings: "SL12", "bylaw
   7.3", a contractor's name, a date, an invoice number.
   - **Fix:** run a keyword search (Postgres full-text) alongside the meaning
     search and merge them. Exact matches on lot numbers, bylaw numbers, and
     quoted phrases are always included.
4. **Cut-off text isn't disclosed.** When attachments or bylaws hit their limit,
   the text ends in "[...truncated]", but the answer isn't told to say so.
   - **Fix:** a required disclosure, such as "Part of 'Depreciation Report 2024'
     wasn't read", which the answer must mention if it's relevant.
5. **Unreadable documents are silent.** Pending, failed, and scanned documents
   with no text never appear in search.
   - **Fix:** the profile marks each document's state ("on file, not readable"),
     so a miss can say "There's a document called X on file that I couldn't
     read".

**Kept exactly as they are:**
- The whole bylaws, every question.
- The full profile.
- A fresh search on every question.
- Earlier answers' records stay in the conversation, so follow-ups still see them.

**Honest misses:** the "I don't see anything" rule gains two requirements. It
names what it searched (bylaws, the ledger, the documents, legislation). And it
lists documents on file that might hold the answer but couldn't be read. It
never says "there is no record".

### The recall check (required gate)

Built first, before any change to how records are found, so we measure today's
behaviour as the baseline.

- **Where it lives:** a Super Admin page, "Stratasphere recall", holding test
  cases in a server-only table. The cases contain real strata records, so they
  live in the production database, never in the code repository.
- **A case is:** a strata, a question, optionally a focus (for example an agenda
  item), the record(s) that hold the answer, and optionally the fact the answer
  must state.
- **Check 1, finding:** does each expected record reach the model? It builds the
  request exactly as Stratasphere would and checks it, without calling the AI.
  It costs nothing, so it runs on every change.
- **Check 2, answering:** does the answer state the fact and cite the record? It
  calls the AI, at about $0.27 a case. It runs only when you press the button,
  showing the estimated cost first.
- **The starting set is about 40 cases on EPS9048,** written with you,
  deliberately covering:
  - Bylaw questions worded nothing like the bylaw.
  - Exact lot and bylaw numbers.
  - Decisions more than 50 back.
  - Records in scanned documents.
  - Questions about agenda attachments.
  - Follow-up questions.
  - Counting questions.
  - Things truly not on file, to check the honest miss.
- **The rule:** no change to records, context, or caching merges unless Check 1
  passes every case, and Check 2 is no worse than the baseline.

### Cost, without reading less

- **A 1-hour cache for the parts that don't change** between questions: the
  rules, bylaws, profile, and ledger.
  - A 1-hour cache costs twice the normal price to write, once. Each repeat then
    costs 5% of full price.
  - It pays for itself from the second question in an hour, which covers any
    meeting or research session.
  - The answer sees exactly the same records.
- **Stable ordering:** the cached part must be identical between questions, so
  live details that change often (such as today's date) move after it.
- **No duplicates within a request:** if a passage is already in an earlier
  question's records in the same conversation, it isn't added again. The text is
  still in front of the model, so nothing is lost.
- **Measured, not assumed:** before and after, compare average cost and cache
  reads per question in `stratasphere_usage`.
- **Target:** the first question in a session costs about the same as today
  (around $0.30–0.40, because it writes the cache). Later questions within the
  hour fall well under $0.15.

---

## 8. Database changes (migration 0090, PR 2a; the recall check is 0089)

Safe to re-run, with grants stated, as always.

- `has_stratasphere_access(corp)`: subscribed, and the person is on council, a
  manager, or an admin of that strata. The trial-meeting clause goes. This one
  function already guards `decisions`, `match_knowledge_chunks`, and document
  search, so the rule is enforced in the database, not only in the pages.
- `stratasphere_allowed(corp)`: returns `ok`, `subscription`, or `limit`. The app
  calls it before every question. `consume_stratasphere_request` stays, as a
  wrapper over it, for pages still on the previous release during a deploy.
  The limit counts that person's answers in `stratasphere_usage` over the last
  hour (both the assistant and Meeting Mode). `execute` for `authenticated`.
- `launch_meeting`: no trial check. Council and committee meetings launch free.
  AGM and SGM launches need a subscription, for when they're built.
- **Discussions:** the "first one free" check is removed.
- `meetings.video_link text`: the council's own link (http and https only,
  checked). Readable by whoever can see the meeting.
- `conversation_messages.focus jsonb` and `conversation_messages.surface text`
  (`panel`, `page`, or `meeting`).
- `documents.indexing_status` gains `waiting`: stored, not read or indexed,
  until the strata subscribes. The indexer marks unsubscribed stratas' files
  `waiting` instead of indexing them. Subscribing queues every `waiting` file.
- `decisions`: a full-text search column and index (for the ledger page and
  keyword search).
- `knowledge_chunks`: a full-text search column and index (for keyword search).
- **Unused columns kept for history:** `free_meeting_used`,
  `free_meeting_used_at`, `free_meeting_ai_requests_used`, `meetings.is_trial`.

**Server-side gates** (the database guards the records; these guard the paid features):
- **Video token route:** subscription required.
- **Draft motion, read uploaded agenda, historic minutes import:** subscription required.
- **The chat route:** `stratasphere_allowed`.

---

## 9. Free-tier costs, checked one by one

| Thing | Cost per use? | New |
|---|---|---|
| Training, Library, templates | No | Free |
| Meetings, voting, minutes | No | Free |
| Agenda attachments (stored only) | Storage only | Free. A 250 MB limit per unsubscribed strata keeps storage inside the Supabase plan. |
| Email to council, invitations | Covered by the email plan | Free. Nothing to the whole owner list. |
| Built-in video | Yes | Paid |
| Any AI, OCR, or embeddings | Yes | Paid |
| Reading the strata plan when a strata is created | Yes, once per strata (cents) | Free. It's the one exception (decision 2). |
| Demo site questions | Yes (3 per visitor) | Marketing cost; see below |

- **The demo:** it opens on a conversation that's already answered and stored,
  so it costs nothing to show. The 3 live questions per visitor stay, since
  they're what the demo is for.
- **Turnstile and the honeypot** already keep bots out of sign-up, so they
  protect the strata-plan reading too.

---

## 10. Building it: five PRs, in order

One PR each. Every PR goes through the usual checks (typecheck, unit tests,
database tests, build, browser test), and you run the migration and merge.

1. **Recall check and baseline.** The Super Admin recall page and table. Today's
   Stratasphere is unchanged. We write the 40 cases together and record the
   baseline.
2. **Free, paid, and price.**
   - Enterprise: "Talk to us" requests, and custom prices from the Super Admin console.
   - Migration 0090.
   - Server-side gates, the indexing gate, and backfill on subscribing.
   - Unlimited council meetings and Discussions; free templates.
   - The own-video-link field.
   - The new Stripe Prices, the price function, and the billing page,
     with the Yearly plan billed monthly on a 12-month commitment.
   - Removing the trial everywhere, in all copy and lifecycle emails.
3. **Learn, Decide, Remember navigation.**
   - The top bar, grouped second-level nav, and the Library moved to Learn.
   - The Remember pages: Documents read-only when unsubscribed, and the new
     Decision Ledger page.
   - Redirects for anything that moves.
4. **The one assistant.**
   - The floating panel and focus references.
   - Saved conversations from every surface, with where each started.
   - Suggested questions.
   - The panel inside Meeting Mode, replacing the embedded assistant.
   - The hourly safeguard.
   - The locked panel for unsubscribed stratas.
5. **Finding records and cost.** Behind the recall gate:
   - Separate precedent slots.
   - The whole ledger.
   - Keyword search.
   - The truncation and unreadable-document disclosures.
   - The 1-hour cache and de-duplication.
   - A cost comparison before and after.

**Marketing site** (its repo, alongside PR 2): pricing page, the three sections,
and "Free: Learn and Decide. Paid: Remember."

**Later, not in these five:**
- The budget pack: line item, business case, owner summary, and sample motion.
  A BC strata lawyer reviews it before it's published.
- Legislation and CRT updates in Learn.
- Sharing a conversation or project with council.
- General meetings: notice, owner sign-in, proxies, eligible voters, and
  3/4 and 80% votes.

---

## 11. Decisions (made 2026-11-12)

1. **Who uses Stratasphere:** council, managers (and their assistants), and the
   admins named on the Council page. Never owners.
2. **Reading the strata plan when a strata is created:** stays free.
3. **The top-bar labels:** Learn / Decide / Remember.
4. **No price cap, and no lot limit (2026-11-12).** Stratasphere is $30 + $3 per
   lot, for any strata. Council works out its own spending limits. Only a
   monthly charge over Stripe's $3,000 a payment goes to Enterprise ("Talk to
   us"), as do management companies.

---

## 12. What we measure after launch

- **Activation:** stratas created, council meetings run, and meetings per strata
  per month (the habit).
- **Conversion:** subscriptions, and what triggered them (from which lock:
  video, AI drafting, Ask, Documents, Ledger, general meetings).
- **AI cost** per question and per strata per month, against price, in the Super
  Admin console.
- **Recall check** results on every change to Stratasphere.
- **Churn,** and what cancelling stratas used.
