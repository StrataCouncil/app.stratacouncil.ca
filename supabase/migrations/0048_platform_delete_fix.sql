-- Fix for 0047 (2026-10-09): deleting an account failed on Supabase with
-- "DELETE requires a WHERE clause". Supabase refuses a DELETE without a
-- WHERE through its API (the pg-safeupdate guard), and
-- platform_delete_person cleared its scratch table that way. It now
-- truncates it instead. Nothing else changes.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

create or replace function public.platform_delete_person(p_user_id uuid, p_dry boolean)
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

revoke all on function public.platform_delete_person(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_delete_person(uuid, boolean) to service_role;
