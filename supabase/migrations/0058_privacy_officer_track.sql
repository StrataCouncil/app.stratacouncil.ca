-- Council Training: a Privacy Officer specialty track (2026-10-18).
--
-- Opens once Council Ready is done, after Treasurer and Secretary. It starts
-- empty: its modules are added in the console. Until one is published,
-- learners see it as coming soon.
--
-- Safe to re-run: an existing track (and any edits to it) is left alone.

insert into public.training_tracks (code, title, description, stage, order_index, requires_track_id)
select 'privacy_officer', 'Privacy Officer',
  'Learn how to protect owners’ personal information, understand BC’s privacy requirements (including PIPA), and oversee how the strata collects, uses, stores, and shares information. Understand the Privacy Officer’s responsibilities, how to respond to privacy concerns or breaches, and how to build practical privacy practices into the strata’s day-to-day operations.',
  'specialty', 5, t.id
from public.training_tracks t
where t.code = 'council_ready'
on conflict (code) do nothing;
