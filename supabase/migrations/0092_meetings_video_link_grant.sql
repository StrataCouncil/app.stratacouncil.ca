-- The meetings list was empty (2026-11-12): "permission denied for table
-- meetings".
--
-- Since 0072, authenticated reads meetings column by column (every column
-- but minutes_content). 0090 added meetings.video_link without granting it,
-- so any read that names it (the Meetings page, Overview, a meeting's page)
-- was refused. This grants it, as 0073 to 0079 did for their columns.
--
-- Grants: select (video_link) on public.meetings to authenticated. Nothing
-- else changes; writes go through the existing table grants and RLS.
--
-- Safe to re-run.

grant select (video_link) on public.meetings to authenticated;
