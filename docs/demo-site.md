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
   every link opened also clears anything already expired. Names, emails and
   the activity log are deleted 7 days after the link ended.

## What a visitor finds

Their own copy of Larchwood Commons (`lib/demo-kit/`), built when the link is
first opened and dated from that day:

- 24 owners on the roster, a five-member council, Harbourline Strata
  Management (manager, logo, letterhead), and Marisol Ortega's request to join.
- The Library: bylaws, rules, budget, depreciation report summary, insurance
  summary, AGM minutes, roof assessment, contracts, letters and an incident
  report, already indexed (PII-stripped, as usual) for the Stratasphere.
- Two held council meetings with final minutes and their decisions, and the
  AGM's resolutions in the decision ledger.
- Their own meeting to create: one council meeting, whose agenda (the strata's
  next meeting, with its attachments) fills in when they create it. Only New
  Business: Roof Repairs can be edited (wording, motion, Stratasphere's
  motion drafting); the rest is locked, on screen and on the server. Then
  they run it in Meeting Mode and adjourn it to get their minutes.
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

## Limits

Counted per link (`demo_visitors`, `lib/demo.ts` `DEMO_LIMITS`), across devices:

- 3 questions to the Stratasphere chat, and 3 to Meeting Mode's Stratasphere.
  A question that fails isn't counted.
- 1 meeting created (deleting it doesn't give it back).
- 5 motions drafted by Stratasphere, for the one editable item.
- No uploads at all (documents, attachments, links, agendas, old minutes,
  logos, roster files, photos): only the demo's own materials are there.

Past a limit, or on a locked control, the visitor sees "Get more out of the
Stratasphere™ by creating an account on stratacouncil.ca today!" with a
"Create your free account" button to sign-up on the live site
(`components/DemoGuard.tsx`).

## Activity log

Everything a visitor does goes in `demo_activity` (demo database): pages and
how long each was open, clicks, messages and errors they saw, limits they
reached, every Stratasphere question with its answer, their meeting (created,
agenda saved with its motion, motions drafted, launched, called to order,
adjourned, exports), documents opened or downloaded, and Council Training
sections finished. Never what's typed into a field (Stratasphere questions are
logged on the server). In the live console's Demo tab, each link shows its
entries; opening it shows how far they got (time, questions, their meeting,
training, limits and problems), where they spent their time, and the full
timeline. Deleted 7 days after the link ended.

## Also off in the demo

No Stripe (Billing shows a made-up annual plan paid by pre-authorized debit, and its buttons show the sign-up message), no email (invites wait as pending), no
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
