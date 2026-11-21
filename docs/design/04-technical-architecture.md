# StrataCouncil.ca: Technical architecture and deployment

**Status:** new on 2026-11-21, written from the code (no earlier version of doc 04 survived). Covers how the app is built, hosted, configured, tested, and released.

## 1. Repositories and sites

| Site | Repo | Hosting |
|---|---|---|
| `app.stratacouncil.ca`, the app | `StrataCouncil/app.stratacouncil.ca` (this repo) | Vercel project `app-stratacouncil-ca` |
| `demo.stratacouncil.ca`, the demo | the same repo, deployed again with `DEMO_MODE=true` | Vercel project `stratacouncil-demo` |
| `stratacouncil.ca`, marketing | a separate repo | Vercel |

Vercel is on the Hobby plan. Preview deployments for pull requests sometimes refuse to build ("private repository on your GitHub organization"); that doesn't affect production or CI.

## 2. Stack

- **Next.js 15** (App Router, server components and server actions, `after()` for work after the response), **React 19**, **TypeScript**. Node 22 in CI.
- **Supabase:** Postgres 16 with pgvector, Auth (passwordless email), Storage (private buckets), and row-level security. Two projects: live and demo.
- **Inngest** for background jobs (`lib/inngest`):
  - `index-document`: read, strip, classify, split, embed, and store a strata document's passages (doc 02 §3);
  - `index-legislation`: the same for the Legislation Library;
  - `fingerprint-document`: the SHA-256 of a stored file, to spot identical copies;
  - `reread-scans`: hourly, queues scanned PDFs filed before OCR existed;
  - `lifecycle`: hourly, sends what each email journey owes people now, between 9:00 and 17:00 BC time, only once a Super Admin turns a journey on; never on the demo.
- **Vercel Cron:** `/api/demo/cleanup` just after midnight Pacific (`vercel.json`), deleting expired demo stratas and accounts.
- **Fonts** served from the site (`next/font/local`); no build-time Google fetch.

## 3. Third-party services

| Service | Used for | Code |
|---|---|---|
| Anthropic (Claude) | Every AI feature, through one wrapper | `lib/ai/claude.ts` |
| Voyage AI (`voyage-3`) | Embeddings for meaning search | `lib/kb/embed.ts` |
| Tesseract (on our servers) | OCR for scanned PDFs; language data bundled in `lib/kb/tessdata` | `lib/kb/ocr.ts` |
| Stripe | Subscriptions: card or pre-authorized debit (business PAD), the Payment Element inside the app, webhooks | `lib/stripe`, `app/api/stripe/webhook` |
| Mailtrap | Every email, from no-reply addresses, including Supabase Auth's sign-in emails through its Send Email Hook | `lib/email` |
| Zoom Video SDK | Built-in meeting video, our own panel, sessions routed to Canada; about CA$0.0047 per participant-minute | `lib/zoom`, `components/meetings/VideoPanel.tsx`, `docs/zoom-video-sdk.md` |
| Cloudflare Turnstile | Bot protection on forms that send email | `lib/security/turnstile.ts` |
| ElevenLabs | Training narration (text to speech; only course scripts are sent) | `lib/media/elevenlabs.ts` |
| Unsplash, Pixabay | Training pictures; stock video for social posts | `lib/media` |
| Google Drive Picker | Importing documents from Drive | `lib/google-drive.ts` |

Personal information is stripped before anything goes to Anthropic or Voyage (doc 02 §2). Nothing about the strata's people goes to ElevenLabs, Unsplash, or Pixabay.

## 4. Configuration

