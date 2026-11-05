# Zoom council meetings (design)

Status: agreed direction, 2026-10-26; updated 2026-11-04. Live voting
(below) is built without Zoom (migration 0073); the Zoom parts aren't built
yet. Test in a sandbox on the demo site (docs/demo-site.md). Read this before starting the work.

## Decisions so far

- **Laptops and desktops first** (2026-11-05). Phones come later: audio
  only, as few taps as possible from the launch email; sign-in on a phone
  (email links, authenticator) is the hard part. Until then the members'
  page stays behind the "Desktop required" notice on phones.
- **Testing on the free Zoom plan** (2026-11-05); paid plan with the first
  paying customer or investment. Setup steps: `docs/zoom-setup.md`.
- **When the Zoom meeting is created** (built 2026-11-05, 0080): when the
  Runner first opens Meeting Mode for a launched Electronic or Hybrid
  meeting, on a free host licence (`ZOOM_HOST_USERS`), not when the meeting
  is scheduled. Members never need the link, so nothing is gained by making
  it earlier, and a host licence is only held while the meeting runs. It
  ends at adjournment. If Zoom cuts it off (free plan: 40 minutes), the
  Runner restarts the video and members rejoin. Zoom runs in its own frame
  (`public/zoom-frame.html`, Component View from Zoom's CDN) because the
  SDK needs React 18. The Runner's screen admits people from the waiting
  room as they arrive. Conflicts holding a member in the waiting room come
  with step 3.
- **Demo site:** no Zoom. Video tiles with each person's initials and name,
  and "Video appears here".

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
- **No Zoom AI summaries, recordings or transcripts** (decided 2026-11-04):
  the tool is procedural; the minutes and the decision ledger are the record.
- A "Distribute minutes" button emails approved minutes.
- Vote and quorum math was corrected first (PR 153, `lib/meetings/rules.ts`).
- **Build for general meetings from the start** (2026-11-04): council
  meetings first, but votes are stored per lot with a weight, a proxy-holder
  column and a secret-ballot flag, so AGMs and SGMs (notices, proxies,
  voting per lot) don't need a rewrite.
- **Live voting, decided 2026-11-04 and built in 0073:**
  - Council members vote For / Against / Abstain on their own screens and can
    change their vote until the vote closes.
  - The runner sees each vote by name as it comes in and can enter a vote for
    anyone (on the phone, or in the room without a device). They can change
    their own vote and votes they entered for others, never one a member cast
    themselves. Every ballot and change is logged with who pressed it.
  - Members see only their own vote while it's open, and the result after it
    closes. The final count is what matters.
  - Only council members vote. The runner votes when they're on council; a
    manager or anyone else following has no vote.
  - Someone present who doesn't vote is recorded as abstaining (same effect
    under SB 18(1)); the runner is warned before closing.
  - Conflict of interest: the member is **recused**, not abstaining. They're
    left out of "present" for that item's votes (a council vote needs a
    majority of members present, so counting them as an abstention would act
    as a vote against). The minutes say the lot declared a conflict, left for
    the item and didn't vote. With Zoom, declaring moves them to the waiting
    room; the runner admits them back.
- **Meeting Mode layout:** the runner keeps today's Meeting Mode (agenda,
  item details, attachments, motion, notes, assistant); Zoom video docks at
  the top of the right column, above the assistant. Members get the same
  layout read-only, following the runner's current item, with their own
  Stratasphere assistant collapsed by default; while it's collapsed the
  video tiles stack down the right column. Private notes stay the runner's
  (written beforehand in the agenda builder by anyone who can run meetings).
- **Creating the Zoom meeting** happens from the meeting's page and agenda
  builder: choosing Electronic or Hybrid creates the Zoom meeting on our
  account. Members never see the link or passcode.
- **Phone voting:** Zoom can't read keypad presses from phone participants,
  and they can't use polls. For council, the runner enters phone members'
  votes. Keypad voting (press 1/2/3) means putting our own phone number in
  front of Zoom (Twilio or similar: PIN, then bridged into the meeting);
  prove it with a small spike before general meetings, where it matters.

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
   room on. Built ahead of Zoom (0074): launching emails council and the
   manager a Join meeting link, and Join meeting shows in the Meetings tab
   from launch (before Call to Order). Joining records the time and marks
   the council lot present; Leave records the exit time; anyone can rejoin.
   The operator can mark someone as having left only by typing "Left
   meeting", and can mark someone present (on the phone, in the room) at any
   time, which records the time the same way (0075). Leaving before Call to
   Order just clears the lot. During an open vote, someone who leaves
   without having voted drops out of it (a ballot already cast stands),
   someone who arrives can vote, and the vote can't close without quorum. Someone who has left no longer counts for quorum, and no vote
   can open or decision be confirmed without quorum. Arrivals and departures
   after Call to Order go in the minutes.
