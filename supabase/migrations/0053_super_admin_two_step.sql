-- Platform staff (Super Admins) must use two-step verification with an
-- authenticator app. The app sends a Super Admin to set it up, then asks
-- for a code at each sign-in (middleware.ts). Here, the database itself
-- only honours Super Admin powers in a session that has been through that
-- step (assurance level aal2), so a sign-in link alone, even used outside
-- the website, can't reach other stratas' data.
--
-- Everyone else is unchanged.
--
-- If a Super Admin loses their authenticator: in Supabase, Authentication
-- -> Users -> their account, remove the MFA factor; the next sign-in sets
-- up a new one.
--
-- Safe to run more than once. Run the whole file in one go.

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
