-- doc02 §2a — owner/lot roster upload. owners_and_council already exists
-- (0004, pre-seeded SL001..SLnnn at corporation creation) and RLS already
-- gates writes on the admin role (0005). This adds the one operation that
-- can't be expressed as a single RLS-checked statement: applying a whole
-- CSV upload atomically, with the doc's rules enforced in one place.
--
--   * Every row matches an existing (corporation_id, lot_number) — an
--     unrecognized lot rejects the whole upload, never creates a lot.
--   * A lot appearing twice in one file rejects the whole upload.
--   * Field-level diff: a NULL incoming value means "blank cell — leave as
--     is"; a non-NULL value that differs from what's stored updates that
--     one field. Rows where nothing changes aren't touched, so their
--     updated_at doesn't move.
--   * Only the ten CSV-mapped fields. council_member_name, council_email,
--     is_council_member and role are governance state, admin-set in-app
--     only, and nothing here can reach them.
--
-- Security invoker: RLS is still what permits the update. The explicit
-- admin check is there to fail loudly — without it a non-admin's update
-- would silently match zero rows (members can read the roster, so the
-- unknown-lot check would pass) and report success.

create or replace function public.apply_owner_roster_upload(
  p_corporation_id text,
  p_rows jsonb
)
returns table (lots_changed int, fields_changed int)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_duplicates text;
  v_unknown text;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can upload the owner roster.';
  end if;

  select string_agg(lot, ', ' order by lot) into v_duplicates
  from (
    select r ->> 'lot_number' as lot
    from jsonb_array_elements(p_rows) r
    group by 1
    having count(*) > 1
  ) d;
  if v_duplicates is not null then
    raise exception 'These strata lots appear more than once in the file: %. Nothing was changed.', v_duplicates;
  end if;

  select string_agg(r ->> 'lot_number', ', ' order by r ->> 'lot_number') into v_unknown
  from jsonb_array_elements(p_rows) r
  where not exists (
    select 1 from public.owners_and_council o
    where o.corporation_id = p_corporation_id
      and o.lot_number = r ->> 'lot_number'
  );
  if v_unknown is not null then
    raise exception 'These strata lots aren''t on this strata''s plan: %. Check the file is for the right strata. Nothing was changed.', v_unknown;
  end if;

  return query
  with incoming as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      lot_number text,
      full_name text,
      email text,
      unit_number text,
      unit_entitlement numeric,
      owner_type text,
      parking text,
      storage text,
      bike_rack text,
      strata_fees numeric
    )
  ),
  diff as (
    select
      o.id,
      (case when i.full_name is not null and i.full_name is distinct from o.full_name then 1 else 0 end
     + case when i.email is not null and i.email is distinct from o.email then 1 else 0 end
     + case when i.unit_number is not null and i.unit_number is distinct from o.unit_number then 1 else 0 end
     + case when i.unit_entitlement is not null and i.unit_entitlement is distinct from o.unit_entitlement then 1 else 0 end
     + case when i.owner_type is not null and i.owner_type is distinct from o.owner_type then 1 else 0 end
     + case when i.parking is not null and i.parking is distinct from o.parking then 1 else 0 end
     + case when i.storage is not null and i.storage is distinct from o.storage then 1 else 0 end
     + case when i.bike_rack is not null and i.bike_rack is distinct from o.bike_rack then 1 else 0 end
     + case when i.strata_fees is not null and i.strata_fees is distinct from o.strata_fees then 1 else 0 end
      ) as changed_fields,
      i.*
    from incoming i
    join public.owners_and_council o
      on o.corporation_id = p_corporation_id and o.lot_number = i.lot_number
  ),
  updated as (
    update public.owners_and_council o
    set
      full_name = coalesce(d.full_name, o.full_name),
      email = coalesce(d.email, o.email),
      unit_number = coalesce(d.unit_number, o.unit_number),
      unit_entitlement = coalesce(d.unit_entitlement, o.unit_entitlement),
      owner_type = coalesce(d.owner_type, o.owner_type),
      parking = coalesce(d.parking, o.parking),
      storage = coalesce(d.storage, o.storage),
      bike_rack = coalesce(d.bike_rack, o.bike_rack),
      strata_fees = coalesce(d.strata_fees, o.strata_fees)
    from diff d
    where o.id = d.id and d.changed_fields > 0
    returning d.changed_fields
  )
  select count(*)::int, coalesce(sum(changed_fields), 0)::int from updated;
end;
$$;

-- Fix to 0004's pre-seeding trigger: lpad() truncates as well as pads, so
-- lot 1000 came out as 'SL100' — colliding with the real SL100 on the
-- (corporation_id, lot_number) unique key, which would make approving any
-- strata with 1,000+ lots fail outright. Pad to three digits, never cut.
-- Same canonical form lib/roster-csv.ts's normalizeLotNumber() produces.
create or replace function public.seed_owners_and_council()
returns trigger
language plpgsql
as $$
declare
  i int;
begin
  for i in 1..new.unit_count loop
    insert into public.owners_and_council (corporation_id, lot_number)
    values (
      new.strata_plan_number,
      'SL' || case when i < 1000 then lpad(i::text, 3, '0') else i::text end
    );
  end loop;
  return new;
end;
$$;
