-- Council Training, rebuilt (2026-10-06): Track -> Module -> Slide -> Media.
--
-- A module is now an ordered list of slides, one row each, instead of one
-- large JSON document. Every file belongs to one slide and lives in that
-- slide's folder in the training-media bucket:
--
--   training-media/<track id>/<module id>/<slide id>/<file>
--
-- so deleting a slide or a module deletes its files, and nothing is ever
-- left lying around.
--
-- Editing works like checking a file out: "Edit module" checks the module
-- out to one person (checked_out_by), "Finished editing" checks it back
-- in. While a module is checked out, no one else can change it. Only a
-- Super Admin can release someone else's checkout (for example, if they
-- left without checking in). Writes go through the server, which checks
-- the checkout first; signed-in users can only read under RLS.
--
-- The old tables (training_module_drafts, training_imports and the old
-- published versions) are left untouched for now and removed in a later
-- migration, once the new builder has replaced them.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

-- ── Modules: objectives, further reading, voice, review, checkout ─────
alter table public.training_modules
  add column if not exists objectives jsonb not null default '[]'::jsonb,
  add column if not exists further_reading jsonb not null default '[]'::jsonb,
  add column if not exists voice jsonb,
  add column if not exists ready_for_review_at timestamptz,
  add column if not exists checked_out_by uuid references public.profiles(id) on delete set null,
  add column if not exists checked_out_at timestamptz,
  add column if not exists checkout_token uuid;

-- Objectives, further reading and voice come across from the old drafts
-- once (only while the module's own objectives are still empty). Each
-- objective gets a Bloom level from its opening verb.
update public.training_modules m
set objectives = coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', o.value,
        'bloom', case lower(split_part(o.value, ' ', 1))
          when 'name' then 'remember' when 'identify' then 'remember' when 'recognize' then 'remember'
          when 'recognise' then 'remember' when 'list' then 'remember' when 'define' then 'remember' when 'recall' then 'remember'
          when 'describe' then 'understand' when 'explain' then 'understand' when 'distinguish' then 'understand'
          when 'summarize' then 'understand' when 'tell' then 'understand'
          when 'apply' then 'apply' when 'follow' then 'apply' when 'run' then 'apply' when 'respond' then 'apply'
          when 'use' then 'apply' when 'choose' then 'apply' when 'decide' then 'apply' when 'calculate' then 'apply'
          when 'compare' then 'analyze' when 'analyze' then 'analyze' when 'check' then 'analyze' when 'organize' then 'analyze'
          when 'assess' then 'evaluate' when 'evaluate' then 'evaluate' when 'recommend' then 'evaluate' when 'judge' then 'evaluate'
          when 'prepare' then 'create' when 'draft' then 'create' when 'design' then 'create' when 'plan' then 'create'
          else 'understand' end
      ) order by o.ordinality)
      from jsonb_array_elements_text(coalesce(d.content -> 'objectives', '[]'::jsonb)) with ordinality o
      where btrim(o.value) <> ''
    ), '[]'::jsonb),
    further_reading = case
      when jsonb_typeof(d.content -> 'furtherReading') = 'array' then d.content -> 'furtherReading'
      else '[]'::jsonb end,
    voice = case when jsonb_typeof(d.content -> 'voice') = 'object' then d.content -> 'voice' else m.voice end,
    ready_for_review_at = coalesce(m.ready_for_review_at, d.ready_for_review_at)
from public.training_module_drafts d
where d.module_id = m.id
  and m.objectives = '[]'::jsonb;

-- ── Slides ─────────────────────────────────────────────────────────────
-- body: what the learner reads (40 to 50 words; a line starting "- " is a
--   bullet). narration_script: what the narrator says; narration_voiced is
--   the script the current audio was made from, so the builder can tell
--   when the audio is out of date.
-- element: at most one interactive element (knowledge check, accordion,
--   flip cards), as JSON.
-- citations: the Legislation Library sections the slide relies on,
--   [{chunkId, label}], only ever chosen from the library.
create table if not exists public.training_slides (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.training_modules(id) on delete cascade,
  position int not null default 0,
  topic text not null default '' check (char_length(topic) <= 200),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 4000),
  layout text not null default 'photo' check (layout in ('photo', 'left', 'right', 'text')),
  narration_script text not null default '' check (char_length(narration_script) <= 5000),
  narration_voiced text not null default '',
  element jsonb,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_slides_module_idx on public.training_slides (module_id, position);

