# Automated browser tests (design)

Status: designed 2026-11-09, not built. On hold until the owner's Go. Step 1
of 4 in the release-safety plan (below). `docs/end-to-end-testing.md` is the
manual checklist; this is the automated suite that runs on every PR.

## Why

Every PR already runs, in GitHub CI (`.github/workflows/checks.yml`): the
typecheck, the unit tests, a production build, every migration on a clean
database (twice, to prove they're safe to re-run), and the database
permission suites. None of that opens a page in a browser. A button that
does nothing, a page that crashes on load, or a form that never submits
passes every check today.

## What it needs from the owner

- No accounts, keys, or cost. It runs in the existing GitHub CI with
  nothing secret.
- About 10 more minutes of GitHub Actions per PR (the repo is private, so
  this counts against the monthly allowance).
- Once it's proven: mark the new check **required** in GitHub's branch
  settings, so a PR can't merge while it's red.

## How it works

### A real local Supabase, thrown away after each run

The database tests stub sign-in and storage. This suite uses the official
Supabase local stack (the Supabase CLI, in Docker on the CI runner): real
sign-in, file storage, the database API, and a mail catcher (Inbucket).

- Adds `supabase/config.toml` for the local stack.
- All migrations run against real Supabase for the first time. The early
  ones (0001 to 0015) may need small test-only setup. Nothing changes on
  the live or demo databases.

### Test mode for outside services

One switch (`E2E=1`) swaps each outside service for a stand-in that returns
fixed answers:

| Service | Stand-in |
|---|---|
| Claude (Stratasphere, drafting, Tidy, minutes) | Canned answers, with a citation |
| Voyage (search embeddings) | Fixed vectors |
| Mailtrap (email) | The local mail catcher, so tests click real sign-in and invite links |
| Stripe | Not called; billing pages load with test plans |
| ElevenLabs, Unsplash | Not called |
| Zoom Video SDK | Token issued; no video (headless browsers can't run it) |
| Inngest | Jobs run inline, so an upload is indexed before the test moves on |

The switch refuses to turn on in production (it checks `NODE_ENV` and that
the Supabase URL is local), so it can never weaken the live site.

### A fictional test strata

Seeded from the demo kit's made-up data, so no real names: a council with
every role (Admin, someone who can run meetings, council member, owner), a
few lots, documents, and a past meeting. Plus an outsider with no access.

## The flows

1. **Sign-in:** email link, sign out; a non-member can't see the strata.
2. **Documents:** upload a PDF and a scanned PDF (OCR), search, delete.
3. **Discussions:** start, vote, declare a conflict, comment, close as the
   starter or an Admin; refused for anyone else.
4. **Meetings:** build an agenda, launch, take attendance (quorum shown),
   open a vote, record a result (threshold math checked), declare a
   conflict and step out, adjourn, finalize the minutes.
5. **Roster and invites:** invite someone, accept the email link, set roles.
6. **Stratasphere:** ask a question, get the canned answer with a citation;
   a second user can't see the first user's conversation.
7. **Library and training:** open an entry, play a module.
8. **Billing:** the pages load; Stripe isn't called.
9. **Phone size:** the main pages render without breaking.

## In CI

A new job in `checks.yml`, on every PR and on main: start the local
Supabase, run migrations and the seed, build the app in test mode, run
Playwright (Chromium). On a failure it attaches screenshots and a
step-by-step trace.

## What it won't cover

- Real video (Zoom can't run headless): only the page and the Join button.
- Real delivery by Stripe, email, or Zoom.
- The quality of the AI's answers.
- Whether the live database has every migration (step 3 below).

## The release-safety plan

1. **This suite.** Nothing needed from the owner.
2. **Staging.** A staging Supabase project (separate from demo, which holds
   prospects' sandboxes) and Vercel Pro (about US$20 a month), so every PR
   gets a preview on staging. Also lifts the private-repo block on
   previews. Needs the owner to create the accounts.
3. **Migrations.** Run automatically on staging, as on demo today, and a
   check on each deploy that warns if the live database is missing one.
   This is the gap behind the discussion bug of 2026-11-08 (0076 to 0079
   never run on live).
4. **Production alerts.** Error alerts (for example Sentry) and a
   post-deploy smoke test that loads key pages on the live site without
   signing in or writing anything. Needs an account.

Each step is its own PR.
