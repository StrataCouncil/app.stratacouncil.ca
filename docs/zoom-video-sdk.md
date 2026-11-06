# Meeting video: Zoom Video SDK

Replaces the Meeting SDK embed (docs/zoom-setup.md, docs/zoom-council-meetings.md).
The Meeting SDK on the web always shows Zoom's own interface (toolbar,
participants panel, waiting room, notices), and its custom interface exists
only in Zoom's native apps. The Video SDK has no Zoom interface: the panel is
ours.

## What people see

- A video panel at the top of the right-hand column in Meeting Mode and on
  the members' page: one tile per person ("Name, SL###"), their camera or
  their initials, and a muted-microphone mark.
- Three controls: **Mute/Unmute**, **Start/Stop camera**, **Larger video**
  (Escape or a click outside returns it to the column).
- People join with the microphone off and the camera on.
- Nothing else of Zoom's: no chat, recording, transcription, screen sharing,
  waiting room, or notices.

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

## The Meeting SDK setup

Kept until the Video SDK panel is confirmed in a sandbox, then removed: the
two Zoom Marketplace apps, their six `ZOOM_*` variables, `lib/zoom/api.ts`,
`lib/meetings/video.ts`, `public/zoom-frame.html`, and the `meeting_zoom`
table (0080). Nothing calls them for video any more.
