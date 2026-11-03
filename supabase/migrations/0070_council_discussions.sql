-- Council discussions (2026-11-03): votes between meetings.
--
-- A council member opens a discussion: a motion with its background,
-- financial implications and risks, plus attachments. Council votes For,
-- Against or Abstain, or declares a conflict of interest and is recused
-- (Strata Property Act s. 32). Members comment while it's open. Only the
-- author closes it. A discussion never decides anything by itself: a
-- motion that passed (a majority in favour) is awaiting ratification at a
-- council meeting (its agenda item carries discussionId), and when that
-- meeting adjourns the result there marks it ratified or not ratified. One
-- that didn't pass is simply closed.
--
-- Who: council only, meaning an active member holding a council role
-- (president, vice president, treasurer, secretary or member at large).
-- Not managers, not owners, not a strata's app admin who isn't on
-- council, and not Super Admins. A member who is recused still sees the
-- motion and their own vote, but not the others' votes or the comments.
--
-- The voters are fixed when the discussion opens (discussion_voters), so
-- the count can't move under a vote in progress. Once anyone has voted,
-- the motion and its background can't be changed. Names are kept beside
-- each vote and comment, so the record survives an account being deleted
-- (those keys clear; no table here has a corporation_id but discussions,
-- which goes with its strata).
--
-- Free tier: one discussion per strata; after that, a subscription.
--
-- Grants: authenticated may read (RLS: council only) and may write only
-- through the functions below. The service role registers attachments
-- (after checking the upload landed) and the record PDF. The
-- discussion-files bucket is private and server-only: files are served
-- through short-lived signed links after the same council check.
--
-- Safe to re-run. Run the whole file in one go.

-- ── Council ────────────────────────────────────────────────────────────
create or replace function public.is_on_council(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.corporation_memberships m
    join public.corporation_role_assignments r
      on r.corporation_id = m.corporation_id and r.user_id = m.user_id
    where m.corporation_id = target_corporation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large')
  );
$$;
revoke all on function public.is_on_council(text) from public, anon;
grant execute on function public.is_on_council(text) to authenticated, service_role;

