-- Council Training background music (2026-10-06).
--
-- training_music: a shared library of music for slides, kept in
-- training-media/music/. A track is either created with ElevenLabs Music
-- (from a description) or uploaded (for example, a track licensed from
-- the ElevenLabs Music Marketplace and downloaded). Any slide can use any
-- track, so a piece is made or uploaded once and reused.
--
-- A slide uses a track through training_media, as role 'music' with
-- source 'library'. Taking music off a slide (or deleting the slide)
-- never deletes the library file; only removing it from the library does.
--
-- Readable by Super Admins and Authors; written by the server after its
-- checks. Safe to re-run. Paste the whole file into an empty SQL editor tab.

create table if not exists public.training_music (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  source text not null check (source in ('elevenlabs', 'upload')),
  path text not null unique,
  url text not null,
  duration_seconds int,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists training_music_created_idx on public.training_music (created_at desc);

alter table public.training_music enable row level security;
drop policy if exists "builders read the music library" on public.training_music;
create policy "builders read the music library" on public.training_music
  for select to authenticated using (
    public.is_super_admin() or exists (select 1 from public.training_module_authors where user_id = auth.uid())
  );
revoke insert, update, delete on public.training_music from authenticated;
grant select on public.training_music to authenticated;
grant all on public.training_music to service_role;

-- Slides can now have background music from the library.
alter table public.training_media drop constraint if exists training_media_role_check;
alter table public.training_media add constraint training_media_role_check check (role in ('visual', 'narration', 'music'));
alter table public.training_media drop constraint if exists training_media_source_check;
alter table public.training_media add constraint training_media_source_check check (source in ('upload', 'unsplash', 'link', 'library'));
alter table public.training_media add column if not exists music_id uuid references public.training_music(id) on delete cascade;
