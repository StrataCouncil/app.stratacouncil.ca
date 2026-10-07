# The demo site (demo.stratacouncil.ca)

The same code as the live app, deployed a second time with `DEMO_MODE=true`
and its own Supabase project. See `lib/demo.ts`.

## How it works

1. In the live Super Admin console's **Demo** tab: enter a person's name and
   email, and choose whether the link opens on the Stratasphere (their strata)
   or Council Training. The link is emailed to them (from the live site's Mailtrap) and shown
   in the console. Someone who already has a working link today gets the same
   one again.
2. The link (`demo.stratacouncil.ca/start/<token>`) creates their account and
   their own copy of the fictional strata (a `DEMO-` Strata Plan number,
   subscribed, with them as admin), signs them in and opens it. It works again,
   on any device, until midnight Pacific on the day it was made.
3. At midnight their session ends (the account carries the time, checked by
   `middleware.ts`). The clean-up deletes their strata, their account and anyone
   they invited: Vercel Cron calls `/api/demo/cleanup` just after midnight, and
   every link opened also clears anything already expired. Names and emails are
   deleted 7 days after the link ended.

## What a visitor finds

Their own copy of Larchwood Commons (`lib/demo-kit/`), built when the link is
first opened and dated from that day:

- 24 owners on the roster, a five-member council, Harbourline Strata
  Management (manager, logo, letterhead), and Marisol Ortega's request to join.
- The Library: bylaws, rules, budget, depreciation report summary, insurance
  summary, AGM minutes, roof assessment, contracts, letters and an incident
  report, already indexed (PII-stripped, as usual) for the Stratasphere.
- Two held council meetings with final minutes and their decisions, the AGM's
  resolutions in the decision ledger, and the next meeting's agenda with its
  attachments, ready for Meeting Mode.
- Running stories to ask about: the roof replacement levy and contract, a
  visitor-parking dispute, a water leak and its deductible, an EV charger
  request and a barking dog.

Search vectors for the documents are kept (`demo_kit_embeddings`), so only the
first visitor's strata calls the embeddings service.

Council Training and the legislation library are copied from the live site
(`lib/demo-mirror.ts`): training after every publish or track/module change
(only the first published module is open in the demo), the library after
every indexed entry, and both from the Demo tab's "Copy training and
legislation to the demo" button. The global precedent pool is never copied.

In the demo: no Stripe or billing, no email (invites wait as pending), no
welcome checklist, no sign-up or sign-in page (the banner and the front page
link to sign-up on the live site), no Super Admin console or builders, and no way into another
strata. Inngest jobs run as a separate app (`stratacouncil-demo`) with `demo/`
event names, so they never mix with the live site's.

## Database

`supabase/demo/apply.sh` runs on every push to `main` that changes
`supabase/migrations` or `supabase/demo` (GitHub Action "Demo database"): every
migration the demo database hasn't had yet, recorded in
`stratacouncil_meta.applied_migrations`, then `supabase/demo/demo.sql` (the
demo's own tables and functions, safe to re-run). The live database is never
touched; its migrations are still run by hand. It can also be run from the
Actions tab (Run workflow).

## Settings

| Where | Name | Value |
|---|---|---|
| Vercel, `stratacouncil-demo` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | the demo Supabase project |
| | `NEXT_PUBLIC_APP_URL` | `https://demo.stratacouncil.ca` |
| | `DEMO_MODE` | `true` |
| | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | as live |
| | `CRON_SECRET` | any long random string (Vercel sends it to the clean-up) |
| | Inngest keys | from the Inngest integration (tick the demo project there) |
| Vercel, `app-stratacouncil-ca` | `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY` | the demo Supabase project |
| GitHub, repository secret | `DEMO_DATABASE_URL` | the demo project's Session pooler connection string |
| Demo Supabase, Authentication | Site URL `https://demo.stratacouncil.ca`, redirect `https://demo.stratacouncil.ca/**`, new sign-ups off | |
