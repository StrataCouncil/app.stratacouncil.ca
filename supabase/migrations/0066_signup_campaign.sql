-- Campaign attribution at sign-up (doc10 §4.5, free version, 2026-10-26).
--
-- stratacouncil.ca keeps the campaign tags a visitor first arrived with
-- (utm_source, utm_medium, utm_campaign, utm_content, utm_term) and adds
-- them to its sign-up links; /signup passes them through
-- auth.users.raw_user_meta_data ->> 'campaign' (lib/auth/actions.ts), the
-- same channel full_name and marketing_opt_in use. This saves them on the
-- new profile, so sign-ups can be counted by post or campaign.
--
-- raw_user_meta_data can be set by anyone calling Supabase Auth directly,
-- so the trigger keeps only those five keys, only string values, each cut
-- to 100 characters, and stores null when nothing is left.
--
-- Grants: no new table. profiles.signup_campaign is readable by the
-- profile's own user through the existing "read own profile" policy (it's
-- their own sign-up link), and not writable by them: authenticated may
-- only update full_name and phone (0016). The service role and Super
-- Admin reports read it as before.
--
-- Safe to re-run.

alter table public.profiles add column if not exists signup_campaign jsonb;

create or replace function public.signup_campaign_from(meta jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select nullif(
    coalesce(
      (
        select jsonb_object_agg(key, left(btrim(value #>> '{}'), 100))
        from jsonb_each(case when jsonb_typeof(meta -> 'campaign') = 'object' then meta -> 'campaign' else '{}'::jsonb end)
        where key in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term')
          and jsonb_typeof(value) = 'string'
          and btrim(value #>> '{}') <> ''
      ),
      '{}'::jsonb
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.signup_campaign_from(jsonb) from public, anon, authenticated;

-- 0006's handle_new_auth_user(), plus the campaign.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opted_in boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
begin
  insert into public.profiles (id, full_name, email, marketing_opt_in, marketing_opt_in_at, signup_campaign)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    opted_in,
    case when opted_in then now() else null end,
    public.signup_campaign_from(new.raw_user_meta_data)
  );
  return new;
end;
$$;
