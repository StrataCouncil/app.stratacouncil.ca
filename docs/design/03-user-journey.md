# StrataCouncil.ca: User journey

**Status:** current as of 2026-11-21. Rewritten from the October draft to describe what is built. The history of each decision is in `00-changelog.md`; the free and paid plan in full is `docs/learn-decide-remember.md`.

## Overview

One account per person, at `app.stratacouncil.ca`. The app has three top-bar sections, plus Super Admin for platform staff:

| Section | Holds | Price | Needs a strata? |
|---|---|---|---|
| **Resources** | Council Training, the Library, Forms & Templates | Free | No |
| **Your Strata** | Overview, Meetings, Discussions (with Directives), Documents, Council, Owners, Management, Billing | Free, with some features locked behind Stratasphere | Yes |
| **Stratasphere** | Ask: the AI assistant, which reads the strata's records | Paid | Yes |

Training belongs to the person; everything in Your Strata and Stratasphere belongs to a strata. A person can be connected to several stratas (their own building's council and a building where they own a rental, say). A strata switcher on every strata page moves between them: invisible with none, a label with one, a searchable list with several. "+ Connect another strata" starts the connection flow again.

Stratasphere is the name of the paid tier and its assistant only. It is for council, the strata's managers, and its admins. Owners never see it.

## 1. Marketing site (stratacouncil.ca)

A separate site and repo. It sells free training to council members and Stratasphere to councils, takes demo requests (posted to the app's `/api/demo-requests`, reviewed in the Super Admin console), and has an investor sign-up. Every form that sends email is protected by Turnstile, a mail-domain check, and a hidden field. Campaign tags a visitor arrives with are kept and saved with their sign-up.

## 2. Signing up and signing in

- **Sign-up:** name and email, a required Terms and Privacy checkbox, and an optional "Send me occasional updates" checkbox. The app emails a one-time link and code (Supabase Auth, sent through Mailtrap). No password.
- **Sign-in:** email only, link or code. Signing in never creates an account; an unknown email is told to sign up.
- **Invite or request:** an invite from a council lot ties the person to that lot and its role when they accept; an approved access request joins them with no lot or role. See `docs/joining-a-strata.md` for the order of steps after approving a council member's request.
- **Coming back to the page they were sent to:** a link to any page in the app (a Library item, say) sends someone who isn't signed in to sign-in with that page remembered (`next`). It stays with them if they go on to sign up instead, and the email's link brings them to that page, not the dashboard, whether they signed in or created an account. Someone already signed in goes straight there. Only pages on the app itself are carried.
- **Two-step authentication is optional.** Anyone can set up an authenticator app (with ten backup codes) from their account. Anyone who has set one up is asked for its code at sign-in. It isn't required at sign-up or for connecting to a strata; requiring it is a decision for when there are paying customers.
- **Landing page:** Council Training.
- **Lifecycle emails:** a new sign-up gets a short series of factual setup tips. Product news goes only to people who opted in. The account page has a switch for each kind, and every email has a one-click unsubscribe for its kind (CASL, on top of PIPA). Sign-in links, invitations, and meeting and Discussion emails are always sent.

## 3. Council Training (free)

Five tracks:

1. **Strata Basics** (core): open to everyone.
2. **Council Ready** (core): eight modules, opens after Strata Basics.
3. **Treasurer**, **Secretary**, **Privacy Officer** (specialty): open once Council Ready is done.

Within a track, modules go in order: slides with narration, knowledge checks inside the slides, and a scenario check at the end of each module. There's no exam. Finishing a track shows "complete" beside the person's name on their strata's Council page, a gentle nudge rather than a requirement. Partial progress stays private. Managers aren't nudged toward training (a licensed manager has their own credentialing), but they can take it.

Modules are written in the Super Admin training builder: settings and a step-by-step blueprint, then Create slides (AI drafts, the author reviews), pictures, narration, and publish. The Legislation Library feeds the drafting so the law is quoted, not remembered.

## 4. Connecting to a strata (free)

The connect page starts with a strata plan number lookup:

- **Found:** the person asks to join. An admin of that strata approves or turns it down; the person is emailed either way.
- **Not found:** the person creates it. They upload the strata plan; the app reads the plan number, legal name, address and lot count (OCR for scans, then AI); a mismatch with what they typed is flagged. They add the building name, confirm the civic address from a lookup, and attest that they can act for the strata. A Super Admin reviews the request. On approval the strata exists, the requester is its admin, every lot is pre-created on the Owners page, and the plan is filed in Documents.
- **Invited:** an admin invites by email. The link signs the person in (creating the account if needed) and connects them in one step; a new person is asked only for their name. Invites expire after 7 days, and the admin is emailed when one is accepted. Inviting a council member already typed on the Owners page ties them to that lot and role when they accept. Managers are invited the same way.

There is no seat limit. Strata creation is reviewed because a strata's records carry real weight; the attestation is what creates accountability.

## 5. Inside a strata (free)

- **Overview:** the strata's dashboard: news from StrataCouncil.ca, getting-started steps for admins, what needs attention (join requests, unaccepted invites, empty officer roles), counts, the next meeting, the latest minutes, council offices, and strata details. Admins edit the building name, address, and fiscal year here; Super Admins also edit the legal name, jurisdiction, and lot count. Every change is logged.
- **Council:** members and their roles: President, Vice President, Treasurer, Secretary (one each; President and Vice President must be different people, Standard Bylaw 13(2)), any number of Members at Large, Manager, and Admin. Roles stack. "Can run meetings" is a switch the admin gives to anyone; the secretary and admin have it by role. Billing access is another switch. Training completion shows here.
- **Owners:** one row per strata lot: owner, contact, unit, entitlement, owner type, parking, storage, bike rack, fees, and council flag. A CSV upload changes only fields that differ and never clears a field from a blank cell; it's previewed before it's applied. Downloading the roster is admin-only.
- **Meetings:** council and committee meetings, unlimited (AGMs and SGMs are coming soon and will be paid). Build the agenda (one editor at a time, with takeover), launch, and run it in Meeting Mode: attendance with join and leave times, quorum, each item's motion with mover and seconder, live voting from members' own screens, conflicts of interest under section 32, chair election, Share on screen, and handover so a launched meeting is never left without someone running it. Minutes are written in the app, exported as Word, and finalized as a PDF filed in Documents. A free strata can add its own Zoom, Teams, or Meet link; built-in video is part of Stratasphere.
- **Discussions:** council votes between meetings. Someone who runs meetings starts one (with or without a vote); council votes For, Against, Abstain, or declares a conflict; members comment, and can vote from the email. A motion that passes is ratified at the next council meeting. Discussions are council's and meeting runners'; owners don't see them.
- **Directives:** the follow-up list, beside Discussions. Carried motions that call for action, and Discussions that close in favour, become directives automatically; meeting runners add others by hand. Stratasphere words them on a subscription; otherwise they use the motion's words. Managers see them and mark them done.
- **Documents:** the strata's repository, in folders. Every connected member uploads, browses, and downloads, free, subscribed or not. Reading and searching documents is Stratasphere's part.
- **Management:** the strata management company's details and logo, printed at the top of agendas and minutes (admins and managers only).
- **Billing:** admins and billing contacts only.

The Library and Forms & Templates (in Resources) are free to everyone signed in. Every item is written and published by Super Admins in the console; templates and forms download as Word, blank, for council to fill in. Each item has Share (the device's share sheet where the browser has one, otherwise the link copied) and Print (just the item, then its legislation and its address; the browser's dialog also saves a PDF). A shared link brings someone without an account through sign-up and back to the item.

## 6. Subscribing to Stratasphere (paid)

From Billing, or from any locked feature, an admin or billing contact subscribes in one dialog:

1. **Plan:** Monthly ($30 a strata plus $3 a lot, cancel any month) or Yearly ($25 plus $2.50 a lot, a 12-month commitment, billed monthly). GST on top. The lot count comes from the strata plan, never typed.
2. **Billing details:** billing contacts, and a billing address (defaulting to the building's address).
3. **Review:** plan, lots, the monthly charge with GST, and the commitment wording.
4. **Payment:** Stripe's form inside the dialog: pre-authorized debit from the strata's bank account (recommended, a business PAD) or a card. A typed-in bank account waits on two micro-deposits; Billing shows "Verify the bank account" until it's done.

While a first payment is pending, locked features say "Subscription pending". Non-admins can ask for a subscription, which emails the admins. A strata whose monthly charge would be over Stripe's $3,000 limit, and any management company, gets "Talk to us" instead (Enterprise: a price set by a Super Admin, or complimentary).

**What subscribing unlocks:** Ask (the assistant, standalone and floating on every strata page, and inside Meeting Mode), document reading and search (meaning and exact words, OCR for scans), the decision ledger behind the scenes, historic minutes import, built-in meeting video, and AI drafting (motion wording, reading an uploaded agenda, Directive wording). Documents stored while unsubscribed are read on subscribing.

## 7. Cancelling and lapsing

Monthly stops at the end of the month; Yearly keeps billing and access through its 12 months, then doesn't renew. A failed payment ends access. Either way the strata goes back to the free plan: every document, meeting, minute, and Discussion stays, and nothing is deleted. Past Stratasphere conversations stay saved and private, readable again on resubscribing, and the person can delete them any time.

## 8. Leaving

- **Removed from a strata:** the person keeps their account and training; they lose that strata, and their Stratasphere conversations for it are deleted.
- **Account deletion:** done by a Super Admin from the person's page in the console, with a typed confirmation. Records the person made in a strata (documents, minutes, votes) stay, with their name kept beside them; their memberships, training progress, and conversations go.

## 9. The demo site (demo.stratacouncil.ca)

The same app with demo mode on and its own database (`docs/demo-site.md`). A Super Admin sends a personal link from the live console. The link creates the person's own copy of a fictional strata, Larchwood Commons, with them as president and admin, a fictional council that votes and joins meetings, sample documents, minutes, Discussions and Directives, and sample meeting video (with a button to show their own camera on their own screen). It lasts until midnight Pacific, then everything is deleted. Super Admins also get sandboxes there, with real video, for testing off the live site.

## 10. Super Admin console

Platform staff only: strata creation requests, every strata (and acting in any of them), users and their activity, announcements, the Library and Legislation Library, the training builder, demo links and requests, investors, Enterprise pricing, the Stratasphere recall check, and Marketing (Socials and Emails).

## Open questions

- AGMs and SGMs: owner links, voter register, proxies, quorum by votes, and scale. Designed, not built.
- Phone layout for meeting attendees.
- Requiring two-step authentication, and whether by SMS, once there are paying customers.
