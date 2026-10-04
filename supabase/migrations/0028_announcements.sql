-- Announcements on the home page (note 3, 2026-10-05): news such as
-- legislation updates and new features, posted by Super Admins. Shown to
-- everyone, or only to strata admins.
--
-- Safe to run more than once. Run the whole file in one go.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 600),
  link_url text check (link_url is null or link_url ~ '^https://'),
  link_label text check (link_label is null or char_length(link_label) <= 40),
  audience text not null default 'everyone' check (audience in ('everyone', 'admins')),
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_published_idx on public.announcements (published_at desc);

alter table public.announcements enable row level security;

-- Signed-in people see current announcements meant for them.
drop policy if exists "people read current announcements" on public.announcements;
create policy "people read current announcements" on public.announcements
  for select to authenticated
  using (
    published_at <= now()
    and (expires_at is null or expires_at > now())
    and (
      audience = 'everyone'
      or exists (
        select 1 from public.corporation_role_assignments r
        where r.user_id = auth.uid() and r.role = 'admin'
      )
    )
  );

drop policy if exists "super admins manage announcements" on public.announcements;
create policy "super admins manage announcements" on public.announcements
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select, insert, update, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;
