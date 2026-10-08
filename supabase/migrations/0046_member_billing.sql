-- Billing access for anyone the admin chooses (2026-10-08).
--
-- corporation_memberships.can_manage_billing: a switch beside each person
-- on the Council roster, like "Runs meetings". When on, that member can
-- use Billing (subscribe, payment method, invoices, billing contacts),
-- alongside the admin. Only the admin flips it (the "admin manages
-- memberships" policy, 0005). The admin always has billing.
--
-- It replaces 0045's one switch for the Manager role: wherever that was
-- on, each active Manager's own switch is turned on, then the old setting
-- is cleared (so re-running this file never turns anyone back on), and
-- set_managers_can_bill() goes away.
--
-- can_manage_billing() stays the one check the app uses for billing.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

alter table public.corporation_memberships add column if not exists can_manage_billing boolean not null default false;

-- (Only while the old setting exists: 0047 removes it.)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'strata_corporations' and column_name = 'managers_can_bill'
  ) then
    update public.corporation_memberships m
    set can_manage_billing = true
    from public.corporation_role_assignments r, public.strata_corporations c
    where r.corporation_id = m.corporation_id
      and r.user_id = m.user_id
      and r.role = 'manager'
      and c.strata_plan_number = m.corporation_id
      and c.managers_can_bill
      and m.status = 'active';
    update public.strata_corporations set managers_can_bill = false where managers_can_bill;
  end if;
end $$;

create or replace function public.can_manage_billing(target_corporation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_corporation_role(target_corporation_id, array['admin'])
    or exists (
      select 1 from public.corporation_memberships
      where corporation_id = target_corporation_id
        and user_id = auth.uid()
        and status = 'active'
        and can_manage_billing
    );
$$;

revoke all on function public.can_manage_billing(text) from public;
grant execute on function public.can_manage_billing(text) to authenticated;

drop function if exists public.set_managers_can_bill(text, boolean);

-- The roster's member list (0021), now with each member's billing switch.
drop function if exists public.corporation_member_directory(text);
create function public.corporation_member_directory(p_corporation_id text)
returns table (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  can_run_meetings boolean,
  lot_number text,
  avatar_path text,
  can_manage_billing boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, p.full_name, p.email, m.status, m.joined_at, m.can_run_meetings, m.lot_number, p.avatar_path, m.can_manage_billing
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id
    and m.status in ('active', 'invited')
    and (public.is_corporation_member(p_corporation_id) or public.is_super_admin())
  order by m.status, p.full_name;
$$;
grant execute on function public.corporation_member_directory(text) to authenticated;
