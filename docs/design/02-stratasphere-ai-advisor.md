# StrataCouncil.ca: Stratasphere, the AI advisor

**Status:** current as of 2026-11-21. Rewritten from the October draft to describe what is built. Code: `lib/ai/stratasphere.ts` (the assistant), `lib/ai/claude.ts` (every model call), `lib/kb/` (reading, privacy, search), `lib/inngest/index-document.ts` (indexing). Plan and reasoning: `docs/learn-decide-remember.md` §5 and §7.

## 1. What it is, and who uses it

Stratasphere is the paid tier and its assistant: the strata's memory. It answers questions from the strata's own records and BC strata legislation, and cites what it used.

- **Who:** council members, the strata's managers (and their assistants), and its admins, on a subscribed strata. Super Admins too. Never owners. `has_stratasphere_access` enforces this in the database, so it guards the ledger, document search, and passage retrieval as well as the pages.
- **Where:** the full-page Ask (`/strata/[corpId]/assistant`: conversations, projects, pinned), a floating window on every Your Strata page that knows what the person is looking at, and inside Meeting Mode for the current agenda item. Ask works on phones.
- **Limits:** no quota. A per-person limit of 30 questions an hour guards against scripts and loops; when it's hit, the message says when they can ask again.
- **Unsubscribed stratas:** the button still shows. It explains what Stratasphere does with a pictured example (no AI call) and offers Subscribe or "Ask your admin".

## 2. Privacy: what leaves our servers

Everything sent to an AI service is stripped of personal information first, every time: the question, the conversation, attachment text, ledger lines, directives, and passages. This follows the rule that PII stripping must be flawless, under BC's Personal Information Protection Act.

- **Stored data keeps real names.** Only what leaves is stripped. Passages are stored already stripped.
- **`lib/pii.ts` is deterministic** and makes no network calls. In order: emails and URLs are sealed; known people are replaced exactly (owners by their lot number, other connected members as "Council Member", leftover first names and surnames redacted); structured identifiers are redacted (card numbers with a Luhn check, SIN, bank details, phone numbers, street addresses, postal codes, licence plates, policy numbers, dates of birth); then capitalised runs are split at vocabulary words and unknown segments are redacted. Replacements are sealed so later layers don't re-read them.
- **Owners are never named**, people or companies. On the roster sent to the model an "Owner A" or "Company A" code marks the lots one owner holds, so lots can be counted and grouped without saying who.
- **Pseudonymize and restore** where the output must come back with real names (reading an uploaded agenda, drafting motions, historic minutes): names become `[REF-n]` placeholders before sending and are swapped back in the reply.
- **Precedent from other stratas** additionally has the strata's own identity removed (`lib/kb/privacy.ts`), so it can't be traced to a building.
- **Private notes** (Meeting Runner Notes) are never sent to the AI and never appear in minutes.
- **Conversations** are private to the person who asked: no one else can read them, including admins and Super Admins. They're deleted when the person is removed from the strata, and kept (unreadable until resubscribing) if the subscription lapses. The person can delete them any time.

## 3. Reading documents (the knowledge base)

Indexing is the Inngest function `index-document`, run on upload (on a subscribed strata) and on Re-index. Documents stored while unsubscribed are read when the strata subscribes.

1. Read the file on our own servers: PDF text layer, .docx, plain text, spreadsheets (.xlsx and .csv, each sheet as rows of cells, `lib/kb/spreadsheet.ts`), and photos (.jpg and .png, by OCR). Pages with no text layer, and photos, are read by OCR on our own servers (Tesseract, `lib/kb/ocr.ts`). In the background indexer each scanned page is read twice, at about 180 and 300 dots per inch (the second as one block, which keeps table columns together), and the reading that recovered more text is kept; Documents shows "Read from scan" or "Some pages unclear". Old .doc files are stored but not read.
2. Keep the raw text on the document row.
3. Strip it against the roster and member names.
4. Classify the document type from a stripped sample.
5. Split into passages of about 1,500 to 2,000 characters with 200 characters of overlap.
6. Embed with Voyage `voyage-3` (1,024 dimensions; pgvector with an HNSW cosine index).
7. Replace the document's passages. A subscribed strata also contributes an identity-stripped copy to the cross-platform precedent pool.

Agenda attachments on a free strata are stored and viewable but not read. Link attachments stay on the agenda item and are never fetched or read; the AI is told only that a link exists.

Acts and regulations in the Legislation Library are read from BC Laws by their links and refreshed weekly when BC Laws publishes a newer consolidation (0101); guidance is uploaded by Super Admins. Both are indexed the same way (scope `legislation`), with versions superseding older ones rather than replacing them. Citations in training and the Library are re-linked to the same section automatically after each re-index or deletion; anything uncertain is listed under Citations on the Knowledge Base screen for a choice. The same library feeds training content drafting, so the two never disagree on the law.

## 4. Finding the records for a question

For each question, in parallel:

