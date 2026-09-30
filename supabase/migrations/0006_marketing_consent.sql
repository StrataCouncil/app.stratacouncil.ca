-- doc01 §2 — marketing-communications consent (CASL), added at signup as an
-- optional, unchecked-by-default checkbox, separate from the required
-- Terms/Privacy acceptance. CASL (Canada's Anti-Spam Legislation) requires
-- express opt-in for commercial electronic messages and proof of when
-- consent was given — marketing_opt_in_at is that proof, not just a flag.

alter table public.profiles
  add column marketing_opt_in boolean not null default false,
  add column marketing_opt_in_at timestamptz;

-- Signup passes marketing_opt_in through auth.users.raw_user_meta_data
-- (lib/auth/actions.ts), the same channel full_name already uses — see
-- 0001_profiles.sql's handle_new_auth_user(). Replacing the function (not
-- adding a second trigger) keeps profile-row creation in one place.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opted_in boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
begin
  insert into public.profiles (id, full_name, email, marketing_opt_in, marketing_opt_in_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    opted_in,
    case when opted_in then now() else null end
  );
  return new;
end;
$$;

-- Toggling later (Account Settings — not yet built, doc00 changelog
-- follow-up) should go through a normal authenticated update to this row,
-- stamping marketing_opt_in_at on the transition to true and clearing it
-- back to null on opt-out, not just flipping the boolean:
--   update public.profiles
--   set marketing_opt_in = true, marketing_opt_in_at = now()
--   where id = auth.uid();
