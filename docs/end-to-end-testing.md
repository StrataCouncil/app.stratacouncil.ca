# StrataCouncil.ca end-to-end test

A full pass through the platform, in the order a real strata would go through it. Each step says what to do and what you should see. Tick as you go; note anything that differs, with a screenshot.

**Accounts you'll need.** Your Super Admin account (kept by the sweep), plus three test accounts on real inboxes. Plus-addressing works: `you+admin@…`, `you+member@…`, `you+other@…`.

- **Admin**: creates the strata and becomes its admin.
- **Member**: joins and gets council roles.
- **Other**: an outsider who should see nothing of the strata.

Use separate browsers or private windows so you can be signed in as two people at once.

**Watch the Vercel logs** (Project → Logs) during the Stratasphere sections. Lines starting `[claude cache]` show the caching at work.

---

## 0. Clean start

- [ ] Run `supabase/scripts/reset_all_data.sql` in an empty SQL editor tab.
- [ ] The result row shows users = profiles = super_admins. Corporations, documents, conversations and other_chunks show 0. Legislation entries and chunks show your library's counts (not 0).
- [ ] In Storage, empty `strata-plans`, `corporation-documents` and `avatars`. **Leave `legislation` alone.**
- [ ] Inngest dashboard: the app is synced and shows two functions, `index-document` and `index-legislation`.

## 1. Accounts and sign-in

- [ ] Sign up as **Admin**. The confirmation email arrives, the link works, and you land in the app.
- [ ] Account page: set full name and phone, upload a profile photo. The photo shows in the account menu (top right).
- [ ] Turn on two-factor. Sign out and back in: the code is asked for and works. A backup code also works once.
- [ ] Sign up **Member** and **Other** the same way (photo on Member only, to test the initials fallback later).

## 2. Creating the strata

- [ ] As **Admin**, start "Add a strata" and upload a real Strata Plan PDF.
- [ ] The plan number, legal name and unit count are read from the plan. Correct anything that's wrong.
- [ ] Building name field and address lookup: typing an address suggests matches; picking one fills it in.
- [ ] Submit. You see that the request is waiting for review.

## 3. Super Admin console

- [ ] As **Super Admin**, open the console. Overview lists the request under Needs attention, with the platform numbers below. The tabs (Overview, Stratas, Council Training, Legislation Library, Announcements, Demo) are on every console page.
- [ ] Stratas tab: the request is listed. Open it, check the details, approve.
- [ ] **Admin** gets an approval email, and the strata now appears in their strata list.
- [ ] Stratas tab search finds the strata by plan number and by building name.
- [ ] **Open strata** (or "Open this strata as its admin" on its page) opens the strata. A banner says you aren't a member and that changes are real.
- [ ] You can see everything an admin sees (Council & Roles, roster, documents, meetings, billing), and you **don't** appear in its roster.
- [ ] Legislation library: your Acts show "Indexed: N sections". Upload one more file (any guidance PDF). It goes from "Waiting to index" to "Indexed" by itself within a minute or two.

## 4. Council & Roles

As **Admin**:

- [ ] Invite **Member** by email. The invite shows as pending. Member gets the email; the link signs them in and connects them to the strata.
- [ ] As **Other**, ask to join the strata. As **Admin**, the join request appears; decline it. **Other** has no access.
- [ ] Profile photos: Member shows their photo beside their name; a member without a photo shows initials.
- [ ] Assign Member to a strata lot.
- [ ] Edit Member's roles. Tick **Member at Large**, save.
- [ ] Edit again and tick **Treasurer**. Member at Large unticks itself and greys out with the explanation. Save: the roster shows Treasurer only. The lot's council column shows T, not M@L.
- [ ] In BC, try President and Vice President on the same person: blocked with the explanation.
- [ ] "Runs meetings" switch: turn it on for Member.
- [ ] Try to remove Admin's own admin role: refused ("A strata always needs an admin").

## 5. Owner roster (Lots)

- [ ] Download the template, fill in a few lots, upload it. The rows appear.
- [ ] Uploading the blank template gives a clear "nothing to import" style message, not an error.
- [ ] Edit a lot inline and save. Export the roster: the file matches.

## 6. Documents

- [ ] Upload several files at once into a folder (PDF, Word, a text file). Each goes "Waiting to index" → "Indexed" by itself.
- [ ] Upload your **bylaws** (a text PDF, not a scan) and your **insurance** documents.
- [ ] Upload a scanned PDF with no text layer: it shows "No text layer".
- [ ] Add a link document; it indexes or shows a clear reason it couldn't.
- [ ] Download opens the right file. Move a document to another folder. Re-index works.
- [ ] As **Member**, the same documents are visible. As **Other**, nothing.

