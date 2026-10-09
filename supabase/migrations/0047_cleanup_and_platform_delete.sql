-- Clean-up, and deleting a strata or an account from the Super Admin
-- console (2026-10-08).
--
-- Clean-up: the training demo links and their feedback (0040), replaced by
-- the demo site (lib/demo.ts) and never used; and 0045's Manager billing
-- setting, replaced by each member's own switch (0046).
--
-- platform_delete_strata / platform_delete_person: called by the console
-- (app/admin/delete-actions.ts) with the service role, after it has checked
-- the caller is a Super Admin. Each first runs with p_dry = true, which
-- deletes nothing and returns how many rows each table would lose, for the
-- console to show before anything is deleted; then with p_dry = false,
-- which deletes the same rows. Rows anywhere that refer to what's deleted
-- go too, following the foreign keys in the catalog (as the demo site's
-- clean-up does, supabase/demo/demo.sql). Files in Storage are removed by
-- the app.
--
-- A strata with an active Stripe subscription can't be deleted (cancel it
-- in Stripe first). An account can't be deleted while it is a member of a
-- strata, holds a role in one, or is a Super Admin.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

drop table if exists public.training_feedback;
drop table if exists public.training_demo_links;
drop function if exists public.set_managers_can_bill(text, boolean);
alter table public.strata_corporations drop column if exists managers_can_bill;

-- Earlier versions of these functions returned different columns.
drop function if exists public.platform_delete_strata(text, boolean);
drop function if exists public.platform_delete_person(uuid, boolean);
drop function if exists public.platform_delete_rows(regclass, text, boolean, regclass[]);

-- Each table's rows to go, and which stratas they belong to (for tables
-- with a corporation_id).
create function public.platform_delete_rows(p_table regclass, p_condition text, p_dry boolean, p_path regclass[] default '{}')
returns table (tbl text, n bigint, stratas text)
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  child_condition text;
  v_n bigint;
  v_stratas text;
begin
  if array_length(p_path, 1) >= 12 then
    raise exception 'platform_delete_rows: foreign keys nested too deep under %', p_table;
  end if;

  for fk in
    select c.conrelid::regclass as child,
           c.confdeltype as on_delete,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_cols,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_cols,
           (select string_agg(quote_ident(a.attname) || ' = null', ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as set_null,
           (select bool_and(not a.attnotnull)
              from unnest(c.conkey) k(attnum)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as nullable
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = p_table
    order by c.conrelid::regclass::text, c.conname
  loop
    -- Keys the database clears itself (ON DELETE SET NULL / SET DEFAULT).
    if fk.on_delete in ('n', 'd') then
      continue;
    end if;
    child_condition := format('(%s) in (select %s from %s where %s)', fk.child_cols, fk.parent_cols, p_table, p_condition);
    -- A key looping back to a table already being deleted from is cleared, not followed.
    if fk.child = p_table or fk.child = any(p_path) then
      if fk.nullable and not p_dry then
        execute format('update %s set %s where %s', fk.child, fk.set_null, child_condition);
      end if;
      continue;
    end if;
    return query select * from public.platform_delete_rows(fk.child, child_condition, p_dry, p_path || p_table);
  end loop;

  execute format('select count(*) from %s where %s', p_table, p_condition) into v_n;
  if v_n > 0 then
    v_stratas := null;
    if exists (select 1 from pg_attribute where attrelid = p_table and attname = 'corporation_id' and not attisdropped) then
      execute format('select string_agg(distinct corporation_id::text, '', '') from %s where %s', p_table, p_condition) into v_stratas;
    end if;
    tbl := p_table::text;
    n := v_n;
    stratas := v_stratas;
    return next;
    if not p_dry then
      execute format('delete from %s where %s', p_table, p_condition);
    end if;
  end if;
end;
$$;

create function public.platform_delete_strata(p_corporation_id text, p_dry boolean)
returns table (tbl text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.strata_corporations where strata_plan_number = p_corporation_id) then
    raise exception 'There''s no strata %.', p_corporation_id;
  end if;
  if exists (
    select 1 from public.subscriptions
    where corporation_id = p_corporation_id and status = 'active' and stripe_subscription_id is not null
  ) then
    raise exception '% has an active Stripe subscription. Cancel it in Stripe first.', p_corporation_id;
  end if;
  return query
    select r.tbl, sum(r.n)::bigint
    from public.platform_delete_rows('public.strata_corporations'::regclass, format('strata_plan_number = %L', p_corporation_id), p_dry) r
    group by r.tbl order by r.tbl;
end;
$$;

create function public.platform_delete_person(p_user_id uuid, p_dry boolean)
returns table (tbl text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stratas text;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'There''s no such account.';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_super_admin) then
    raise exception 'A Super Admin''s account can''t be deleted here.';
  end if;
  select string_agg(distinct corporation_id, ', ' order by corporation_id) into v_stratas
  from (
    select corporation_id from public.corporation_memberships where user_id = p_user_id and status in ('active', 'invited')
    union
    select corporation_id from public.corporation_role_assignments where user_id = p_user_id
  ) s;
  if v_stratas is not null then
    raise exception 'This account still belongs to %. Remove it from those stratas (or delete them) first.', v_stratas;
  end if;
  -- Nothing it made inside a strata (documents, meetings, invites) goes with it.
  create temp table if not exists platform_delete_plan (tbl text, n bigint, stratas text) on commit drop;
  truncate platform_delete_plan;
  insert into platform_delete_plan
    select * from public.platform_delete_rows('public.profiles'::regclass, format('id = %L', p_user_id), true);
  select string_agg(distinct x.s, ', ') into v_stratas
  from platform_delete_plan p, unnest(string_to_array(p.stratas, ', ')) x(s);
  if v_stratas is not null then
    raise exception 'This account has records in % (%). Delete those stratas first, or keep the account.',
      v_stratas, (select string_agg(p.tbl, ', ' order by p.tbl) from platform_delete_plan p where p.stratas is not null);
  end if;
  return query
    select r.tbl, sum(r.n)::bigint
    from public.platform_delete_rows('public.profiles'::regclass, format('id = %L', p_user_id), p_dry) r
    group by r.tbl order by r.tbl;
end;
$$;

revoke all on function public.platform_delete_rows(regclass, text, boolean, regclass[]) from public, anon, authenticated, service_role;
revoke all on function public.platform_delete_strata(text, boolean) from public, anon, authenticated;
revoke all on function public.platform_delete_person(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_delete_strata(text, boolean) to service_role;
grant execute on function public.platform_delete_person(uuid, boolean) to service_role;
