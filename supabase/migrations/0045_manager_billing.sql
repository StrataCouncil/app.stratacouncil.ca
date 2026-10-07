-- Billing access for the strata's Manager (2026-10-07).
--
-- strata_corporations.managers_can_bill: when on, the strata's Manager can
-- use Billing (subscribe, payment method, invoices, billing contacts),
-- alongside the admin. Off by default; only the admin turns it on or off,
-- from the Council card.
--
-- can_manage_billing() is the one check the app uses for billing: the
-- admin (and Super Admins, as admin of every strata), or a Manager when
-- the strata allows it.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

alter table public.strata_corporations add column if not exists managers_can_bill boolean not null default false;

create or replace function public.can_manage_billing(target_corporation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_corporation_role(target_corporation_id, array['admin'])
    or (
      public.has_corporation_role(target_corporation_id, array['manager'])
      and exists (
        select 1 from public.strata_corporations
        where strata_plan_number = target_corporation_id and managers_can_bill
      )
    );
$$;

create or replace function public.set_managers_can_bill(p_corporation_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can change who manages billing.';
  end if;
  update public.strata_corporations set managers_can_bill = p_on where strata_plan_number = p_corporation_id;
end;
$$;

revoke all on function public.can_manage_billing(text) from public;
grant execute on function public.can_manage_billing(text) to authenticated;
revoke all on function public.set_managers_can_bill(text, boolean) from public;
grant execute on function public.set_managers_can_bill(text, boolean) to authenticated;
