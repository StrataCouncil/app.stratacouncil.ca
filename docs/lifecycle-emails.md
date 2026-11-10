# Lifecycle emails (design)

Status: designed 2026-11-10, not built. Replaces
`docs/training-reminders.md` (2026-10-30), whose mailing preferences and
training reminders are folded in here. Build in four PRs, in the order
below, after the owner's Go.

Milestone emails, a feature series, and re-engagement reminders for
people who already have an account. They help activation and retention;
they don't reach new councils, which is separate work.

## Built in-house

Built on what the app already has: Mailtrap sends, Inngest schedules and
reacts to events, and the data stays in our own database. An outside
email marketing service (Customer.io, Loops, and the like) would need a
constant feed of each person's activity in the app, which is a PIPA
disclosure to justify, mostly stored in the US, and priced per contact.

## The two kinds of email (CASL, on top of PIPA)

| Kind | Who gets it | Journeys |
|---|---|---|
| **Service** | Anyone with an account (and invitees, for their invitation) | Invitation reminders, training reminders, Admin setup, re-engagement |
| **Promotional** | Only people who opted in: `profiles.marketing_opt_in` (0006, with the date as proof) | The feature series, newsletters |

Every email, of either kind:

- Is from no-reply and never invites replies.
- Has the footer: Trickfilm Entertainment Inc., Park Place, 666 Burrard
  St #3100, Vancouver, BC V6C 2X8, stratacouncil.ca, and an unsubscribe
  link for that kind of email (CASL s. 6(2)). The address goes in
  `lib/company.ts` with the legal name.
- Has one-click unsubscribe: a link with a random token, plus the
  `List-Unsubscribe` and `List-Unsubscribe-Post` headers through Mailtrap
  (Gmail and Yahoo require them).
- Is written in Canadian English, with Oxford commas, and no emoji.

The Account page gets an **Emails** section with a switch for each kind:
setup tips, reminders, and product news (marketing opt-in; turning it on
records the date).

The Privacy Policy's account notifications list (marketing site,
section 5) adds "reminders about setting up your strata, invitations,
and training you've started".

To confirm with a lawyer before launch: the opt-in wording at sign-up,
and that each journey sits on the right side of the service/promotional
line.

## The engine

- **Rules in code.** Each email is a rule: who it's for, what starts it
  (an event, or a condition such as "no council invited 2 days after
  approval"), its delay, and the goal that ends it.
- **A daily sweep,** an Inngest scheduled function at about 10:00 PT,
  evaluates the condition rules. Event rules (a welcome on joining) fire
  from Inngest events sent by the server actions that already exist.
- **Checked again at send time.** If the person has reached the goal
  since, the email is skipped. Nobody is reminded of something they've
  done.
- **Limits:** at most one lifecycle email per person every 2 days; sent
  only between 9:00 and 17:00 PT; never to an unconfirmed address, a
  Super Admin's demo or sandbox, or a deleted account.
- **No duplicates:** a send is unique per person, journey, and step.
- **Clicks:** links go through `/e/<send id>`, which records the click
  and redirects only to our own pages (never an open redirect). Opens
  aren't tracked: email apps preload images, so open counts mean little.
- **Success** is the goal reached within 7 days of the email, measured
  from the app's own data.

## Console

A **Lifecycle emails** page in the Super Admin console:

- Each journey with an on/off switch (all off until turned on), its
  steps, and a preview of each email as it would look.
- For each step: sent, clicked, and goal reached.
- On each person's page: their emails (journey, step, subject, sent,
  clicked), never the body. Plus "Send training reminder", with a
  preview, as designed on 2026-10-30.

## The journeys

### 1. Foundation, invitation reminders, training reminders (service)

- **Invitation not accepted:** reminders 3 and 7 days after the invite,
  then stop. The invitee can stop them with one click; the invitation
  itself stays valid.
- **Training started, not finished:** 7 days after the last activity,
  and again at 21 days, then stop. Subject "Pick up where you left off:
  <module>", one paragraph, and a **Continue** button.

### 2. Admin setup (service)

To the person setting up a strata, and its Admins once approved. Each
step stops as soon as it's done.

| Step | When | Goal |
|---|---|---|
| Add your strata | 1 day after sign-up, no strata requested | A strata request |
| Invite your council | 2 days after approval, nobody invited | An invitation sent |
| Add your documents | 4 days after approval, no documents | A document uploaded |
| Hold your first meeting or discussion | 10 days after approval, neither | A meeting created or a discussion started |

### 3. Feature series (promotional, opt-in only)

Six emails, one feature each, starting 3 days after the person joins a
strata and then every 4 days (about 3.5 weeks). A step is skipped when
the person has already used that feature.

1. Stratasphere: ask a question about your bylaws.
2. Documents and search.
3. The Library.
4. Discussions.
5. Meeting Mode.
6. Council Training.

### 4. Re-engagement (service)

- **No sign-in for 30 days:** what's happened in their strata since
  (new documents, discussions waiting for their vote, upcoming meetings).
  Facts about their own strata, nothing promotional. Skipped if nothing
  has happened.
- **No sign-in for 60 days:** one last note, then quiet.

## Data (first PR; migration 0086)

- `profiles`: `email_token uuid` (unique, for unsubscribe links),
  `setup_emails_off_at`, `reminder_emails_off_at`. Changed only through
  the Account page's server action and the unsubscribe route.
- `invites`: an unsubscribe token for invitation reminders.
- `email_sends`: person (or invitation), journey, step, subject, sent at,
  accepted by Mailtrap, clicked at. Never the body. Unique per person,
  journey, and step. Deleted with the person's account; no
  `corporation_id`.
- `email_journeys`: journey, on/off, changed by, changed at.
- Grants: `email_sends` and `email_journeys` are server-only (RLS on, no
  policies; anon and authenticated revoked; service role granted).
- Safe to re-run, with a DB suite in the same PR.

## Before building

- Copy: draft every email for the owner to review before any code.
- The Privacy Policy line (marketing site).
- Whether to show the phone number, (604) 691-6100, in the footer. CASL
  needs the mailing address plus one of a phone number, email address,
  or web address, so stratacouncil.ca is enough on its own.
