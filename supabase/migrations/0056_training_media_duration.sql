-- Council Training: how long each narration lasts (2026-10-16).
--
-- A module's estimated time is now worked out when it's published, from
-- its narration and the reading and activities on each slide, instead of
-- being typed in. The length of each narration file is kept here so it's
-- measured once: when ElevenLabs makes it, or at the next publish for
-- audio made before this.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.training_media add column if not exists duration_seconds numeric;