## 7. Billing (admin only)

The app is on **live** Stripe keys: subscribing charges a real card. Either subscribe with a real card and cancel and refund in Stripe afterwards, or skip this section and switch Stratasphere on in SQL:

```sql
insert into public.subscriptions (corporation_id, status)
select strata_plan_number, 'active' from public.strata_corporations
where strata_plan_number = 'EPS9048'  -- your test strata's plan number
on conflict (corporation_id) do update set status = 'active';
```

- [ ] As **Member**, there's no billing page (sent back to Council & Roles).
- [ ] As **Admin**: Select plan (annual is pushed), Payment method (card or pre-authorized debit only; no Google Pay or Link), Contact emails (comma-separated), Review, Pay.
- [ ] The footer says "Powered by Trickfilm", and the page says charges appear as TRICKFILM.
- [ ] After paying, the strata shows Stratasphere active; the receipt reaches every contact email.

## 8. Meetings

- [ ] As **Member** (runs meetings), create a council meeting. Build the agenda: categories, items, an attachment on one item.
- [ ] Download the agenda as Word.
- [ ] Launch Meeting Mode. Call to order, record attendance and quorum.
- [ ] Record a motion: mover, seconder, votes. It shows as carried or defeated.
- [ ] Ask the Meeting Mode assistant a question about the current item. Answers are 2–4 sentences, about the attachment.
- [ ] Adjourn. The minutes draft is created; edit a line; finalize. Finalized minutes are locked.
- [ ] Export minutes as PDF and Word. The finalized minutes appear in Documents and get indexed.
- [ ] The carried motion appears in the **Decision ledger**.
- [ ] Minutes page: upload past minutes (a PDF of an old meeting). Its motions are added to the ledger as "from uploaded past minutes".
- [ ] Without a subscription: the free meeting allows ten assistant questions, then asks for a subscription.

## 9. Stratasphere (subscribed strata)

Start a **new conversation** for each test below.

- [ ] **Sources:** ask "How much will we pay for our insurance, and how long does the policy cover us?" The answer names the documents, and the source chips open them.
- [ ] **Memory:** in the same conversation, ask a bylaw question ("Can a property manager leave flyers at units?"). Then ask "So what was the premium again?" It answers from the insurance documents without retracting anything.
- [ ] **Bylaws:** the bylaw question cites the actual bylaw (e.g. hallways are for ingress and egress only).
- [ ] **Legislation:** ask "When must notice of an AGM be given?" It cites the Strata Property Act with a section number (s. 45), and the chip says so.
- [ ] **Standard Bylaws:** ask about something only the Standard Bylaws cover. It says the Standard Bylaw applies only if the strata hasn't replaced it, and doesn't call it the strata's own bylaw.
- [ ] **Not in the records:** ask something the records can't answer. It says so in one sentence and points to where to look (a document type, the strata manager, the CRT, CHOA). No guessing, no opinions.
- [ ] **Privacy:** ask about a named owner. The answer refers to them by strata lot (SL…), not by name.
- [ ] **Caching:** in the Vercel logs, from the second question in a conversation on, `[claude cache] read=` is far larger than `written=`.
- [ ] **Conversations:** rename, pin, move to a project, delete. Create, rename and delete a project (its conversations move back to Recents).
- [ ] **Private:** as **Admin** and as **Super Admin**, Member's conversations are not visible.
- [ ] **Not subscribed:** on a strata without a subscription, the assistant page shows the subscribe panel instead.

## 10. Super Admin full control

- [ ] Open the strata as Super Admin. Change a roster entry and a role. Both save, and you still don't appear in the roster.
- [ ] On the strata's Super Admin page, search the decision ledger by a word in a motion, a mover's name and a year. Each narrows the list; the count shows "N of M decisions".

## 11. Phones

- [ ] On a phone, the Knowledge Library works. The other strata screens show the "use a larger screen" notice.

## 12. Removing a member

- [ ] As **Admin**, remove **Member** (type the confirmation phrase).
- [ ] Member loses access straight away. Their lot's council role is cleared.
- [ ] Their Stratasphere conversations for this strata are gone (check in SQL: `select count(*) from conversations where user_id = '<member id>'` returns 0).

---

**When you're done:** send me the list of anything that didn't match, with screenshots, and I'll work through them.
