-- Lifecycle emails (2026-11-11): setup tips for people who sign up on
-- their own, the first journey of docs/lifecycle-emails.md.
--
-- profiles.email_token: the secret in unsubscribe links (one per person,
--   no new signing key). profiles.setup_emails_off_at: set when the person
--   stops setup tips (from an email or the Account page). Stopping setup
--   tips never stops sign-in links, security notices, invitations, or
--   meeting and discussion emails.
-- email_sends: one row per lifecycle email sent (journey, step, subject,
--   whether Mailtrap accepted it, the first click). Never the body. Unique
--   per person, journey, and step, so nobody gets the same step twice.
--   Goes with the person's account.
-- email_journeys: each journey's on/off switch in the Super Admin
--   console. Off until turned on. turned_on_at decides who's in a journey:
--   only people who confirmed their email after it was turned on, so
--   turning a journey on never emails existing accounts.
-- lifecycle_signup_people(): who the sign-up journey could email now and
--   where each person stands. Service role only.
-- set_my_email_preferences(): the Account page's Emails switches.
-- unsubscribe_setup_tips(): the unsubscribe link and one-click header.
-- lifecycle_signup_metrics(): the console's onboarding counts.
--
-- Grants: email_sends and email_journeys are server-only (RLS on, no
-- policies; anon and authenticated revoked; service role granted).
-- lifecycle_signup_people, unsubscribe_setup_tips, and
-- lifecycle_signup_metrics: service role only.
-- set_my_email_preferences: authenticated (it changes only the caller's
-- own row).
--
-- Safe to re-run.

alter table public.profiles add column if not exists email_token uuid not null default gen_random_uuid();
alter table public.profiles add column if not exists setup_emails_off_at timestamptz;
create unique index if not exists profiles_email_token_idx on public.profiles (email_token);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  journey text not null check (char_length(journey) between 1 and 40),
  step text not null check (char_length(step) between 1 and 40),
  subject text not null default '' check (char_length(subject) <= 200),
  sent_at timestamptz not null default now(),
  accepted boolean not null default false,
  clicked_at timestamptz,
  unique (user_id, journey, step)
);
create index if not exists email_sends_sent_idx on public.email_sends (sent_at desc);
alter table public.email_sends enable row level security;
revoke all on public.email_sends from anon, authenticated;
grant all on public.email_sends to service_role;

create table if not exists public.email_journeys (
  journey text primary key check (char_length(journey) between 1 and 40),
  enabled boolean not null default false,
  turned_on_at timestamptz,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz
);
alter table public.email_journeys enable row level security;
revoke all on public.email_journeys from anon, authenticated;
grant all on public.email_journeys to service_role;
insert into public.email_journeys (journey) values ('signup') on conflict (journey) do nothing;

