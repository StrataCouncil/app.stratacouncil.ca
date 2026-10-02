-- subscriptions.billing_interval becomes a fixed list (monthly or annual),
-- so the Supabase table editor offers a dropdown instead of free text.
-- Empty (null) still means no plan chosen yet. Safe to run more than once.
-- Run the whole file in one go.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_interval' and typnamespace = 'public'::regnamespace) then
    create type public.billing_interval as enum ('monthly', 'annual');
  end if;
end;
$$;

alter table public.subscriptions drop constraint if exists subscriptions_billing_interval_check;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'billing_interval') <> 'USER-DEFINED' then
    alter table public.subscriptions
      alter column billing_interval type public.billing_interval using billing_interval::public.billing_interval;
  end if;
end;
$$;
