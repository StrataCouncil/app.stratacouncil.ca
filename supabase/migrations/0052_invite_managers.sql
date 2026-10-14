-- Managers listed on the Management tab (name, title, phone, email; no
-- account) show on the Council page as "Not invited yet" with the
-- Manager tag, and can be invited from there. The invite carries the
-- role: accepting it makes the new member the strata's Manager. A
-- manager has no strata lot and no council seat, so nothing changes for
-- meetings.
--
-- 1. corporation_invites.invited_role: 'manager', or null for an
--    ordinary invite.
-- 2. accept_corporation_invite: everything it did before (0051), plus
--    the Manager role for an invite that carries it.
--
-- Safe to run more than once. Run the whole file in one go.

-- ── 1. The role an invite carries ──────────────────────────────────────
alter table public.corporation_invites add column if not exists invited_role text;
alter table public.corporation_invites drop constraint if exists corporation_invites_invited_role_check;
alter table public.corporation_invites add constraint corporation_invites_invited_role_check
  check (invited_role is null or invited_role = 'manager');

-- ── 2. Accepting an invite ─────────────────────────────────────────────
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

    -- Invited as the strata's manager, from the Management tab (0052).
    if v_invite.invited_role = 'manager' then
      insert into public.corporation_role_assignments (corporation_id, role, user_id)
      values (v_invite.corporation_id, 'manager', auth.uid())
      on conflict do nothing;
    end if;

    -- Invited from a council lot: keep the lot's council role (0051).
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
