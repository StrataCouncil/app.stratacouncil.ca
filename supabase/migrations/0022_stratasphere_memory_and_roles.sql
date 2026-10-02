-- 1. Stratasphere remembers what it read (doc02 §4b).
-- 2. An executive office (President, Vice President, Treasurer, Secretary)
--    and Member at Large can't be held together.
--
-- Safe to run more than once. Run the whole file in one go.
--
-- 1.
-- Each question is stored with the passages it was answered from (already
-- PII-stripped), and later questions in the conversation get them back, so
-- an answer never loses its sources mid-conversation. Very long
-- conversations drop their oldest turns in one step, from
-- conversations.context_start_at on, so the prompt cache stays valid.
--
-- Same privacy as the rest of the conversation: owner only (0019), and
-- deleted with it.

alter table public.conversation_messages add column if not exists context text;
alter table public.conversations add column if not exists context_start_at timestamptz;

-- 2. A Member at Large is by definition a council member with no office, so
-- taking an executive office drops it. Admin is separate and unaffected.
-- (Same function as 0017, plus the rule.)
create or replace function public.set_corporation_member_roles(p_corporation_id text, p_user_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_currently_admin boolean;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can change roles.';
  end if;

  if not exists (
    select 1 from public.corporation_memberships
    where corporation_id = p_corporation_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'Roles can only be assigned to active members.';
  end if;

  p_roles := coalesce(p_roles, array[]::text[]);
  if p_roles && array['president', 'vice_president', 'treasurer', 'secretary'] then
    p_roles := array_remove(p_roles, 'member_at_large');
  end if;

  select exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) into v_currently_admin;

  if v_currently_admin and not ('admin' = any(p_roles)) then
    raise exception 'A strata always needs an admin. To hand it over, assign Admin to another member instead.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id
    and user_id = p_user_id
    and not (role = any(p_roles));

  foreach v_role in array p_roles loop
    -- Single-holder roles move from their current holder.
    if v_role not in ('manager', 'member_at_large') then
      delete from public.corporation_role_assignments
      where corporation_id = p_corporation_id and role = v_role and user_id <> p_user_id;
    end if;

    insert into public.corporation_role_assignments (corporation_id, role, user_id)
    values (p_corporation_id, v_role, p_user_id)
    on conflict do nothing;
  end loop;

  perform public.sync_council_lots(p_corporation_id);
end;
$$;

-- Existing data: executives who were also marked Member at Large.
do $$
declare
  v_corp text;
begin
  for v_corp in
    delete from public.corporation_role_assignments m
    where m.role = 'member_at_large'
      and exists (
        select 1 from public.corporation_role_assignments e
        where e.corporation_id = m.corporation_id and e.user_id = m.user_id
          and e.role in ('president', 'vice_president', 'treasurer', 'secretary')
      )
    returning m.corporation_id
  loop
    perform public.sync_council_lots(v_corp);
  end loop;
end;
$$;
