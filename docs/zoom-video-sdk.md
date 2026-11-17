# Meeting video: Zoom Video SDK

Replaced the earlier Meeting SDK embed, now removed (0083).
The Meeting SDK on the web always shows Zoom's own interface (toolbar,
participants panel, waiting room, notices), and its custom interface exists
only in Zoom's native apps. The Video SDK has no Zoom interface: the panel is
ours.

## What people see

- A video panel at the top of the right-hand column in Meeting Mode and on
  the members' page: one tile per person ("Name, SL###"), their camera or
  their initials, and a muted-microphone mark.
- Controls under the video: **Mute/Unmute**, **Start/Stop camera**, **Raise
  hand** (everyone but whoever runs the meeting), **Speaker view / Gallery
  view**, **Devices**, **Larger video** (Escape or a click outside returns it
  to the column). Each tile has **Pin**, which keeps that person large on
  your own screen only. Whoever is talking gets a green outline.
- People join with the microphone off and the camera on.
- Under the video, two tabs (one open at a time, or neither):
  - **People** (replaces "In attendance"), for whoever runs the meeting and
    their co-hosts: raised hands in order, with **Ask to unmute** and
    **Lower**; **Meeting controls** (Mute everyone; Chat on or off, the
    runner only); and on each person **Mute** or **Ask to unmute**,
    **Spotlight for everyone**, **Make co-host** (only people who can run
    meetings, the same people a meeting can be handed over to; the runner
    only), and **Remove from video** (the runner only; they can rejoin).
  - **Chat**: to everyone, never privately. The runner can turn it off.
- Zoom never lets anyone unmute someone else: **Ask to unmute** sends a
  prompt, and the person chooses. Unmuting lowers your own hand. Zoom's
  own prompt reaches only someone whose sound has started; for anyone else
  (their browser held the sound back), the ask goes over the command
  channel instead, and their Unmute starts the sound as well. The People
  list shows them as "Sound not on".
- Members see only their own place in the queue ("You're 2nd"); the runner
  and co-hosts see the whole queue.
- Nothing that happens in the video is stored or minuted. Chat and hands
  live in each browser while the video does, and are gone at adjournment.
  The minutes only say the meeting's format (In person, Electronic, Hybrid).
- Not used: recording, transcription, screen sharing (the app's own **Share
  on screen** shows attachments to everyone), waiting room, Zoom's notices.

## Raised hands

They travel over Zoom's command channel, never through our database
(lib/meetings/video-room.ts). Each person keeps their own hand; the host
(the runner) keeps the order and sends it round. A queue or "lower" from
anyone but the host or a co-host is ignored. When the host joins or
rejoins, everyone with a hand up says so again and keeps their place.

## Stratasphere floats

Stratasphere isn't in the meeting's column any more. A button, bottom
right as on every page, opens a window (in a meeting, first to the left of
the People and Chat column, which leaves room under its chat box for the
button) that can be moved
by its title bar and resized from its corner, and remembers where it was
left in that browser (components/FloatingWindow.tsx). The same window is
used on every page of the site; on a phone it fills the screen. Owners
never see it.

## How it works

- Each council meeting is one session, named `live-<meeting id>` (or
  `demo-<meeting id>` on the demo site). Nothing is created on Zoom's side
  first and nothing is stored here: the session exists while people are in it.
- Nobody can join without a token our server signs (`lib/zoom/video-sdk.ts`),
  and it signs one only for someone who may follow that meeting (the same
  check as the live screens: council, the manager, runners). Tokens last 4
  hours and a fresh one is made for every join.
- Whoever runs the meeting joins as host (role 1), everyone else as a
  participant (role 0). Participants don't wait for the host.
- At adjournment the Runner's screen ends the session; every screen leaves it.
- The demo site's visitors see placeholder tiles; a Super Admin's sandbox gets
  real video. Super Admins see Zoom's own reason when the video fails.
- Audio and video use WebRTC, so the pages need no special headers.

## Region

Each token asks for Canada (`geo_regions: CA`). Zoom says the region must
also be allowed on the account; if a test shows sessions routed elsewhere,
that's the next step. `ZOOM_VIDEO_SDK_GEO_REGIONS` can name other regions,
or `none` to leave routing to Zoom.

## Cost

Zoom Build Platform (pay as you go): CA$0.0047 per participant-minute, no
monthly allowance. A council meeting of 5 for 90 minutes is 450
participant-minutes, about CA$2.12. Recording and transcription cost extra;
we never start them.

## Keys (Vercel only)

Zoom Platform Studio, **Configure, Credentials**: the Video SDK's **SDK Key**
and **SDK Secret** (not the API key and secret). In both Vercel projects
(app-stratacouncil-ca, stratacouncil-demo), Production and Preview:

| Name | Value |
| --- | --- |
| `ZOOM_VIDEO_SDK_KEY` | SDK Key |
| `ZOOM_VIDEO_SDK_SECRET` | SDK Secret |
| `ZOOM_VIDEO_SDK_GEO_REGIONS` | optional; default `CA` |

## Joining, and stepping out

Nobody joins until they press **Join with camera and microphone** (or
**sound only**): the browser asks for both at that moment. If it can't have
them, the panel shows steps for that browser and computer
(`lib/meetings/device-help.ts`) and starts by itself once they're allowed.
**Test video and audio** on the Meetings tab runs the same check before a
meeting, without joining anything.

A council member whose conflict of interest has been acknowledged (0082)
leaves the session for that item and rejoins by themselves when the meeting
moves on. The server won't sign them a token meanwhile, and the Runner's
screen removes them if they're still in. It finds them by the token's
`user_identity` (the user id without dashes).

## The Meeting SDK setup (removed)

The earlier Meeting SDK embed is gone: its code, its frame page, and the
`meeting_zoom` table (dropped in 0083). In Vercel, remove its six variables
(`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`,
`ZOOM_SDK_CLIENT_ID`, `ZOOM_SDK_CLIENT_SECRET`, `ZOOM_HOST_USERS`) from both
projects, and delete its two apps (Server-to-Server OAuth, and the General
app with Meeting SDK) in the Zoom App Marketplace. The Video SDK keys stay.
