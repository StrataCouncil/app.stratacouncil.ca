-- The standalone Stratasphere assistant's conversation history (doc02 §4b).
-- Safe to run more than once. Run the whole file in one go.
--
-- Rules (resolved in doc01 §6 / doc02 §4b):
--   - Strictly private: a conversation, its messages and its projects are
--     readable and writable by the account holder only. Not fellow council
--     members, not the strata's admin, not Super Admins.
--   - Deleted, not retained, when the person is removed from the strata
--     (a deliberate exception to the platform's immutability posture: it's
--     personal search history, not a governance record).
--   - Scoped to one strata: a conversation belongs to the corporation it
--     was asked about.

create table if not exists public.conversation_projects (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists conversation_projects_owner_idx on public.conversation_projects (user_id, corporation_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 200),
  pinned boolean not null default false,
  project_id uuid references public.conversation_projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_owner_idx on public.conversations (user_id, corporation_id, updated_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conversation_messages_conversation_idx on public.conversation_messages (conversation_id, created_at);

alter table public.conversation_projects enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

-- The account holder, full stop. Creating a conversation or project also
-- needs an active membership in that strata.
drop policy if exists "owner only" on public.conversation_projects;
create policy "owner only" on public.conversation_projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_corporation_member(corporation_id));

drop policy if exists "owner only" on public.conversations;
create policy "owner only" on public.conversations
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_corporation_member(corporation_id)
    and (project_id is null or exists (
      select 1 from public.conversation_projects p
      where p.id = project_id and p.user_id = auth.uid() and p.corporation_id = conversations.corporation_id
    ))
  );

drop policy if exists "owner only" on public.conversation_messages;
create policy "owner only" on public.conversation_messages
  for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

grant select, insert, update, delete on public.conversation_projects, public.conversations, public.conversation_messages to authenticated;
grant all on public.conversation_projects, public.conversations, public.conversation_messages to service_role;

-- Removing a member deletes their Stratasphere history for that strata.
-- (Same function as 0017, plus the deletes at the end.)
create or replace function public.remove_corporation_member(p_corporation_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot text;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can remove members.';
  end if;

  if exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) then
    raise exception 'The admin can''t be removed. Assign Admin to another member first.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id and user_id = p_user_id;

  update public.corporation_memberships
    set status = 'removed', can_run_meetings = false
    where corporation_id = p_corporation_id and user_id = p_user_id
    returning lot_number into v_lot;

  if v_lot is not null and not exists (
    select 1 from public.corporation_memberships
    where corporation_id = p_corporation_id and lot_number = v_lot and status = 'active'
  ) then
    update public.owners_and_council set is_council_member = false, role = null, council_member_name = null
      where corporation_id = p_corporation_id and lot_number = v_lot;
  end if;

  update public.corporation_invites i
    set status = 'revoked'
    from public.profiles p
    where p.id = p_user_id
      and i.corporation_id = p_corporation_id
      and i.status = 'pending'
      and lower(i.invited_email) = lower(p.email);

  delete from public.conversations where corporation_id = p_corporation_id and user_id = p_user_id;
  delete from public.conversation_projects where corporation_id = p_corporation_id and user_id = p_user_id;
end;
$$;
