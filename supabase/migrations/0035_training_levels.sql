-- Council Training: levels and specialty tracks (curriculum map, 2026-10-06).
--
-- Four tracks replace the original five:
--   Strata Basics -> Council Ready (the core, about 2 hours)
--   Treasurer, Secretary (specialty tracks, open once Council Ready is done)
-- President and Vice President are folded into Council Ready: any modules
-- in them move to the end of Council Ready before the tracks are removed.
--
-- Also: a cover photo per module (the first screen's photo, recorded on
-- publish) for the training overview page.
--
-- Safe to re-run.

alter table public.training_tracks
  add column if not exists requires_track_id uuid references public.training_tracks(id) on delete set null,
  add column if not exists stage text not null default 'core';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'training_tracks_stage_check') then
    alter table public.training_tracks
      add constraint training_tracks_stage_check check (stage in ('core', 'specialty'));
  end if;
end $$;

alter table public.training_modules
  add column if not exists cover jsonb;

-- General Council becomes Council Ready (keeps its id, modules and progress).
update public.training_tracks set code = 'council_ready'
where code = 'mal'
  and not exists (select 1 from public.training_tracks where code = 'council_ready');

insert into public.training_tracks (code, title, description, order_index) values
  ('strata_basics', 'Strata Basics', '', 1),
  ('council_ready', 'Council Ready', '', 2),
  ('treasurer', 'Treasurer', '', 3),
  ('secretary', 'Secretary', '', 4)
on conflict (code) do nothing;

-- Move any modules left in the old tracks to the end of Council Ready (a
-- re-run of 0033 seeds General Council again, so it's folded in here too).
with target as (
  select id from public.training_tracks where code = 'council_ready'
), moving as (
  select m.id,
         row_number() over (order by t.order_index, m.order_index) as n
  from public.training_modules m
  join public.training_tracks t on t.id = m.track_id
  where t.code in ('mal', 'president', 'vice_president')
), base as (
  select coalesce(max(m.order_index), 0) as top
  from public.training_modules m
  where m.track_id = (select id from target)
)
update public.training_modules m
set track_id = (select id from target),
    order_index = (select top from base) + moving.n
from moving
where m.id = moving.id;

delete from public.training_tracks where code in ('mal', 'president', 'vice_president');

update public.training_tracks set
  title = 'Strata Basics', stage = 'core', order_index = 1, requires_track_id = null,
  description = 'How a strata works: what you own, who decides what, and where the money goes.'
where code = 'strata_basics';

update public.training_tracks set
  title = 'Council Ready', stage = 'core', order_index = 2,
  requires_track_id = (select id from public.training_tracks where code = 'strata_basics'),
  description = 'What makes an effective council member: your duties, meetings and votes, bylaws and disputes, repairs and insurance, and records.'
where code = 'council_ready';

update public.training_tracks set
  title = 'Treasurer', stage = 'specialty', order_index = 3,
  requires_track_id = (select id from public.training_tracks where code = 'council_ready'),
  description = 'Financial statements, the budget, the reserve fund and depreciation report, and collections.'
where code = 'treasurer';

update public.training_tracks set
  title = 'Secretary', stage = 'specialty', order_index = 4,
  requires_track_id = (select id from public.training_tracks where code = 'council_ready'),
  description = 'Notices and agendas, minutes, records and owner requests, and correspondence.'
where code = 'secretary';

-- Covers for modules already published: the first screen's photo.
update public.training_modules m
set cover = jsonb_build_object(
  'src', s -> 'image' ->> 'src',
  'alt', coalesce(s -> 'image' ->> 'alt', ''),
  'credit', coalesce(s -> 'image' -> 'credit', 'null'::jsonb)
)
from public.training_module_versions v,
     lateral (
       select sc as s
       from jsonb_array_elements(v.content -> 'sections') with ordinality sec(x, i),
            jsonb_array_elements(sec.x -> 'screens') with ordinality scr(sc, j)
       where coalesce(sc -> 'image' ->> 'src', '') <> ''
       order by sec.i, scr.j
       limit 1
     ) first_photo
where v.module_id = m.id
  and v.version = m.published_version
  and m.published_version > 0
  and m.cover is null;
