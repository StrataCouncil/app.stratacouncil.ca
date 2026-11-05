# Zoom setup (for the account owner)

What to set up in Zoom before the Zoom PR can be tested. About 20 minutes.
Design and decisions: `docs/zoom-council-meetings.md`.

You need to be signed in to StrataCouncil's Zoom account as its owner. The
free plan is fine for testing; its meetings end at 40 minutes, so keep test
meetings short. Don't run real strata meetings on the free plan.

Keys go into Vercel only. Never paste them into chat, email, GitHub issues
or the code.

## 1. Secure the Zoom account

1. Sign in at zoom.us, then **Profile** (or **Account Profile**).
2. Turn on **Two-factor authentication** for the account owner.

## 2. Meeting settings for the account

Sign in at zoom.us, then **Settings** (left menu). These apply to every
meeting the app creates. The app also sets the most important ones on each
meeting, but set them here too so nothing slips through.

**Meeting tab**

| Setting | Set to | Why |
| --- | --- | --- |
| Waiting room | On | A member who declares a conflict is moved there; the Runner brings them back. |
| Allow participants to join before host | Off | Nobody is in the meeting before the Runner. If you can't find it, skip it: the app turns it off on every meeting it creates. |
| Require a passcode when scheduling new meetings | On | Members never see it; the app passes it for them. |
| Embed passcode in invite link | Off | The link is never shared. |
| Mask phone numbers in the participant list | On | Phone numbers are personal information. |
| Allow participants to rename themselves | Off | Names come from StrataCouncil ("Jane, SL12"). |
| Screen sharing: who can share | Host only | Members see documents through Share on Screen in StrataCouncil. |
| Chat | "By default, allow participants to chat with": No one | Keeps the meeting's record in StrataCouncil's minutes. Decided 2026-11-05; open it up later if people ask. The main Chat switch stays locked on while "Allow users to access meeting chats before and after the meeting" is on; that's fine: with No one, members can't send chat messages, though Zoom may still show its chat button. |
| Only authenticated users can join meetings from Web client | Off | Members join through StrataCouncil, not with a Zoom login; on, it would block them. |
| Approve or block entry for users from specific countries/regions | Off | A council member travelling abroad must still get in. |
| Meeting reactions, polls | Off | Votes happen in StrataCouncil. |

**Recording tab**

| Setting | Set to |
| --- | --- |
| Cloud recording | Off |
| Local recording | Off |
| Automatic recording | Off |

**AI Companion** (if shown)

| Setting | Set to |
| --- | --- |
| Meeting summary, smart recording, questions | Off |

Not shown on the free plan; the app turns summaries off on every meeting it creates anyway. Decided 2026-11-04: no recordings, transcripts or AI summaries. The minutes
are the record.

**Later, on a paid plan:** Settings, In Meeting (Advanced), **Select data
center regions for meetings/webinars hosted by your account**: Canada. Not
available on the free plan.

## 3. App 1: Server-to-Server OAuth (creates and ends meetings)

1. Go to marketplace.zoom.us and sign in with the same account.
2. **Develop** (top right) or **Developers** (lower left), then **Build App**
   (on some screens: the blue + next to Developer, then **Build an app**).
3. Choose **Server-to-Server OAuth app**, name it `StrataCouncil meetings`,
   then **Create**.
4. **App credentials:** leave this page open; you'll copy three values in
   step 5.
5. **Information:** short description ("Creates and ends StrataCouncil
   council meetings"), company name, your name and email (required).
6. **Feature:** leave Event Subscriptions off.
7. **Scopes:** **Add Scopes**, then add:

   | Scope | Plain name in the picker |
   | --- | --- |
   | `meeting:write:meeting:admin` | Create a meeting for a user |
   | `meeting:update:meeting:admin` | Update a meeting |
   | `meeting:update:status:admin` | Update a meeting's status (end it) |
   | `meeting:delete:meeting:admin` | Delete a meeting |
   | `meeting:read:meeting:admin` | View a meeting |
   | `user:read:zak:admin` | View a user's ZAK token (lets the Runner start the meeting as host) |
   | `user:read:user:admin` | View a user |

   Zoom renames scopes now and then; if one isn't listed, search for its
   plain name. If the meeting scopes don't appear at all, the free plan may
   be hiding them: tell me which ones are missing and we'll use the
   fallback (paste a Zoom meeting ID into the meeting by hand while testing).
8. **Activation:** **Activate your app**. It must say activated.

## 4. App 2: General app with Meeting SDK (Zoom inside our pages)

1. marketplace.zoom.us, **Develop**, **Build App**.
2. Choose **General App**, name it `StrataCouncil Meeting Room`, then
   **Create**.
3. **Basic Information:**
   - Choose **Admin-managed** if asked how the app is managed.
   - OAuth redirect URL: `https://app.stratacouncil.ca/` (required by the
     form; the app doesn't use it to sign anyone in).
4. **Features**, then the **Embed** tab: turn on **Meeting SDK**.
5. **Scopes:** add **User**, **View all user information**
   (`user:read:user:admin`) and describe it as "Look up the host for our own
   council meetings".
6. **Local Test**, then **Add App Now**, then **Allow**. This adds the app to
   our own account, which is all it needs: every meeting is hosted on our
   account, so Zoom's Marketplace review isn't required. Don't submit it for
   publishing.
7. Back on **Basic Information**: the app's **Client ID** and **Client
   Secret** are near the top. You'll copy them in step 5.

## 5. Keys into Vercel

Vercel, project **app-stratacouncil-ca**, Settings, Environment Variables.
Add each one for **Production** and **Preview**.

Then add the same six to the **stratacouncil-demo** project too, so Zoom
can be tested in a Super Admin sandbox without test data on the live site
(docs/demo-site.md). Only sandboxes use them; ordinary demo visitors still
see placeholder tiles. With one host licence, one meeting runs at a time
across the live site and all sandboxes together.

| Name | Value from |
| --- | --- |
| `ZOOM_ACCOUNT_ID` | App 1, App credentials, Account ID |
| `ZOOM_CLIENT_ID` | App 1, App credentials, Client ID |
| `ZOOM_CLIENT_SECRET` | App 1, App credentials, Client Secret |
| `ZOOM_SDK_CLIENT_ID` | App 2, Basic Information, Client ID |
| `ZOOM_SDK_CLIENT_SECRET` | App 2, Basic Information, Client Secret |
| `ZOOM_HOST_USERS` | The email of the Zoom user who hosts meetings. On the free plan that's the account owner. Later, with more licences, a comma-separated list. |

Then **Redeploy** the latest production deployment of each project so it picks them up.

## 6. Tell me

Reply "Zoom keys are in" (no keys, just that). Also say if any scope in
step 3 was missing, or any setting in step 2 wasn't available on the free
plan.

## Before going live with real meetings

- A paid plan and one licensed host for each meeting that may run at the
  same time.
- Canadian data center region on (step 2).
- Zoom's data processing agreement accepted for the account.
- Zoom's confirmation that our terms allow hosting customers' council
  meetings on our account.
- The privacy policy names Zoom (video and audio, may be processed outside
  Canada).
