-- Council Training: tracks, modules built from sections, screens and blocks, published
-- versions, learner progress and credentials. Safe to run more than once.
-- Run the whole file in one go.
--
-- There is no pass or fail. A module is complete once the learner has gone
-- through every screen; knowledge checks and scenarios give feedback but
-- any answer counts. A credential is a record that the learner finished
-- every module in a track. It only exists inside StrataCouncil.ca (their
-- training page, and Council & Roles for strata-mates): no certificate
-- number, nothing to download or share.
--
-- How content works:
--   A module's sections, screens and blocks are one JSON document (lib/training/content.ts
--   defines and validates it). Super Admins edit a draft
--   (training_module_drafts, never visible to learners) and publish it as a
--   numbered, immutable version (training_module_versions). Learners always
--   see the latest published version; progress records which version it was
--   made against, so publishing a revision never wipes anyone's progress or
--   takes back a credential.
--
-- Who sees what:
--   - Tracks, module outlines and published versions: any signed-in user
--     (Council Training is free and belongs to the person, not a strata).
--   - Drafts: Super Admins, and Authors on the modules they're assigned to.
--     An Author sees nothing else of the app's data; publishing stays with
--     Super Admins (an Author marks a draft ready for review).
--   - Progress: the learner only.
--   - Credentials: the learner, anyone they share an active strata with
--     (doc01 §3a: councils see who holds which credential, never quiz
--     detail), and Super Admins.
--   Progress and credentials are only written by the functions below.

-- ── Tables ─────────────────────────────────────────────────────────────
create table if not exists public.training_tracks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- 'mal' | 'president' | 'vice_president' | 'treasurer' | 'secretary'
  title text not null,
  description text not null default '',
  jurisdiction text,                         -- null = universal
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.training_modules (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.training_tracks(id) on delete cascade,
  order_index int not null default 0,
  title text not null,
  summary text not null default '',
  estimated_minutes int,
  published_version int not null default 0,  -- 0 = never published (learners see "Coming soon")
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists training_modules_track_idx on public.training_modules (track_id, order_index);

create table if not exists public.training_module_drafts (
  module_id uuid primary key references public.training_modules(id) on delete cascade,
  content jsonb not null default '{"objectives":[],"sections":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  ready_for_review_at timestamptz             -- set by an Author; cleared on publish
);

-- Authors: people (not necessarily Super Admins) who build specific modules.
create table if not exists public.training_module_authors (
  module_id uuid not null references public.training_modules(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles(id),
  primary key (module_id, user_id)
);

create table if not exists public.training_module_versions (
  module_id uuid not null references public.training_modules(id) on delete cascade,
  version int not null,
  content jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id),
  primary key (module_id, version)
);

create table if not exists public.training_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade,
  version int not null,
  completed_sections text[] not null default '{}',
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table if not exists public.training_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.training_tracks(id) on delete cascade,
  issued_at timestamptz not null default now(),
  unique (user_id, track_id)
);

-- In case an early draft of this migration was run.
alter table public.training_credentials drop column if exists certificate_number;
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'training_progress' and column_name = 'completed_lessons') then
    alter table public.training_progress rename column completed_lessons to completed_sections;
  end if;
end $$;
drop function if exists public.complete_training_lesson(uuid, int, text);

grant select, insert, update, delete on
  public.training_tracks, public.training_modules, public.training_module_drafts, public.training_module_authors
  to authenticated;
grant select on public.training_module_versions, public.training_progress, public.training_credentials to authenticated;
grant all on
  public.training_tracks, public.training_modules, public.training_module_drafts, public.training_module_authors,
  public.training_module_versions, public.training_progress, public.training_credentials
  to service_role;

alter table public.training_tracks enable row level security;
alter table public.training_modules enable row level security;
alter table public.training_module_drafts enable row level security;
alter table public.training_module_authors enable row level security;