-- Everyone the sign-up journey might email now, with where they stand.
-- The rules (which email, when) are in lib/lifecycle/signup.ts; this only
-- gathers the facts and leaves out people the journey never emails.
create or replace function public.lifecycle_signup_people()
returns table (
  user_id uuid,
  email text,
  full_name text,
  email_token uuid,
  confirmed_at timestamptz,
  pending_creation boolean,
  pending_join boolean,
  training_started boolean,
  training_completed boolean,
  last_sent_at timestamptz,
  steps_sent text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email,
    p.full_name,
    p.email_token,
    u.email_confirmed_at,
    exists (select 1 from corporation_creation_requests r where r.requested_by = p.id and r.status = 'pending'),
    exists (select 1 from corporation_join_requests j where j.requested_by = p.id and j.status = 'pending'),
    exists (select 1 from training_progress t where t.user_id = p.id),
    exists (select 1 from training_progress t where t.user_id = p.id and t.completed_at is not null),
    (select max(s.sent_at) from email_sends s where s.user_id = p.id),
    coalesce((select array_agg(s.step) from email_sends s where s.user_id = p.id and s.journey = 'signup'), '{}')
  from profiles p
  join auth.users u on u.id = p.id
  join email_journeys jn on jn.journey = 'signup' and jn.enabled and jn.turned_on_at is not null
  where u.email_confirmed_at is not null
    and u.email_confirmed_at >= jn.turned_on_at
    and u.email_confirmed_at > now() - interval '21 days'
    and p.email is not null
    and not p.is_super_admin
    and p.setup_emails_off_at is null
    -- Setup tips are for people without a strata: anyone with a strata
    -- (or invited to one) is past them.
    and not exists (select 1 from corporation_memberships m where m.user_id = p.id and m.status in ('active', 'invited'))
    and not exists (select 1 from corporation_invites i where lower(i.invited_email) = lower(p.email) and i.status = 'pending')
    and not exists (select 1 from corporation_creation_requests r where r.requested_by = p.id and r.status = 'approved');
$$;
revoke all on function public.lifecycle_signup_people() from public, anon, authenticated;
grant execute on function public.lifecycle_signup_people() to service_role;

-- The Account page's Emails switches: setup tips and product news
-- (marketing consent, 0006: the date is stamped when it's turned on and
-- cleared when it's turned off).
create or replace function public.set_my_email_preferences(setup_tips boolean, product_news boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  update profiles set
    setup_emails_off_at = case when setup_tips then null else coalesce(setup_emails_off_at, now()) end,
    marketing_opt_in = product_news,
    marketing_opt_in_at = case when product_news then coalesce(case when marketing_opt_in then marketing_opt_in_at end, now()) else null end
  where id = auth.uid();
end;
$$;
revoke all on function public.set_my_email_preferences(boolean, boolean) from public, anon;
grant execute on function public.set_my_email_preferences(boolean, boolean) to authenticated;

-- The unsubscribe link: stops setup tips for the person whose token it
-- is. Returns whether the token matched someone.
create or replace function public.unsubscribe_setup_tips(token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare found_id uuid;
begin
  update profiles set setup_emails_off_at = coalesce(setup_emails_off_at, now())
  where email_token = token
  returning id into found_id;
  return found_id is not null;
end;
$$;
revoke all on function public.unsubscribe_setup_tips(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_setup_tips(uuid) to service_role;

-- The console's onboarding numbers: people who confirmed their email in
-- the last `days` days (Super Admins left out), and how many reached each
-- step since. Counts only; service role only.
create or replace function public.lifecycle_signup_metrics(days int default 90)
returns table (
  signed_up bigint,
  first_action bigint,
  training_started bigint,
  training_completed bigint,
  strata_connected bigint,
  first_meeting bigint,
  subscribed bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with people as (
    select p.id
    from profiles p
    join auth.users u on u.id = p.id
    where u.email_confirmed_at > now() - make_interval(days => greatest(1, least(days, 3650)))
      and not p.is_super_admin
  ),
  facts as (
    select
      pe.id,
      exists (select 1 from training_progress t where t.user_id = pe.id) as started,
      exists (select 1 from training_progress t where t.user_id = pe.id and t.completed_at is not null) as completed,
      exists (select 1 from corporation_creation_requests r where r.requested_by = pe.id) as requested,
      exists (select 1 from corporation_join_requests j where j.requested_by = pe.id) as asked,
      exists (select 1 from corporation_memberships m where m.user_id = pe.id and m.status = 'active') as connected,
      exists (select 1 from corporation_memberships m join meetings mt on mt.corporation_id = m.corporation_id
              where m.user_id = pe.id and m.status = 'active' and mt.launched_at is not null) as met,
      exists (select 1 from corporation_memberships m join subscriptions s on s.corporation_id = m.corporation_id
              where m.user_id = pe.id and m.status = 'active' and s.status = 'active') as paid
    from people pe
  )
  select
    count(*),
    count(*) filter (where started or requested or asked or connected),
    count(*) filter (where started),
    count(*) filter (where completed),
    count(*) filter (where connected),
    count(*) filter (where met),
    count(*) filter (where paid)
  from facts;
$$;
revoke all on function public.lifecycle_signup_metrics(int) from public, anon, authenticated;
grant execute on function public.lifecycle_signup_metrics(int) to service_role;
