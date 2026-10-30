# Training reminders and mailing preferences (design, 2026-10-30)

Status: planned, not built. One PR when built, with migration `0070`.

## The split

- **Mailing updates (marketing):** newsletters, new features, legislative
  updates. Only to people who ticked the box at sign-up
  (`profiles.marketing_opt_in`, 0006). Express consent under CASL.
- **Reminders (service-related):** to anyone with an account, opted in or
  not, about something they started on the platform. The Privacy Policy
  (section 5) already separates marketing from service-related
  communications; training reminders fit "account notifications".
  Optional: add "reminders about training you've started" to that list on
  the marketing site, to make it explicit.

Even service-related messages carry CASL identification and an
unsubscribe link (CASL s. 6(2)), so every reminder has both. All mail is
no-reply and never invites replies.

## 1. Opt-in on the Users tab

- Person page: a clear line near the top, "Mailing updates: Yes, since
  <date>" or "No" (from `marketing_opt_in_at`).
- Users list: a column, and an "Opted in to updates" filter; an opted-in
  count beside the funnel.
- Account page: a "Mailing updates" switch, so people can withdraw (or
  give) consent after sign-up: the "communication preferences" the
  policy promises. Turning it on records the date.

## 2. Training reminders, sent from the console

- **Who:** started a published module, finished none of it.
- **Where:** a **Send training reminder** button on the person page.
  Turned off, with the reason, when the person has turned reminders off,
  their email isn't confirmed, they were reminded in the last 7 days, or
  nothing is unfinished.
- **Preview:** the exact email is shown before sending; staff confirm.
- **The email:** subject "Pick up where you left off: <module>"; one
  short paragraph and a **Continue** button that opens that module. No
  sales content. Footer: Trickfilm Entertainment Inc., mailing address
  (to be supplied), stratacouncil.ca, and "Stop training reminders".
- **Unsubscribe:** one click, through a random token stored on the
  profile (no new secret). Sets `reminder_emails_off_at`. Also sent as
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers through Mailtrap,
  for Gmail and Yahoo's one-click requirement. The account page gets a
  "Training reminders" switch to turn them back on.
- **Log:** a server-only `email_sends` table: person, kind, subject,
  sent by, sent at, and whether Mailtrap accepted it. Never the body.
  Shown on the person's timeline and as "Reminded <date>" on the list.

## Later

- Bulk: filter the list to "Started, nothing finished" and send to
  everyone eligible in one step, after a preview.
- Automatic reminders (for example 7 days after someone stops), once
  manual sends show how people respond.

## Migration 0070 (planned)

- `profiles`: `reminder_emails_off_at timestamptz`, `email_token uuid`
  (unique, for unsubscribe links). Not writable by the person except
  through the account page's server action.
- `email_sends`: server-only (RLS on, no policies; anon and
  authenticated revoked; service role granted). Goes with the person on
  account deletion; no `corporation_id` column.
- Safe to re-run; a DB suite in the same PR.

## Open

- The mailing address for the footer (a PO box or business address).
- Whether to add the training-reminders line to the Privacy Policy.