create or replace function public.can_author_training_module(p_module_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_super_admin() or exists (
    select 1 from public.training_module_authors
    where module_id = p_module_id and user_id = auth.uid()
  );
$$;
alter table public.training_module_versions enable row level security;
alter table public.training_progress enable row level security;
alter table public.training_credentials enable row level security;

-- ── Policies ───────────────────────────────────────────────────────────
drop policy if exists "signed-in users read tracks" on public.training_tracks;
create policy "signed-in users read tracks" on public.training_tracks
  for select to authenticated using (true);
drop policy if exists "super admin manages tracks" on public.training_tracks;
create policy "super admin manages tracks" on public.training_tracks
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "signed-in users read modules" on public.training_modules;
create policy "signed-in users read modules" on public.training_modules
  for select to authenticated using (true);
drop policy if exists "super admin manages modules" on public.training_modules;
create policy "super admin manages modules" on public.training_modules
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "super admin manages drafts" on public.training_module_drafts;
drop policy if exists "authors read their drafts" on public.training_module_drafts;
create policy "authors read their drafts" on public.training_module_drafts
  for select to authenticated using (public.can_author_training_module(module_id));
drop policy if exists "authors edit their drafts" on public.training_module_drafts;
create policy "authors edit their drafts" on public.training_module_drafts
  for update to authenticated
  using (public.can_author_training_module(module_id))
  with check (public.can_author_training_module(module_id));
drop policy if exists "super admin creates and deletes drafts" on public.training_module_drafts;
create policy "super admin creates and deletes drafts" on public.training_module_drafts
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists "authors see their own assignments" on public.training_module_authors;
create policy "authors see their own assignments" on public.training_module_authors
  for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
drop policy if exists "super admin assigns authors" on public.training_module_authors;
create policy "super admin assigns authors" on public.training_module_authors
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "signed-in users read published modules" on public.training_module_versions;
create policy "signed-in users read published modules" on public.training_module_versions
  for select to authenticated using (true);

drop policy if exists "learners read their own progress" on public.training_progress;
create policy "learners read their own progress" on public.training_progress
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "credentials visible to holder, strata-mates and super admins" on public.training_credentials;
create policy "credentials visible to holder, strata-mates and super admins" on public.training_credentials
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1
      from public.corporation_memberships me
      join public.corporation_memberships them on them.corporation_id = me.corporation_id
      where me.user_id = auth.uid() and me.status = 'active'
        and them.user_id = training_credentials.user_id and them.status = 'active'
    )
  );

-- Only the functions below write versions, progress and credentials.
revoke insert, update, delete on public.training_module_versions from authenticated;
revoke insert, update, delete on public.training_progress from authenticated;
revoke insert, update, delete on public.training_credentials from authenticated;

-- ── Publishing ─────────────────────────────────────────────────────────
create or replace function public.publish_training_module(p_module_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content jsonb;
  v_version int;
begin
  if not public.is_super_admin() then
    raise exception 'Only platform staff can publish training.';
  end if;

  select content into v_content from public.training_module_drafts where module_id = p_module_id;
  if v_content is null or jsonb_array_length(coalesce(v_content -> 'sections', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one section before publishing.';
  end if;

  select published_version + 1 into v_version from public.training_modules where id = p_module_id for update;
  if v_version is null then
    raise exception 'Module not found.';
  end if;

  insert into public.training_module_versions (module_id, version, content, published_by)
  values (p_module_id, v_version, v_content, auth.uid());

  update public.training_modules
    set published_version = v_version, published_at = now()
    where id = p_module_id;
  update public.training_module_drafts set ready_for_review_at = null where module_id = p_module_id;

  return v_version;
end;
$$;

-- ── Learner progress ───────────────────────────────────────────────────
-- Marks one section of a published version complete (the player calls this
-- when the learner moves past its last screen). When every section of that
-- version is done the module is complete; when every module in the
-- track is published and complete, the track's credential is issued (once).
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
    from jsonb_array_elements(v_content -> 'sections') l;
  if not (p_section_id = any(v_section_ids)) then
    raise exception 'That section isn''t part of the module.';
  end if;

  insert into public.training_progress (user_id, module_id, version, completed_sections)
  values (auth.uid(), p_module_id, p_version, array[p_section_id])
  on conflict (user_id, module_id) do update
    set completed_sections = case
          -- Progress made against an older version starts fresh on the new one,
          -- except that a completed module stays completed.
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

  select m.track_id into v_track
    from public.training_modules m
    where m.id = p_module_id;

  -- The credential needs every module in the track: published, and done.
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

revoke all on function public.can_author_training_module(uuid) from public;
grant execute on function public.can_author_training_module(uuid) to authenticated;
revoke all on function public.publish_training_module(uuid) from public;
revoke all on function public.complete_training_section(uuid, int, text) from public;
grant execute on function public.publish_training_module(uuid) to authenticated;
grant execute on function public.complete_training_section(uuid, int, text) to authenticated;

-- ── Media (images, slides, video files) ────────────────────────────────
-- Public read: training content isn't private, and public URLs keep pages
-- fast. Uploads go through a server action that checks Super Admin.
insert into storage.buckets (id, name, public, file_size_limit)
values ('training-media', 'training-media', true, 524288000)
on conflict (id) do nothing;

-- ── The five tracks (no modules yet: the curriculum is built in the ──
-- Module Builder). Codes are fixed; titles and descriptions are editable.
insert into public.training_tracks (code, title, description, order_index) values
  ('mal', 'General Council', 'What every council member needs to know: responsibilities, decisions, meetings, bylaws and working with owners.', 1),
  ('president', 'President', 'Chairing meetings, setting agendas and leading council.', 2),
  ('vice_president', 'Vice President', 'Stepping in for the president and sharing officer duties.', 3),
  ('treasurer', 'Treasurer', 'Budgets, the contingency reserve fund, levies, insurance and reporting.', 4),
  ('secretary', 'Secretary', 'Minutes, records, notices and running meetings in Stratasphere.', 5)
on conflict (code) do nothing;