Keys live only in GitHub secrets, Vercel environment variables, and Supabase; never in the repo, and never pasted into chat. `.env.example` lists the names. The code reads:

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_WEBHOOK_SECRET` (the Send Email Hook).
- **Site:** `NEXT_PUBLIC_APP_URL`, `DEMO_MODE`, `DEMO_APP_URL`, `DEMO_SUPABASE_URL` and `DEMO_SUPABASE_SERVICE_ROLE_KEY` (the live site creates demo links), `DEMO_REQUESTS_TO`, `CRON_SECRET`, `MFA_BACKUP_SESSION_SECRET`.
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, the four Price IDs (`STRIPE_PRICE_MONTHLY_BASE`, `_MONTHLY_UNIT`, `_ANNUAL_BASE`, `_ANNUAL_UNIT`), and the same set prefixed `STRIPE_TEST_` for sandbox stratas.
- **AI and search:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`.
- **Jobs and email:** `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `MAILTRAP_API_TOKEN`, `MAILTRAP_SENDER_EMAIL`.
- **Video:** `ZOOM_VIDEO_SDK_KEY`, `ZOOM_VIDEO_SDK_SECRET`, `ZOOM_VIDEO_SDK_GEO_REGIONS` (optional, default `CA`).
- **Other:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`.

## 5. Code layout

- `app/`: routes. `app/strata/[corpId]/*` is Your Strata and Stratasphere; `app/training`, `app/library`, `app/templates` are Resources; `app/admin/*` is the Super Admin console; `app/api/*` holds webhooks, the demo endpoints, and the marketing site's form endpoints.
- `components/`: UI, grouped by area (`meetings`, `training`, `directives`, `discussions`, `library`).
- `lib/`: logic. Pure modules (no `@/` imports) are unit-tested directly: meeting rules (`lib/meetings`), vote math, prices, PII stripping, citations, the calculator, directives, the video room.
- `supabase/migrations/`: the schema, numbered, each safe to re-run with its grants stated. `supabase/tests/`: database test suites. `supabase/demo/`: the demo database's extra tables.
- `docs/`: design docs (`docs/design`) and feature designs.

## 6. Checks and tests

Every pull request runs two GitHub Actions jobs (`.github/workflows/checks.yml`):

1. **Typecheck, unit tests, build:** `npx tsc --noEmit -p .`, `npm test` (Node's test runner with type stripping, `tests/**/*.test.ts`, about 490 tests), `npx next build`.
2. **Migrations and database tests:** `supabase/tests/run.sh` applies every migration, applies those from 0016 a second time (they must be re-runnable), checks column grants after each pass, runs the seed, then each suite in `supabase/tests/suites` on its own fresh copy (54 suites). A suite fails by raising an error.

Locally the same: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:db` (Postgres 16 with pgvector). Automated browser tests are designed but not built (`docs/automated-browser-tests.md`); the manual checklist is `docs/end-to-end-testing.md`.

## 7. Releasing

- Work happens on a branch and goes to `main` by pull request, one PR per batch. The owner reviews and merges.
- Vercel deploys `main` to both sites on merge.
- **Migrations:** the live database is changed by hand: the owner pastes each new migration into the Supabase SQL editor after merging. The demo database applies migrations automatically on every push to `main` (`.github/workflows/demo-database.yml`).
- **Commits and PRs** never name an AI model.
- After a merge, the working branch is reset to `main` for the next batch.

## 8. Security posture

- Row-level security on every table, security definer functions for writes, column grants on `meetings`, nothing for `anon` (doc 01 §1).
- The service role key is server-only.
- Webhooks are signature-checked (Stripe, Supabase, Inngest). Cron calls carry `CRON_SECRET`.
- Links fetched for indexing go through an SSRF guard.
- Workflows use a read-only GitHub token.
- Dependency advisories are patched as GitHub reports them (Zod 4.6.7 in November; Next.js 15.5.29).
- No test data on the live site; testing happens in the demo site's sandboxes.

## 9. Costs to watch

- **Claude:** per question, logged with tokens and estimated cost per strata (`stratasphere_usage`), and cached for an hour within a conversation.
- **Zoom:** per participant-minute; recording and transcription are never started.
- **Voyage:** per embedded passage, once per document version.
- **Vercel Hobby and Supabase:** current plans; paid tiers deferred until revenue.

## 10. Open questions

- Staging: none; the demo site's sandboxes stand in for one until a paid plan is affordable.
- Automated browser tests (designed, waiting).
- A shared design-token package with the marketing repo, if the two drift.