3. **Meeting room.** Component View video on one side, agenda on the other.
   The operator has the Meeting Mode controls plus Open vote / Close vote;
   members see the current item and three vote buttons while a vote is
   open. Live updates through Supabase Realtime; each vote is one row,
   immutable once the vote closes.
4. **Quorum and decisions** use `quorum()` and `evaluateVote()`. Vote totals
   fill the tally; the operator still confirms the decision. The minutes say
   "unanimous" whenever every vote was in favour. In an open vote, All in
   favour (0076) sets For for everyone who hasn't voted themselves, unless
   someone has voted Against on their own screen. Each item has a
   collapsed Procedure (introduce, conflicts, motion, discussion, open the
   vote, close and record), and buttons stay off until their step is
   reached. Defer is offered instead of opening a vote. Close vote opens a
   box with the result: confirm it as carried or defeated, or go back to
   the vote (it only closes when confirmed). A deferred item is voted on
   afresh. Discussion items are marked Discussed and information items
   Received (or deferred); neither needs a vote. Losing quorum shows on every screen and locks votes and
   decisions until it's back; the operator can wait, defer or adjourn.
   Attachments: Share on screen (0076) puts one on every member's screen
   over the agenda, independent of Zoom.
5. **Conflict of interest.** Declared by the member or recorded by the
   operator: `putOnHold(userId, true)` moves them to the waiting room, their
   buttons disappear, they're left out of "members present" for that item,
   then `putOnHold(userId, false)` brings them back. The declaration goes in
   the minutes. Its nature is required (0074), and the member's screen
   shows that they've stepped out until the meeting moves on. Procedural
   items (Call to Order, approving the agenda or minutes, electing a chair,
   Next Meeting, Adjournment) take no conflict.
6. **Distribute minutes.** Email approved minutes to every lot's address,
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
  Streams (paid Developer Pack credits). We don't use AI Companion summaries
  (decided 2026-11-04), and AI Companion is off on the host account.

### REST API and webhooks

- Server-to-Server OAuth app (account ID, client ID, client secret) for
  account-level calls. Create meetings with `POST /users/{userId}/meetings`
  (scope `meeting:write:meeting:admin`).
- Since 2026-03-15, fields omitted from Create a meeting inherit the
  account's settings. Set what we rely on explicitly: `waiting_room`,
  `join_before_host: false`, `auto_recording: "none"`,
  `auto_start_meeting_summary: false`.
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
- Zoom's data processing agreement in place; one new privacy-policy
  paragraph naming Zoom (video, possibly outside Canada).
- Summaries pass the PII stripper before anything reaches the Stratasphere
  AI; the decision ledger stays name-free.

## Build order (one PR each, with tests)

0. Live voting without Zoom (built, migration 0073).
1. Zoom setup: server libs (S2S token, create meeting, SDK signature), host
   pool, meeting fields (migration, safe to re-run, grants stated); creating
   the Zoom meeting from the meeting page and agenda builder.
2. Meeting room: embedded video beside the agenda, member join, attendance.
3. Live voting and conflicts, audit trail.
4. Distribute minutes.

## Needed from the owner before step 1

- A Zoom account: the free plan is enough for building and testing (calls
  under 40 minutes); a paid plan and host licences when the feature goes live.
- A Meeting SDK app and a Server-to-Server OAuth app; credentials in Vercel
  environment variables only.
- Zoom sales confirmation of the hosting terms.

## Open decisions

0. ~~Zoom AI transcript for Stratasphere~~ Decided 2026-11-04: no. The tool
   is procedural; Stratasphere works from the minutes and the decision ledger.
1. Owners observing (SB 17(3)): watch-only join in v1, or later?
2. ~~Phone dial-in~~ Decided: on; the runner records phone votes (keypad
   voting later, see Decisions).
3. Owner accounts now (to read minutes in the app), or with general
   meetings? Distribution can use the lot emails without them.
