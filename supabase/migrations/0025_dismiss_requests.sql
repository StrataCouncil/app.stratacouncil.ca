-- Turned-down requests on the "Connect a strata" page: the requester can
-- dismiss them, and the page stops showing them 7 days after the
-- decision. The rows themselves stay, as the record.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.corporation_join_requests add column if not exists dismissed_at timestamptz;
alter table public.corporation_creation_requests add column if not exists dismissed_at timestamptz;

-- Requesters can't update request rows (only the reviewer can), so
-- dismissing goes through this function: only your own, only once it
-- has been turned down.
create or replace function public.dismiss_my_request(p_kind text, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_kind = 'join' then
    update public.corporation_join_requests
      set dismissed_at = coalesce(dismissed_at, now())
      where id = p_request_id and requested_by = auth.uid() and status = 'denied';
  elsif p_kind = 'creation' then
    update public.corporation_creation_requests
      set dismissed_at = coalesce(dismissed_at, now())
      where id = p_request_id and requested_by = auth.uid() and status = 'denied';
  else
    raise exception 'Unknown request kind %.', p_kind;
  end if;
end;
$$;

grant execute on function public.dismiss_my_request(text, uuid) to authenticated;
