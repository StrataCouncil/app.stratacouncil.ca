\set ON_ERROR_STOP 1
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    raise notice 'OK refused: %', sqlerrm; return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated, anon;

-- 0061: the investor briefing is server-only; Super Admins can read it.
insert into investor_decks (id, title, page_count, published_at) values ('22222222-2222-2222-2222-222222222222', 'Deck', 3, now());
insert into investors (id, email, full_name, disclaimer_version, disclaimer_accepted_at, accredited_confirmed_at)
  values ('33333333-3333-3333-3333-333333333333', 'pat@example.com', 'Pat Investor', '2026-10-21', now(), now());
insert into investor_links (investor_id, token_hash, expires_at) values ('33333333-3333-3333-3333-333333333333', repeat('a', 64), now() + interval '30 days');
select pg_temp.expect_error($q$insert into investors (email, full_name, disclaimer_version, disclaimer_accepted_at, accredited_confirmed_at) values ('Pat@Example.com', 'X', 'v', now(), now())$q$, 'investors_email_check');

select investor_add_time('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 2, 30);
select investor_add_time('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 2, 500);
select pg_temp.expect('viewing time adds up, each report capped at 120s', (select seconds = 150 from investor_slide_time where page = 2));
select pg_temp.expect('and the investor''s last page is kept', (select last_page = 2 and last_seen_at is not null from investors));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, an ordinary member
select pg_temp.expect('members see no investors', (select count(*) = 0 from investors));
select pg_temp.expect('or their viewing', (select count(*) = 0 from investor_slide_time));
select pg_temp.expect_error($q$select count(*) from investor_links$q$, 'permission denied');
select pg_temp.expect_error($q$insert into investor_notes (investor_id, deck_id, page, body) values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, 'x')$q$, 'permission denied');
select pg_temp.expect_error($q$select investor_add_time('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, 10)$q$, 'permission denied');

set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
set test.aal = 'aal2';
select pg_temp.expect('a Super Admin reads investors', (select count(*) = 1 from investors));
select pg_temp.expect('and their viewing', (select count(*) = 1 from investor_slide_time));
select pg_temp.expect_error($q$update investors set full_name = 'x'$q$, 'permission denied');
set test.aal = 'aal1';
select pg_temp.expect('but not without two-step verification', (select count(*) = 0 from investors));

reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from investors$q$, 'permission denied');
