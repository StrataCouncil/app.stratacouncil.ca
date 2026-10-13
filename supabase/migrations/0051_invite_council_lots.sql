-- Council members added on the Owners page (a strata lot marked as
-- council, with a name and email, but no account) can be invited from
-- the Council page. The invite carries the lot: the invited membership
-- holds it while the invite is pending, and accepting ties the new member
-- to that lot with its council role, so the lot stays a council lot
-- throughout and the admin has nothing to set by hand.
--
-- 1. sync_council_lots ignores invited memberships, so a lot with a
--    pending invite keeps the council flag, name and role typed on the
--    Owners page. A member's own name replaces the typed one only when
--    their profile has a name.
-- 2. accept_corporation_invite: if the invited membership holds a lot
--    marked as council, the member gets that lot's role (Member at Large
--    when the lot has none, or when the role's one holder is someone
--    else), then the lot flags are synced.
--
-- Safe to run more than once. Run the whole file in one go.

-- ── 1. Lot flags follow active members only ────────────────────────────
create or replace function public.sync_council_lots(p_corporation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  with council as (
    select m.lot_number, p.full_name,
      (select r.role from public.corporation_role_assignments r
        where r.corporation_id = m.corporation_id and r.user_id = m.user_id
          and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large')
        order by array_position(array['president', 'vice_president', 'treasurer', 'secretary', 'member_at_large'], r.role)
        limit 1) as role
    from public.corporation_memberships m
    join public.profiles p on p.id = m.user_id
    where m.corporation_id = p_corporation_id and m.status = 'active' and m.lot_number is not null
  ),
  linked as (select lot_number from public.corporation_memberships
             where corporation_id = p_corporation_id and lot_number is not null and status <> 'invited')
  update public.owners_and_council o
    set is_council_member = (c.role is not null),
        role = c.role,
        council_member_name = case
          when c.role is not null then coalesce(nullif(btrim(c.full_name), ''), o.council_member_name)
          else null
        end
  from (
    select l.lot_number, c.full_name, c.role
    from linked l left join council c on c.lot_number = l.lot_number
  ) c
  where o.corporation_id = p_corporation_id and o.lot_number = c.lot_number;
$$;
revoke all on function public.sync_council_lots(text) from public, authenticated;

-- ── 2. Accepting an invite made from a council lot ─────────────────────
create or replace function public.accept_corporation_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.corporation_invites%rowtype;
  v_email text;
  v_lot text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite from public.corporation_invites
  where id = p_invite_id
  for update;

  if not found or lower(v_invite.invited_email) <> lower(v_email) then
    raise exception 'This invitation isn''t for the account you''re signed in with.';
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'This invitation was revoked by the strata''s admin.';
  end if;

  if v_invite.status = 'pending' and v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask the strata''s admin to send a new one.';
  end if;

  if v_invite.status = 'pending' then
    update public.corporation_invites
      set status = 'accepted', accepted_at = now()
      where id = p_invite_id;

    insert into public.corporation_memberships (user_id, corporation_id, status, invited_by, joined_at)
    values (auth.uid(), v_invite.corporation_id, 'active', v_invite.invited_by, now())
    on conflict (user_id, corporation_id) do update
      set status = 'active', joined_at = now(), invited_by = excluded.invited_by;

    update public.corporation_join_requests
      set status = 'approved', reviewed_by = v_invite.invited_by, resolved_at = now()
      where corporation_id = v_invite.corporation_id
        and requested_by = auth.uid()
        and status = 'pending';

    -- Invited from a council lot: keep the lot's council role.
    select m.lot_number into v_lot from public.corporation_memberships m
      where m.corporation_id = v_invite.corporation_id and m.user_id = auth.uid();
    if v_lot is not null then
      select case when o.is_council_member then coalesce(o.role, 'member_at_large') end into v_role
        from public.owners_and_council o
        where o.corporation_id = v_invite.corporation_id and o.lot_number = v_lot;
      if v_role in ('president', 'vice_president', 'treasurer', 'secretary') and exists (
        select 1 from public.corporation_role_assignments r
        where r.corporation_id = v_invite.corporation_id and r.role = v_role and r.user_id <> auth.uid()
      ) then
        v_role := 'member_at_large';
      end if;
      -- President and vice president are different people (Standard Bylaw 13(2)).
      if v_role in ('president', 'vice_president') and exists (
        select 1 from public.corporation_role_assignments r
        where r.corporation_id = v_invite.corporation_id and r.user_id = auth.uid()
          and r.role in ('president', 'vice_president') and r.role <> v_role
      ) then
        v_role := 'member_at_large';
      end if;
      if v_role is not null then
        insert into public.corporation_role_assignments (corporation_id, role, user_id)
        values (v_invite.corporation_id, v_role, auth.uid())
        on conflict do nothing;
      end if;
      perform public.sync_council_lots(v_invite.corporation_id);
    end if;
  end if;

  return v_invite.corporation_id;
end;
$$;