- **The platform records:** the strata's live profile: name, plan, lot count, fiscal year, council, the coded roster, meetings and agendas, the list of documents on file (marking any not read or not readable), the management company, announcements, and the Library.
- **The bylaws:** the strata's registered bylaws, sent whole where they fit.
- **The decision ledger:** recent carried motions in full, and older decisions searched for the question's words and exact strings. Carried Discussions are in the ledger too.
- **Directives:** the follow-up council decided on, with each one's status.
- **Meaning search:** one embedding, three searches with their own slots so none crowds out another: the strata's own documents (16), precedent from other stratas (4), and legislation (8), at a cosine threshold of 0.25 (`lib/kb/search.ts`).
- **Keyword search** (0095): exact strings that must appear as written (lot numbers such as "SL12", bylaw numbers, quoted phrases) ranked first, then the question's words by full-text search, over the strata's own current documents only.
- **What the person is looking at** (the floating window): a meeting, an agenda item and its attachments, a document, or a Discussion, re-read with the person's own access each time (`lib/ai/focus.ts`). Saved with the question so the conversation shows where it started. The window keeps one conversation per record for the visit; it changes conversation when the person moves to a page about another record, never because an answer finished. A document still being read says so under "Looking at", since answers can't use it until it's done.
- **In Meeting Mode:** the current item's attachments (verbatim), and the decisions carried so far in this meeting.

The two searches are merged and deduplicated; identical copies of a document are sent once and passages from the same document are merged. A search that fails or times out (10 seconds) is disclosed at the top of the answer. The whole context is capped at 400,000 characters; anything left unread is disclosed.

## 5. The rules every answer follows

The system prompt carries these rules verbatim (`CARDINAL_RULES` in `lib/ai/stratasphere.ts`). In short:

1. **Answer the question that is asked:** work out the period, scope, and basis first; give the answer in the first sentence; if a question has two readings that give different answers, give both.
2. **Calculation:** never do arithmetic or count days in its head; every sum, share, proration, and count goes through the calculate tool, with the working shown.
3. **Fiscal year:** from the platform records, or the financial statements, and say which.
4. **No fabrication:** no corporation-specific fact that isn't in the context.
5. **When data is missing:** say so in one sentence and give one concrete direction (which document, which person, which Act).
6. **No internet.**
7. **Standard Bylaws** apply only where the strata hasn't filed its own on that subject; never present one as the strata's bylaw.
8. **Legislation, not advice:** explain the law only from legislation excerpts in the context, never from memory, and never advise what to do.
9. **No opinions,** predictions, or recommendations.
10. **Cite your source:** every record sent carries a tag (D a document, B the bylaws, A an attachment, F what the person is looking at, E and W ledger decisions, M this meeting's decisions, L legislation, P precedent, R platform records, T a directive). The answer cites the tags it used; the app removes them and turns them into the answer's "Sources used".
11. **Say precisely what you don't know:** name what was looked through, never claim something doesn't exist, and name a document on file that couldn't be read if it might hold the answer.
12. **Recency:** the most recent document or decision on a topic governs.
13. **Counting:** list every entry, then the total.
14. **Conflicts between sources** are stated, not resolved.
15. **Earlier answers** stand unless something in the context contradicts them.
16. **Disputed facts:** don't concede to a user's assertion; say where the fact came from and that a newer document can be uploaded.

Permitted knowledge is only what's in the context; general knowledge only to read it. Owners are referred to by lot number only. **Format:** plain text, answer first, short paragraphs separated by blank lines, no markdown or markup symbols, no emoji, no preamble or sign-off; numbered lines only when working or a list is needed.

## 6. Model, cost, and caching

- Every model call goes through `lib/ai/claude.ts`: structured outputs, refusal handling, and a server-side fallback. It uses the most capable Claude model available, by the owner's choice.
- Answers stream, so people read while it writes.
- The standing records (profile, bylaws, ledger) are cached for an hour between questions in a conversation; cache reads and writes are logged.
- Each question's token use and estimated cost are logged per strata.

## 7. Other AI features

All use the same wrapper and the same stripping:

- Reading the strata plan when a strata is created (free, the one exception).
- Document classification during indexing.
- Reading an uploaded agenda (OCR then AI), and drafting motion wording for agenda items and Discussions (paid).
- Historic minutes import: extracting past decisions into the ledger (paid).
- Directive wording when a meeting adjourns or a Discussion closes in favour (paid; free stratas use the motion's own words).
- Super Admin only: training module drafting, Library entry drafting, social post drafting, and the recall check.

Minutes summaries are not an AI call: each item's summary comes from its structured record (motion, mover, seconder, vote), editable until the minutes are finalized.

## 8. The recall check

A Super Admin page of test cases, stored only in the production database because they contain real records. A case is a question as a member would ask it, with an optional expected answer, key figures the answer must state (checked automatically), and the records it should draw on. Running it shows the answer, every record cited with the passage that was sent, the calculations, and what was looked at but not used; a person marks it Right, Partly, or Wrong. Re-runs compare with the answer marked Right. **No change to how records are found, what context is sent, or caching merges unless every answer marked Right still matches.**

## 9. Open questions

- A cheaper model for narrow jobs (classification, titles), measured against the recall check before switching.
- Whether to add a model-based PII check on top of the deterministic stripper for the precedent pool, weighed on cost once volume is real.
- Indexing the Library's guide bodies so Stratasphere can draw on them in full.
