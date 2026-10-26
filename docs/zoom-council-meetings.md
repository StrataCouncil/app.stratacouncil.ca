# Zoom council meetings (design, not built)

Status: agreed direction, 2026-10-26. Nothing here is built yet. Read this
before starting the work.

## Decisions so far

- Zoom is the video only. The agenda, attendance, motions, votes, decisions
  and minutes live in Stratasphere.
- **We own the Zoom account.** Meetings are created on our account and
  hosted on one of our licensed Zoom users. Joins need only our Meeting SDK
  signature (no Marketplace review, ZAK or OBF tokens, which are only for
  meetings hosted on other accounts).
- **Council meetings first.** AGM/SGM (notices to owners, proxies, voting
  rights per lot) come later; keep them in mind, don't build them.
- Whoever has permission to launch a meeting runs it, as now.
- The operator sees each vote live.
- Minutes name lots, not people.
- Zoom AI Companion summaries are a drafting aid for the minutes, never the
  minutes themselves.
- A "Distribute minutes" button emails approved minutes.
- Vote and quorum math was corrected first (PR 153, `lib/meetings/rules.ts`).

## Law that applies (council meetings)

Sources: Strata Property Act and its Schedule of Standard Bylaws (BC Laws,
current to 2026-10-20); both are in the Knowledge Base.

- Electronic council meetings are allowed (SB 17(1)); members attending
  electronically are deemed present (SB 17(2)).
- Quorum by council size (SB 16(1)): 1 member 1; 2 to 4 members 2; 5 or 6
  members 3; 7 members 4.
- Decisions by a majority of council members present (SB 18(1)); an
  abstention works like a vote against. Each council member has one vote
  (one vote per lot only if every owner is on council, SPA s.29(4)).
- Tie: the president may cast a second, deciding vote, never with only
  2 lots (SB 18(2)).
- Results of all votes go in the minutes (SB 18(3)); owners must be told
  the minutes within 2 weeks of the meeting (SB 19).
- Conflict of interest (SPA s.32): the member discloses, abstains, and
  leaves the meeting while the matter is discussed and voted on. Whether
  they still count toward quorum is a question for counsel.
- Owners may attend council meetings as observers (SB 17(3)), except
  hearings and matters that would unreasonably interfere with privacy
  (SB 17(4)).

## How a meeting runs

1. **Scheduling.** An Electronic or Hybrid council meeting creates a Zoom
   meeting on our account (REST, Server-to-Server OAuth). We keep the
   meeting number and passcode server-side; members never see them.
2. **Joining.** From the Meetings tab, signed in, on that strata's council.
   The server mints the Meeting SDK signature (role 0, 1 for the host) and
   sets the display name ("Jane, SL12") and `customerKey` (our membership
   id), so every Zoom participant maps to a known council member. Waiting
   room on.
3. **Meeting room.** Component View video on one side, agenda on the other.
   The operator has the Meeting Mode controls plus Open vote / Close vote;
   members see the current item and three vote buttons while a vote is
   open. Live updates through Supabase Realtime; each vote is one row,
   immutable once the vote closes.
4. **Quorum and decisions** use `quorum()` and `evaluateVote()`. Vote totals
   fill the tally; the operator still confirms the decision.
5. **Conflict of interest.** Declared by the member or recorded by the
   operator: `putOnHold(userId, true)` moves them to the waiting room, their
   buttons disappear, they're left out of "members present" for that item,
   then `putOnHold(userId, false)` brings them back. The declaration goes in
   the minutes.
6. **AI summary.** After the meeting: fetch the AI Companion summary,
   strip PII, store it with the meeting in Canada, delete it from Zoom,
   show it beside the minutes.
7. **Distribute minutes.** Email approved minutes to every lot's address,
   log each delivery, warn before the 2-week deadline (SB 19).

## Zoom facts (checked 2026-10-26)

### Meeting SDK for Web

- Package `@zoom/meetingsdk`, latest 6.10.0 on npm. Component View is
  `ZoomMtgEmbedded` (`@zoom/meetingsdk/embedded`); desktop browsers only
  (Client View for mobile).
- `ZoomMtgEmbedded.createClient()`, then `client.init({ zoomAppRoot, language,
  customize, ... })`, then `client.join({ signature, meetingNumber, password,
  userName, userEmail, customerKey, zak | obfToken })`.
