# StrataCouncil.ca: Identity, multi-tenancy, and data model

**Status:** current as of 2026-11-21 (migrations to 0099). Rewritten from the October draft to describe what is built. The migrations in `supabase/migrations` are the source of truth; each starts with a note on what it does and why. The history of decisions is in `00-changelog.md`.

## 1. Principles

- **One account per person, many stratas.** A person (`profiles`) connects to any number of strata corporations; everything a strata owns is keyed by `corporation_id`, which is the strata plan number (for example `EPS9048`).
- **Row-level security everywhere.** Every table has RLS on. Clients read through policies; most writes go through security definer functions that check who's asking. `anon` gets nothing. The server's service role is used only in server code, for work that must cross users (indexing, email, demo setup).
- **Column grants where it matters.** Since 0072, `authenticated` reads `meetings` column by column, so draft minutes and private notes can be withheld; every new column needs its grant (0092 fixed one that was missed).
- **Records are kept.** Documents, minutes, decisions, votes, and Discussions are governance records: they aren't deleted when someone leaves or a subscription lapses, and names are kept beside votes, comments, and handovers so the record survives an account being deleted. Personal search history (Stratasphere conversations) is the exception.
- **Migrations are safe to re-run** and state their grants. They're applied by hand in the Supabase SQL editor for the live site; the demo database applies them automatically on each push to main.

## 2. Identity

