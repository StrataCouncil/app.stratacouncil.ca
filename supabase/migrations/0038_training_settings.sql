-- Council Training settings (2026-10-06): one narration voice for every
-- module, so each new or rebuilt module doesn't need a voice chosen again.
-- A module can still set its own voice, which wins over this one.
--
-- One row. Anyone signed in may read it (it's a voice name: authors need
-- it to voice their modules); only Super Admins change it.
--
-- Safe to re-run.

create table if not exists public.training_settings (
  id boolean primary key default true check (id),
  narration_voice jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.training_settings (id) values (true) on conflict (id) do nothing;

alter table public.training_settings enable row level security;

drop policy if exists "anyone signed in reads training settings" on public.training_settings;
create policy "anyone signed in reads training settings" on public.training_settings
  for select to authenticated using (true);

drop policy if exists "super admins change training settings" on public.training_settings;
create policy "super admins change training settings" on public.training_settings
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

grant select, update on public.training_settings to authenticated;
grant all on public.training_settings to service_role;
