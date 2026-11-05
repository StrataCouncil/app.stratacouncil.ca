-- 0080: the Zoom meeting behind an electronic or hybrid council meeting.
--
-- One row per Zoom meeting the app creates on StrataCouncil's own Zoom
-- account (docs/zoom-council-meetings.md). Members never see the meeting
-- number or passcode: only the server reads this table (service role),
-- after checking the person may follow the meeting, and hands the browser
-- what Zoom needs to join.
--
-- A Zoom host licence runs one meeting at a time, so a host can be on only
-- one meeting that hasn't ended (the unique index); if Zoom's free plan
-- cuts a meeting off, the Runner restarts the video and a new row replaces it.
-- Safe to re-run.

create table if not exists public.meeting_zoom (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  zoom_meeting_id text not null,
  passcode text not null default '',
  host_email text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists meeting_zoom_meeting_idx on public.meeting_zoom (meeting_id, id);
create unique index if not exists meeting_zoom_one_open_per_meeting on public.meeting_zoom (meeting_id) where ended_at is null;
create unique index if not exists meeting_zoom_one_open_per_host on public.meeting_zoom (lower(host_email)) where ended_at is null;

alter table public.meeting_zoom enable row level security;
-- No policies: nobody signed in reads or writes it; the server does.
revoke all on public.meeting_zoom from public, anon, authenticated;
grant all on public.meeting_zoom to service_role;
