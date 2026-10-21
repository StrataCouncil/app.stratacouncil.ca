-- The investor briefing (2026-10-21): a private, sign-in-by-email deck for
-- prospective investors at app.stratacouncil.ca/investors.
--
-- A prospective investor enters their name and email, accepts the legal
-- disclaimer and confirms they are an accredited investor; we email them a
-- personal link that works for 30 days. They can read the deck as often as
-- they like in that time, and leave notes and questions under any slide.
-- We keep which slides they looked at and for how long, and their notes,
-- for the Super Admin console. Investors aren't app users: they have no
-- account, and everything here is reached by the server (service role),
-- except that Super Admins can read it in the console.
--
-- The deck's slides are images in the private investor-deck bucket,
-- uploaded from the console as a PDF.
--
-- Safe to run more than once. Run the whole file in one go.

-- ── Decks ───────────────────────────────────────────────────────────────
create table if not exists public.investor_decks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  page_count integer not null check (page_count between 1 and 200),
  -- Width over height of the slides, for laying them out before they load.
  aspect numeric not null default 1.7778 check (aspect > 0.2 and aspect < 5),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set once every slide is uploaded. Investors see the latest published deck.
  published_at timestamptz
);
create index if not exists investor_decks_published_idx on public.investor_decks (published_at desc) where published_at is not null;

-- ── Investors ───────────────────────────────────────────────────────────
create table if not exists public.investors (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) between 3 and 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  disclaimer_version text not null,
  disclaimer_accepted_at timestamptz not null,
  accredited_confirmed_at timestamptz not null,
  -- Who shared the sign-up page with them, if anyone.
  referred_by uuid references public.investors(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_page integer,
  revoked_at timestamptz
);

-- One per email we send. The link (and the session it starts) works until
-- expires_at; only a hash of the token is kept.
create table if not exists public.investor_links (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  first_opened_at timestamptz
);
create index if not exists investor_links_investor_idx on public.investor_links (investor_id, created_at desc);

-- ── What they read ──────────────────────────────────────────────────────
create table if not exists public.investor_slide_time (
  investor_id uuid not null references public.investors(id) on delete cascade,
  deck_id uuid not null references public.investor_decks(id) on delete cascade,
  page integer not null check (page >= 1),
  seconds integer not null default 0 check (seconds >= 0),
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key (investor_id, deck_id, page)
);

create table if not exists public.investor_notes (
  investor_id uuid not null references public.investors(id) on delete cascade,
  deck_id uuid not null references public.investor_decks(id) on delete cascade,
  page integer not null check (page >= 1),
  body text not null check (char_length(body) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (investor_id, deck_id, page)
);

-- Adds viewing time to a slide (the briefing reports it every few seconds).
create or replace function public.investor_add_time(p_investor uuid, p_deck uuid, p_page integer, p_seconds integer)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.investor_slide_time (investor_id, deck_id, page, seconds)
  values (p_investor, p_deck, p_page, greatest(0, least(p_seconds, 120)))
  on conflict (investor_id, deck_id, page) do update
    set seconds = public.investor_slide_time.seconds + excluded.seconds,
        last_viewed_at = now();
  update public.investors set last_seen_at = now(), last_page = p_page where id = p_investor;
$$;
revoke all on function public.investor_add_time(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.investor_add_time(uuid, uuid, integer, integer) to service_role;

-- ── Access ──────────────────────────────────────────────────────────────
-- The server (service role) does everything; Super Admins can read.
alter table public.investor_decks enable row level security;
alter table public.investors enable row level security;
alter table public.investor_links enable row level security;
alter table public.investor_slide_time enable row level security;
alter table public.investor_notes enable row level security;

revoke all on public.investor_decks from anon, authenticated;
revoke all on public.investors from anon, authenticated;
revoke all on public.investor_links from anon, authenticated;
revoke all on public.investor_slide_time from anon, authenticated;
revoke all on public.investor_notes from anon, authenticated;

grant select on public.investor_decks to authenticated;
grant select on public.investors to authenticated;
grant select on public.investor_slide_time to authenticated;
grant select on public.investor_notes to authenticated;

grant all on public.investor_decks to service_role;
grant all on public.investors to service_role;
grant all on public.investor_links to service_role;
grant all on public.investor_slide_time to service_role;
grant all on public.investor_notes to service_role;

drop policy if exists "super admins read investor decks" on public.investor_decks;
create policy "super admins read investor decks" on public.investor_decks for select to authenticated using (public.is_super_admin());
drop policy if exists "super admins read investors" on public.investors;
create policy "super admins read investors" on public.investors for select to authenticated using (public.is_super_admin());
drop policy if exists "super admins read investor slide time" on public.investor_slide_time;
create policy "super admins read investor slide time" on public.investor_slide_time for select to authenticated using (public.is_super_admin());
drop policy if exists "super admins read investor notes" on public.investor_notes;
create policy "super admins read investor notes" on public.investor_notes for select to authenticated using (public.is_super_admin());

-- ── Slides ──────────────────────────────────────────────────────────────
-- Private: investors get short-lived signed links from the server.
insert into storage.buckets (id, name, public, file_size_limit)
values ('investor-deck', 'investor-deck', false, 10485760)
on conflict (id) do nothing;
