-- Tables read column by column (0072): every column but the hidden ones must
-- be readable by authenticated. Run after the first pass of migrations, as
-- production runs them, so a migration that adds a column and forgets its
-- grant fails here (0090 forgot meetings.video_link; the second pass, which
-- re-runs 0072, hid it).
do $$
declare
  missing text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into missing
  from information_schema.columns c
  where c.table_schema = 'public'
    and (
      (c.table_name = 'meetings' and c.column_name <> 'minutes_content')
      or (c.table_name = 'training_modules' and c.column_name <> 'checkout_token')
    )
    and not has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'select');
  if missing is not null then
    raise exception 'FAILED: authenticated can''t read %', missing;
  end if;
  raise notice 'OK: every visible column of meetings and training_modules is granted';
end $$;