- **Auth:** Supabase Auth, passwordless (a one-time link and code by email, sent through Mailtrap by Supabase's Send Email Hook). Sign-in never creates an account.
- **`profiles`:** name (locked once set by the person), email, phone, avatar, `is_super_admin`, marketing opt-in with its date, the campaign tags from sign-up, an email token for unsubscribe links, and when setup tips were turned off.
- **Two-step authentication (optional):** Supabase TOTP factors, with ten backup codes in `mfa_backup_codes` (server-only since 0072). Anyone with a factor is asked for it at sign-in (`middleware.ts`). Not required for anyone yet.
- **Super Admins** (`is_super_admin`): platform staff. They review strata creation, act with Admin rights in every strata, and run the console. They can't read anyone's Stratasphere conversations.
- **`user_activity`:** Library guides opened, templates downloaded, documents opened and similar, for the console's Users tab.

## 3. Strata corporations

- **`strata_corporations`:** plan number (the key, never editable), legal name, building name, address, lot count (`unit_count`, from the strata plan), jurisdiction, fiscal year start month, the plan document, and a Stripe sandbox flag for test stratas. The `free_meeting_*` columns are kept for history; the trial ended in 0090.
- **Editing details** (0096): `update_strata_details` takes only changed fields. The strata's Admins edit the building name, address, and fiscal year; Super Admins also edit the legal name, jurisdiction, and lot count. Every change is logged in `strata_detail_changes` with old and new values.
- **Creation** (`corporation_creation_requests`, `strata_plan_parses`): the requester uploads the plan, the app reads it, the requester attests, and a Super Admin approves. Approval creates the strata, makes the requester its admin, pre-creates one `owners_and_council` row per lot, and files the plan.
- **Joining** (`corporation_join_requests`): approved or turned down by the strata's admin.
- **`strata_management`:** the management company's name, contacts, managers, and logo, printed on agendas and minutes.

## 4. Membership, roles, and permissions

- **`corporation_memberships`:** one row per person per strata, with `status` (`invited`, `active`, `removed`), the strata lot they're tied to (`lot_number`), and two switches the admin sets: `can_run_meetings` and `can_manage_billing`.
- **`corporation_role_assignments`:** `admin`, `president`, `vice_president`, `treasurer`, `secretary`, `member_at_large`, `manager`. President, Vice President, Treasurer, and Secretary are one holder each, and President and Vice President must be different people (Standard Bylaw 13(2)). Roles stack. New members have none until assigned.
- **`corporation_invites`:** by email, with an optional role and lot, expiring after 7 days.
- **The access helpers** (security definer functions, used by policies and other functions so the rules live in one place):

| Function | True when |
|---|---|
| `is_corporation_member` | an active member of the strata |
| `has_corporation_role` | the member holds the given role |
| `is_on_council` | the member holds a council role (President, Vice President, Treasurer, Secretary, Member at Large) |
| `is_strata_manager` | the member holds Manager |
| `can_run_meetings` | Admin, Secretary, anyone given the switch, or a Super Admin |
| `can_follow_meeting` | council, managers, and meeting runners, for a launched meeting |
| `can_see_meeting_notes` | the Runner's private notes: someone who can run meetings, and once launched only the person who launched it, until the minutes are final |
| `can_see_discussions` / `can_start_discussions` | council or meeting runners / meeting runners |
| `sees_directives` | council, meeting runners, or managers |
| `can_manage_billing` | Admin, or anyone given the billing switch |
| `has_stratasphere_access` | subscribed, and council, a manager, or an Admin (or a Super Admin); never owners |
| `is_super_admin` | platform staff |

Removing someone (`status = 'removed'`) ends their access table by table (checked in 0093's tests) and deletes their Stratasphere conversations for that strata.

## 5. Owners roster

`owners_and_council`: one row per strata lot, created when the strata is approved. Fields: owner name, email, unit number, unit entitlement, owner type (`owner_occupant`, `owner_absentee`, `developer`), parking, storage, bike rack, strata fees, and the council fields (council flag, role, council member name and email). The council fields are set in the app only, never by CSV. A CSV upload (`apply_owner_roster_upload`) is previewed, matches rows by lot (forgiving formats like `SL1` or `sl 001`), updates only fields that differ, treats a blank cell as "no change", rejects the whole file on any error, and never adds or removes lots. A Super Admin lot-count change adds lots.

## 6. Documents and the knowledge base

- **`documents`:** the strata's repository, in eight folders (`legal_governance`, `financial_accounting`, `insurance`, `contracts_service_agreements`, `building_construction`, `meetings_records`, `operations`, `correspondence`). Sources: upload, agenda attachment, strata plan, historic minutes, finalized minutes. Links aren't documents (0102, `documents_no_links`): a link attached to an agenda item lives in the agenda itself. A corrected upload supersedes the old one (`supersedes_document_id`, `is_current`) rather than replacing it. Columns record indexing status (`waiting` while unsubscribed, then `pending`, `processing`, `indexed`, `failed`, `not_indexable`, `needs_text`), how the text was got (text layer or OCR, with page counts and confidence), and a content hash so identical copies are sent once. Storage is in a private bucket; any connected member can read and download.
- **`knowledge_chunks`:** stripped passages with Voyage embeddings (1,024 dimensions), in three scopes: `corporation` (the strata's own), `global_precedent` (identity-stripped copies from subscribed stratas; `source_corporation_id` kept for audit, never shown), and `legislation`. No client policies: reached only through `match_knowledge_chunks` (meaning) and the keyword search function (0095), which check `has_stratasphere_access` and never return another strata's own passages.
- **`legislation_documents`:** the Legislation Library (Acts, regulations, guidance), with "current to" dates, uploaded and indexed by Super Admins.
- **`document_exports`:** a strata's full document export.

## 7. Meetings

- **`meetings`:** type (`council`, `committee`; `agm` and `sgm` exist but aren't creatable yet), status (`DRAFT`, `LIVE`, `ADJOURNED`), date, time, time zone, format (`in_person`, `virtual`, `hybrid`), location, chair, the agenda (JSON: items with type, motion, mover, seconder, outcome, attachments (a filed document, or a link kept on the item only), a Discussion it ratifies), attendance (JSON by lot), who launched it, the agenda editor and takeover request, the item on screen, what's being shared, the Runner's last check-in, the council's own video link, and the minutes (draft, finalized, by whom).
- **Running a meeting:** `meeting_presence` (joins and leaves with times, including people the Runner marks present), `meeting_votes` (one per vote held: a copy of the motion, the eligible lots, counts once closed, locked after), `meeting_ballots` and `meeting_ballot_log` (each ballot and every change, with who pressed the button), `meeting_conflicts` (section 32 declarations, with their nature, acknowledged by the Runner), `meeting_handovers` (each change of Runner, with the reason, for the minutes), and `meeting_item_notes` (the Runner's private notes, never in minutes or sent to the AI, deleted when minutes are finalized).
- **Rules held in the database:** a vote can't open without quorum; members with an acknowledged conflict are left out of the item's votes; someone who leaves before voting stops counting; the Runner can't run an item they've declared a conflict on (it hands over); a launched meeting can be taken over after 2 minutes without a check-in. Vote and quorum thresholds follow the Act and the Standard Bylaws (PR 153).
- **Video** keeps nothing in the database: Zoom Video SDK sessions are made from a signed token at join time, and chat and raised hands live only in the session (`docs/zoom-video-sdk.md`).

## 8. Decisions, Discussions, and Directives

- **`decisions`:** the ledger: every carried motion (and imported historic decision), with the meeting, item, motion text, mover, seconder, outcome, decision type, and counts. No browse page; Stratasphere reads it, and councils see decisions in their minutes. Readable with Stratasphere access.
- **`discussions`** (with `discussion_voters`, `discussion_comments`, `discussion_files`): votes between meetings. The voters (and their lots) are fixed when it opens; once anyone has voted, the motion can't change. A motion that passes waits for ratification at a council meeting, which marks it ratified or not when that meeting adjourns. Started by meeting runners; council votes; council and meeting runners read and comment. Conflicts declared here carry into the ratifying meeting (0084).
- **`directives`** (with `directive_changes`): follow-up from carried motions and Discussions closed in favour, or added by hand. Each has a source and a unique `source_key` so generation can't duplicate, an assignee (the manager, a person, or council), a due date, and a status (`open`, `done`, `cancelled`) with who closed it and why. Meeting runners create and edit; a manager can only mark done. Not part of agendas or minutes.

## 9. Stratasphere conversations and usage

- **`conversations`, `conversation_messages`, `conversation_projects`:** strictly private to the person (`auth.uid() = user_id`, nothing else), scoped to one strata. Messages carry their citations and what the person was looking at (`focus`, a small reference, never record text). Deleted when the person is removed from the strata.
- **`stratasphere_usage`:** each answer's token use and cost per strata, which also drives the 30-an-hour limit (`stratasphere_allowed`).
- **`stratasphere_recall_cases`, `stratasphere_recall_runs`:** the recall check (server-only; the cases hold real records).

## 10. Billing

- **`subscriptions`:** one per strata: status (`active` or `deactivated`; there is no past-due state), plan (`monthly` or `annual`), Stripe IDs and raw status, lot count, activation date, the 12-month commitment end, scheduled cancellation, a plan change waiting for the anniversary, billing email and address, and complimentary access (who granted it). The Stripe webhook keeps it in sync.
- **`enterprise_requests`, `enterprise_prices`:** "Talk to us" requests, and the monthly price a Super Admin sets for a strata (month to month or a 12-month commitment).
- **`stratasphere_reactivation_requests`:** kept from the earlier design.

## 11. Training and the Library

- **Training:** `training_tracks` (with a prerequisite track and a stage, core or specialty), `training_modules` (title, summary, minutes, objectives, further reading, the blueprint, published version), `training_slides`, `training_media`, `training_music`, `training_module_versions` (published snapshots), `training_module_authors`, `training_settings`, `training_imports`, `training_progress` (per module and version), and `training_credentials` (a finished track). Progress is private; a finished track shows as "complete" to the person's strata.
- **`library_resources`:** guides, playbooks, policy templates, and forms, drafted and published by Super Admins, free to everyone signed in.

## 12. Platform tables

`announcements` (news on Home or Overview), `demo_requests`, `investors` and its related tables (decks, links, notes, time on slides), `social_posts`, `social_layouts`, `social_templates`, `email_journeys` and `email_sends` (lifecycle emails), all Super Admin only. The demo site's tables are in `supabase/demo`.

## 13. Retention and deletion

- **A strata is never deleted** by lapsing or by its members. A Super Admin can delete a test strata from the console with a typed confirmation and a preview of what goes.
- **Account deletion** (Super Admin, from the person's page): memberships, training progress and credentials, and conversations go; records made in a strata stay, with the name kept beside them.
- **Removal from a strata:** access ends and that strata's conversations are deleted; everything else stays.
- **The precedent pool** has no removal path: a corrected document supersedes its old passages instead.
- **Demo data** is deleted at midnight Pacific on the day the link was made; names and activity 7 days later.

## 14. Open questions

- AGMs and SGMs: owner access links, a voter register, proxies, quorum by votes, unit entitlement weighting, and secret ballots. The vote tables already carry weights, proxy holders, and secret ballots, unused until then.
- An audit history of roster field changes (only `updated_at` today).
- A governance calendar (a placeholder page exists; no data yet).