-- ── Media ──────────────────────────────────────────────────────────────
-- One row per file a slide uses. role 'visual' is the slide's picture or
-- video; 'narration' is its narration audio. One of each per slide.
-- source 'upload' and 'narration' files are in the slide's folder (path);
-- 'unsplash' photos and 'link' videos (YouTube, Vimeo) are links, with no
-- file of ours.
create table if not exists public.training_media (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references public.training_slides(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade,
  role text not null check (role in ('visual', 'narration')),
  kind text not null check (kind in ('image', 'video', 'audio')),
  source text not null check (source in ('upload', 'unsplash', 'link')),
  path text,
  url text not null,
  alt text not null default '' check (char_length(alt) <= 500),
  credit jsonb,
  bytes bigint,
  created_at timestamptz not null default now(),
  unique (slide_id, role)
);
create index if not exists training_media_module_idx on public.training_media (module_id);

alter table public.training_slides enable row level security;
alter table public.training_media enable row level security;

drop policy if exists "authors read slides" on public.training_slides;
create policy "authors read slides" on public.training_slides
  for select to authenticated using (public.can_author_training_module(module_id));
drop policy if exists "authors read media" on public.training_media;
create policy "authors read media" on public.training_media
  for select to authenticated using (public.can_author_training_module(module_id));

-- Reads only: every change goes through the server, after the checkout check.
revoke insert, update, delete on public.training_slides, public.training_media from authenticated;
grant select on public.training_slides, public.training_media to authenticated;
grant all on public.training_slides, public.training_media to service_role;

-- ── Publishing ─────────────────────────────────────────────────────────
-- The server builds the published copy from the slides (lib/training/slides.ts)
-- and passes it in. Version numbers never repeat.
drop function if exists public.publish_training_module(uuid);
create or replace function public.publish_training_module(p_module_id uuid, p_content jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version int;
begin
  if not public.is_super_admin() then
    raise exception 'Only platform staff can publish training.';
  end if;
  if jsonb_typeof(p_content -> 'topics') <> 'array' or jsonb_array_length(p_content -> 'topics') = 0 then
    raise exception 'Add at least one slide before publishing.';
  end if;

  perform 1 from public.training_modules where id = p_module_id for update;
  if not found then
    raise exception 'Module not found.';
  end if;
  select greatest(
           (select published_version from public.training_modules where id = p_module_id),
           coalesce((select max(version) from public.training_module_versions where module_id = p_module_id), 0)
         ) + 1
    into v_version;

  insert into public.training_module_versions (module_id, version, content, published_by)
  values (p_module_id, v_version, p_content, auth.uid());

  update public.training_modules
    set published_version = v_version, published_at = now(), ready_for_review_at = null
    where id = p_module_id;

  return v_version;
end;
$$;
revoke all on function public.publish_training_module(uuid, jsonb) from public;
grant execute on function public.publish_training_module(uuid, jsonb) to authenticated;

-- ── Learner progress: topics are the steps ─────────────────────────────
-- Same as 0033, except a published module's steps are its topics (the
-- old format's sections are still understood).
create or replace function public.complete_training_section(p_module_id uuid, p_version int, p_section_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content jsonb;
  v_section_ids text[];
  v_done text[];
  v_track uuid;
  v_module_complete boolean;
  v_credential boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select content into v_content from public.training_module_versions
    where module_id = p_module_id and version = p_version;
  if v_content is null then
    raise exception 'That version of the module isn''t available.';
  end if;

  select coalesce(array_agg(l ->> 'id'), '{}') into v_section_ids
    from jsonb_array_elements(coalesce(v_content -> 'topics', v_content -> 'sections', '[]'::jsonb)) l;
  if not (p_section_id = any(v_section_ids)) then
    raise exception 'That section isn''t part of the module.';
  end if;

  insert into public.training_progress (user_id, module_id, version, completed_sections)
  values (auth.uid(), p_module_id, p_version, array[p_section_id])
  on conflict (user_id, module_id) do update
    set completed_sections = case
          when training_progress.version <> excluded.version and training_progress.completed_at is null
            then array[p_section_id]
          when p_section_id = any(training_progress.completed_sections)
            then training_progress.completed_sections
          else training_progress.completed_sections || p_section_id
        end,
        version = case when training_progress.completed_at is null then excluded.version else training_progress.version end,
        updated_at = now()
  returning completed_sections into v_done;

  v_module_complete := v_section_ids <@ v_done;
  if v_module_complete then
    update public.training_progress set completed_at = coalesce(completed_at, now())
      where user_id = auth.uid() and module_id = p_module_id;
  end if;

  select m.track_id into v_track from public.training_modules m where m.id = p_module_id;

  if not exists (
    select 1 from public.training_modules m
    where m.track_id = v_track
      and (m.published_version = 0 or not exists (
        select 1 from public.training_progress p
        where p.user_id = auth.uid() and p.module_id = m.id and p.completed_at is not null
      ))
  ) then
    insert into public.training_credentials (user_id, track_id)
    values (auth.uid(), v_track)
    on conflict (user_id, track_id) do nothing;
  end if;

  v_credential := exists (
    select 1 from public.training_credentials where user_id = auth.uid() and track_id = v_track
  );

  return jsonb_build_object('moduleComplete', v_module_complete, 'credentialEarned', v_credential);
end;
$$;
revoke all on function public.complete_training_section(uuid, int, text) from public;
grant execute on function public.complete_training_section(uuid, int, text) to authenticated;

-- ── Old-format publications come down ──────────────────────────────────
-- The new player only reads slides. A module whose live version is in the
-- old format shows as "Coming soon" until it's rebuilt and published.
update public.training_modules m
set published_version = 0, published_at = null, cover = null
from public.training_module_versions v
where v.module_id = m.id and v.version = m.published_version
  and m.published_version > 0
  and v.content -> 'topics' is null;
