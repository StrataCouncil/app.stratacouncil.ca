# Bringing people into a strata: invite or request

How someone gets from "on the owner list" to "member with the right role", and the traps to watch for. Written 2026-11-28 while council members were being brought onto the platform from Library links. Nothing here is a bug report yet; these are notes for handling cases as they come in.

## The two ways in

**Invite (from a "Not invited yet" row on Council).** The row comes from a lot marked "On council" on Owners. The invite goes to the lot's council delegate email if one is set, otherwise the owner email (`lib/data/roster.ts`). The invited membership holds the lot, and accepting ties the person to that lot with its council role (`accept_corporation_invite`, migrations 0051 and 0052). It also marks any pending join request from them as approved. The invite must be accepted with the same email address it was sent to, and it expires after 7 days (resend from the row).

**Request (they create an account, type the strata plan number, and ask to join).** Approving makes them an active member with no lot and no role (`resolve_corporation_join_request`, migration 0010). Anyone who knows the plan number can request, so approve only people you can match to the owner list.

## The trap: picking a lot before giving a role

`set_member_lot` (migration 0017) ends with `sync_council_lots`, which sets a lot's council flag, role and name from the role of the active member tied to it. If an approved member with no role is tied to a council lot, that lot stops being a council lot: its typed role and council name are cleared.

Safe order after approving a request: **Edit roles first, then pick the strata lot.**

## What to do, case by case

- **They signed up with the same address as their Council row** (for example a council mailbox): don't approve the request. Click **Invite** on their Council row instead. The invite matches their existing account; accepting ties lot and role and approves the request.
- **They signed up with a different address** (for example a personal one): approve, then Edit roles, then pick the lot.
- **They haven't come in yet:** put the address they'll sign in with as the lot's council email on Owners, then Invite from Council.
- **Owners not on council:** approve, then pick their lot so attendance and votes link to it.

## The two email fields on a lot

- **Owner email**: the owner of record's contact.
- **Council delegate email**: where a council invite goes; takes priority over the owner email. Meant for a non-owner who sits on council, but works for an owner's council address too.

Neither creates an account. An account is whatever address the person signs up with.

## Role mailboxes as sign-ins

Sign-in is by a code emailed to the address, so whoever holds a role mailbox (vicepresident@, treasurer@) holds that account, including the previous holder's private Stratasphere conversations and training record. When an officer hands a role mailbox on, remove them from the strata first. Personal addresses are better for sign-ins; role mailboxes are fine for correspondence.

## Before they accept

- The Council card on Overview counts only people with accounts, so officers show "Not assigned" until they accept. The Council page shows everyone.
- Meeting Mode attendance comes from council lots, so they can be marked present. Signing in, Discussions votes, Stratasphere and training need an account.

## Possible improvements (not built)

1. **Protect the lot:** picking a member's lot would give them the lot's council role instead of clearing it, so the order wouldn't matter. One migration (`set_member_lot`, `sync_council_lots`).
2. **Rename "Council delegate email"** to "Council email" with clearer help text.
3. **Overview Council card:** show Owners-page council names with "Not invited yet", as the Council page does.
4. **Match on approval:** link an approved request to a lot whose email matches. Limited value where sign-in and lot emails differ.
