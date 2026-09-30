-- doc01 §2 — Identity layer.
-- profiles is a public-schema mirror of auth.users, plus app-specific
-- fields. It exists so RLS policies and application queries never have
-- to reach into Supabase's own `auth` schema directly.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  full_name_locked_at timestamptz,
  email text,                          -- synced READ COPY of auth.users.email — never written
                                        -- to directly; see the trigger below. doc01 §2.
  phone text,
  is_super_admin boolean not null default false,  -- platform staff; NOT a corporation role. doc01 §4.
  created_at timestamptz not null default now()
  -- No status/deletion-state column — deletion is a single immediate
  -- action (doc03 Stage 9), not a state a profile transitions through.
);

alter table public.profiles enable row level security;

-- doc01 §2: a Postgres trigger keeps profiles.email in sync with
-- auth.users.email, firing only after the real column actually changes
-- (i.e. after Supabase Auth's own email-change confirmation completes).
create or replace function public.handle_auth_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_sync();

-- Creates the matching profiles row the moment someone signs up (doc03
-- Stage 2: "email + full name → confirm → profile row created").
-- full_name comes from the signup form via auth.users.raw_user_meta_data.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
