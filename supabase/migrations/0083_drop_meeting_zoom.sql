-- 0083: remove the Meeting SDK's table.
--
-- Meeting video moved to the Zoom Video SDK (docs/zoom-video-sdk.md), which
-- creates nothing on Zoom's side and stores nothing here: a session exists
-- while people are in it. The meeting_zoom table (0080) held the Zoom
-- meetings the old Meeting SDK embed created, and nothing reads or writes it
-- any more. Its rows were server-only bookkeeping (meeting numbers and
-- passcodes for meetings that have ended), with no strata records in them.
--
-- No grants change: the table and its indexes go with it. Safe to re-run.

drop table if exists public.meeting_zoom;