- Signature: HS256 JWT signed with the SDK client secret; payload `appKey`,
  `mn`, `role` (0 participant, 1 host), `iat`, `exp` (at least 1800 s after
  `iat`, at most 48 h recommended), `tokenExp`.
- `Participant` (from the SDK types) has `userId`, `userName`, `isHost`,
  `isCoHost`, `isGuest`, `isPhoneUser`, `isHold`, `muted`, `audio`, and
  `customerKey`.
- Client methods: `getAttendeeslist()`, `getCurrentUser()`,
  `getCurrentMeetingInfo()`, `admit(userId)`, `admitAll()`,
  `putOnHold(userId, hold)`, `expel(userId)`, `mute(mute, userId)`,
  `muteAll()`, `rename(name, userId)`, `lockMeeting()`, `makeCoHost()`,
  `makeHost()`, `leaveMeeting()`, `endMeeting()`, `record()`.
- Events: `connection-change`, `user-added`, `user-removed`, `user-updated`,
  `active-speaker`, `caption-message`, `recording-change`,
  `chat-on-message`, among others.
- The SDK "does not support bots or AI notetakers"; that's Realtime Media
  Streams (paid Developer Pack credits). AI Companion summaries from the
  host account are a different thing and are what we use.

### REST API and webhooks

- Server-to-Server OAuth app (account ID, client ID, client secret) for
  account-level calls. Create meetings with `POST /users/{userId}/meetings`
  (scope `meeting:write:meeting:admin`).
- Since 2026-03-15, fields omitted from Create a meeting inherit the
  account's settings. Set what we rely on explicitly: `waiting_room`,
  `join_before_host: false`, `auto_recording: "none"`,
  `auto_start_meeting_summary: true`.
- Summary: `GET /meetings/{meetingUUID}/meeting_summary` (past meeting
  UUID; double-encode a UUID containing "/"). Forum reports mention scopes
  `meeting_summary:read:admin` and newer `meeting:read:summary:admin`;
  confirm in the app's scope picker. Webhook `meeting.summary_completed`.
  Forum reports of the setting not sticking and the webhook not firing:
  poll as a fallback.
- Webhooks `meeting.participant_joined` / `meeting.participant_left` exist,
  but forum reports say `customer_key` and `user_name` can be missing.
  Treat SDK events plus our own join records as the attendance source; the
  past-meeting participants report carries `customer_key` for
  reconciliation.

### Account, data and costs

- Data routing: Settings, In Meeting (Advanced), "Select data center regions
  for meetings/webinars hosted by your account" (paid accounts; data in
  transit only). Recordings and summaries may be stored in the US; in-region
  storage is Zoom Regional Infrastructure (Education and Enterprise).
- One meeting at a time per licensed host; plan caps on participants (Pro
  100).
- Confirm with Zoom sales that our terms allow hosting customers' meetings
  on our account (ISV or reseller terms).

## Privacy (PIPA)

- Zoom gets display names only. No recording. Canadian routing on.
- Join notice: AI summaries are on.
- Zoom's data processing agreement in place; one new privacy-policy
  paragraph naming Zoom (video and AI summaries, possibly outside Canada).
- Summaries pass the PII stripper before anything reaches the Stratasphere
  AI; the decision ledger stays name-free.

## Build order (one PR each, with tests)

1. Zoom setup: server libs (S2S token, create meeting, SDK signature), host
   pool, meeting fields (migration, safe to re-run, grants stated).
2. Meeting room: embedded video beside the agenda, member join, attendance.
3. Live voting and conflicts, audit trail.
4. AI summaries in the minutes view.
5. Distribute minutes.

## Needed from the owner before step 1

- A Zoom paid account with AI Companion and the host licences needed.
- A Meeting SDK app and a Server-to-Server OAuth app; credentials in Vercel
  environment variables only.
- Zoom sales confirmation of the hosting terms.

## Open decisions

1. Owners observing (SB 17(3)): watch-only join in v1, or later?
2. Phone dial-in for council members (operator verifies and records their
   vote), or off?
3. Owner accounts now (to read minutes in the app), or with general
   meetings? Distribution can use the lot emails without them.