-- ── Tables ─────────────────────────────────────────────────────────────
create table if not exists public.discussions (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  background text not null default '' check (char_length(background) <= 10000),
  financial text not null default '' check (char_length(financial) <= 10000),
  risks text not null default '' check (char_length(risks) <= 10000),
  motion text not null check (char_length(btrim(motion)) between 1 and 4000),
  created_by uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- open -> closed (by the author) -> ratified | not_ratified (by a council
  -- meeting's adjournment). The app shows a closed one whose result is
  -- 'supported' as "awaiting ratification".
  status text not null default 'open' check (status in ('open', 'closed', 'ratified', 'not_ratified')),
  closed_at timestamptz,
  -- The count when it closed (lib/discussions/tally.ts does the same sums).
  result text check (result in ('supported', 'not_supported', 'no_majority')),
  votes_for int,
  votes_against int,
  votes_abstain int,
  votes_recused int,
  votes_missing int,
  -- The vote record filed in Meetings & Records.
  record_document_id uuid references public.documents(id) on delete set null,
  ratified_meeting_id uuid references public.meetings(id) on delete set null,
  ratified_at timestamptz,
  constraint discussions_closed check ((status = 'open') = (closed_at is null) and (status = 'open') = (result is null))
);
create index if not exists discussions_corporation_idx on public.discussions (corporation_id, created_at desc);

create table if not exists public.discussion_voters (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null default '',
  -- Null until they vote. Recused: a declared conflict of interest (s. 32).
  vote text check (vote in ('for', 'against', 'abstain', 'recused')),
  recusal_reason text check (char_length(recusal_reason) <= 1000),
  voted_at timestamptz,
  unique (discussion_id, user_id),
  constraint discussion_voters_reason check (vote is distinct from 'recused' or char_length(btrim(coalesce(recusal_reason, ''))) > 0)
);

create table if not exists public.discussion_comments (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists discussion_comments_idx on public.discussion_comments (discussion_id, created_at);

create table if not exists public.discussion_files (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  -- Null: attached to the motion. Otherwise: to that comment.
  comment_id uuid references public.discussion_comments(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 300),
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists discussion_files_idx on public.discussion_files (discussion_id);

-- ── Who sees what ──────────────────────────────────────────────────────
-- On council, and not recused from this one.
create or replace function public.discussion_open_to_me(p_discussion_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.discussions d
    where d.id = p_discussion_id and public.is_on_council(d.corporation_id)
  ) and not exists (
    select 1 from public.discussion_voters v
    where v.discussion_id = p_discussion_id and v.user_id = auth.uid() and v.vote = 'recused'
  );
$$;
revoke all on function public.discussion_open_to_me(uuid) from public, anon;
grant execute on function public.discussion_open_to_me(uuid) to authenticated, service_role;

alter table public.discussions enable row level security;
alter table public.discussion_voters enable row level security;
alter table public.discussion_comments enable row level security;
alter table public.discussion_files enable row level security;

revoke all on public.discussions, public.discussion_voters, public.discussion_comments, public.discussion_files from anon, authenticated;
grant select on public.discussions, public.discussion_voters, public.discussion_comments, public.discussion_files to authenticated;
grant all on public.discussions, public.discussion_voters, public.discussion_comments, public.discussion_files to service_role;

drop policy if exists "council reads discussions" on public.discussions;
create policy "council reads discussions" on public.discussions
  for select to authenticated using (public.is_on_council(corporation_id));

drop policy if exists "council reads votes" on public.discussion_voters;
create policy "council reads votes" on public.discussion_voters
  for select to authenticated using (
    user_id = auth.uid() and exists (select 1 from public.discussions d where d.id = discussion_id and public.is_on_council(d.corporation_id))
    or public.discussion_open_to_me(discussion_id)
  );

drop policy if exists "council reads comments" on public.discussion_comments;
create policy "council reads comments" on public.discussion_comments
  for select to authenticated using (public.discussion_open_to_me(discussion_id));

-- The motion's own files are part of the motion, so a recused member sees
-- them; files on comments follow the comments.
drop policy if exists "council reads files" on public.discussion_files;
create policy "council reads files" on public.discussion_files
  for select to authenticated using (
    public.discussion_open_to_me(discussion_id)
    or (comment_id is null and exists (select 1 from public.discussions d where d.id = discussion_id and public.is_on_council(d.corporation_id)))
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('discussion-files', 'discussion-files', false, 52428800)
on conflict (id) do nothing;

-- ── Opening, editing, voting, commenting, closing ──────────────────────
create or replace function public.create_discussion(
  p_corporation_id text, p_title text, p_background text, p_financial text, p_risks text, p_motion text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_on_council(p_corporation_id) then
    raise exception 'Only council members can start a discussion.';
  end if;
  -- One at a time per strata, so two can't both take the free one.
  perform 1 from public.strata_corporations where strata_plan_number = p_corporation_id for update;
  if not exists (select 1 from public.subscriptions s where s.corporation_id = p_corporation_id and s.status = 'active')
     and exists (select 1 from public.discussions d where d.corporation_id = p_corporation_id) then
    raise exception 'free_discussion_used: Discussions after the first need a Stratasphere subscription.';
  end if;
  insert into public.discussions (corporation_id, title, background, financial, risks, motion, created_by, author_name)
  values (
    p_corporation_id, btrim(p_title), coalesce(p_background, ''), coalesce(p_financial, ''), coalesce(p_risks, ''), btrim(p_motion),
    auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), '')
  )
  returning id into v_id;
  -- The voters: council as it stands now.
  insert into public.discussion_voters (discussion_id, user_id, name)
  select distinct v_id, m.user_id, coalesce(p.full_name, '')
  from public.corporation_memberships m
  join public.corporation_role_assignments r on r.corporation_id = m.corporation_id and r.user_id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id and m.status = 'active'
    and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large');
  return v_id;
end;
$$;

create or replace function public.update_discussion(
  p_discussion_id uuid, p_title text, p_background text, p_financial text, p_risks text, p_motion text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.is_on_council(d.corporation_id) or d.created_by is distinct from auth.uid() then
    raise exception 'Only the person who started this discussion can change it.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  if exists (select 1 from public.discussion_voters where discussion_id = p_discussion_id and vote is not null) then
    raise exception 'motion_locked: Someone has voted, so the motion can no longer be changed.';
  end if;
  update public.discussions
    set title = btrim(p_title), background = coalesce(p_background, ''), financial = coalesce(p_financial, ''),
        risks = coalesce(p_risks, ''), motion = btrim(p_motion), updated_at = now()
    where id = p_discussion_id;
end;
$$;

create or replace function public.cast_discussion_vote(p_discussion_id uuid, p_vote text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.is_on_council(d.corporation_id) then
    raise exception 'Only council members can vote.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  if p_vote not in ('for', 'against', 'abstain', 'recused') then
    raise exception 'Choose For, Against, Abstain or a conflict of interest.';
  end if;
  if p_vote = 'recused' and char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say briefly what the conflict of interest is.';
  end if;
  update public.discussion_voters
    set vote = p_vote, recusal_reason = case when p_vote = 'recused' then btrim(p_reason) end, voted_at = now()
    where discussion_id = p_discussion_id and user_id = auth.uid();
  if not found then
    raise exception 'You weren''t on council when this discussion opened, so you can''t vote on it.';
  end if;
end;
$$;

create or replace function public.add_discussion_comment(p_discussion_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
  v_id uuid;
begin
  select * into d from public.discussions where id = p_discussion_id;
  if d.id is null or not public.discussion_open_to_me(p_discussion_id) then
    raise exception 'Only council members taking part can comment.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  insert into public.discussion_comments (discussion_id, user_id, author_name, body)
  values (p_discussion_id, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), ''), btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

-- Closing counts the votes. A majority means more than half of the voters
-- who aren't recused (4 of 7, say); without one either way the result is
-- "no majority". Only a supported motion goes to a meeting for ratification.
create or replace function public.close_discussion(p_discussion_id uuid)
returns public.discussions
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
  v_for int; v_against int; v_abstain int; v_recused int; v_missing int; v_needed int;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.is_on_council(d.corporation_id) or d.created_by is distinct from auth.uid() then
    raise exception 'Only the person who started this discussion can close it.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is already closed.';
  end if;
  select count(*) filter (where vote = 'for'), count(*) filter (where vote = 'against'),
         count(*) filter (where vote = 'abstain'), count(*) filter (where vote = 'recused'),
         count(*) filter (where vote is null)
    into v_for, v_against, v_abstain, v_recused, v_missing
    from public.discussion_voters where discussion_id = p_discussion_id;
  v_needed := (v_for + v_against + v_abstain + v_missing) / 2 + 1;
  update public.discussions
    set status = 'closed', closed_at = now(),
        result = case when v_for >= v_needed then 'supported' when v_against >= v_needed then 'not_supported' else 'no_majority' end,
        votes_for = v_for, votes_against = v_against, votes_abstain = v_abstain, votes_recused = v_recused, votes_missing = v_missing,
        updated_at = now()
    where id = p_discussion_id
    returning * into d;
  return d;
end;
$$;

revoke all on function public.create_discussion(text, text, text, text, text, text) from public, anon;
revoke all on function public.update_discussion(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.cast_discussion_vote(uuid, text, text) from public, anon;
revoke all on function public.add_discussion_comment(uuid, text) from public, anon;
revoke all on function public.close_discussion(uuid) from public, anon;
grant execute on function public.create_discussion(text, text, text, text, text, text) to authenticated;
grant execute on function public.update_discussion(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.cast_discussion_vote(uuid, text, text) to authenticated;
grant execute on function public.add_discussion_comment(uuid, text) to authenticated;
grant execute on function public.close_discussion(uuid) to authenticated;

-- ── Ratification at a council meeting ──────────────────────────────────
-- When a council meeting adjourns, each agenda item carrying the
-- discussionId of a passed (supported) discussion settles it: a carried motion ratifies it, a
-- defeated one doesn't. Items deferred or left undecided leave it closed,
-- ready for another meeting.
create or replace function public.settle_discussion_ratifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
begin
  if new.status <> 'ADJOURNED' or old.status = 'ADJOURNED' or new.type <> 'council' then
    return new;
  end if;
  for it in select * from jsonb_array_elements(coalesce(new.agenda, '[]'::jsonb)) loop
    if coalesce(it ->> 'discussionId', '') ~ '^[0-9a-f-]{36}$'
       and coalesce((it ->> 'done')::boolean, false)
       and it -> 'motion' ->> 'outcome' in ('CARRIED', 'DEFEATED') then
      update public.discussions
        set status = case when it -> 'motion' ->> 'outcome' = 'CARRIED' then 'ratified' else 'not_ratified' end,
            ratified_meeting_id = new.id, ratified_at = now(), updated_at = now()
        where id = (it ->> 'discussionId')::uuid and corporation_id = new.corporation_id
          and status = 'closed' and result = 'supported';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.settle_discussion_ratifications() from public, anon, authenticated;

drop trigger if exists meetings_settle_discussions on public.meetings;
create trigger meetings_settle_discussions
  after update of status on public.meetings
  for each row execute function public.settle_discussion_ratifications();
