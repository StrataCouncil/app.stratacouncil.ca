-- doc01 §2 — MFA backup codes. Generated once, immediately after phone
-- enrollment (doc03 Stage 2a): ten single-use codes, shown in plaintext
-- exactly once on that screen, stored here only as a hash. Regenerating
-- (Account Settings, not yet built — doc00 changelog task #31) deletes
-- every existing row for the user and inserts 10 fresh ones; there is
-- only ever one live set per account, never an accumulating history.

create table public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,       -- sha-256 hex digest; the plaintext code is
                                  -- never stored anywhere after the one-time
                                  -- generation screen (lib/auth/mfa.ts)
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index mfa_backup_codes_user_id_idx on public.mfa_backup_codes (user_id);

alter table public.mfa_backup_codes enable row level security;

-- doc01 §6: "the narrowest visibility category in this list" — a user's
-- own recovery codes, full stop, not even a corp admin or Super Admin.
-- (A Super Admin's last-resort recovery path clears the enrolled MFA
-- factor via the service-role client, doc01 §2 — it doesn't read this
-- table.) Codes are written by the enrollment/regeneration server
-- action using the request-scoped client (lib/supabase/server.ts), which
-- runs as the authenticated user, so insert/update need the same
-- auth.uid() check as select.

create policy "mfa_backup_codes_select_own"
  on public.mfa_backup_codes for select
  using (auth.uid() = user_id);

create policy "mfa_backup_codes_insert_own"
  on public.mfa_backup_codes for insert
  with check (auth.uid() = user_id);

create policy "mfa_backup_codes_update_own"
  on public.mfa_backup_codes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "mfa_backup_codes_delete_own"
  on public.mfa_backup_codes for delete
  using (auth.uid() = user_id);
