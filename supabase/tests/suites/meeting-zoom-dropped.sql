\set ON_ERROR_STOP 1
-- 0083: the Meeting SDK's meeting_zoom table is gone, and the migration
-- runs again without error.
do $$
begin
  if to_regclass('public.meeting_zoom') is not null then
    raise exception 'meeting_zoom still exists';
  end if;
  raise notice 'OK meeting_zoom dropped';
end $$;

drop table if exists public.meeting_zoom;

do $$
begin
  if to_regclass('public.meeting_zoom') is not null then
    raise exception 'meeting_zoom came back';
  end if;
  raise notice 'OK 0083 safe to re-run';
end $$;
