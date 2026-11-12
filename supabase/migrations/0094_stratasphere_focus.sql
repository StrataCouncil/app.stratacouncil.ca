-- One Stratasphere assistant, PR 4a (2026-11-12, docs/learn-decide-remember.md §5).
--
-- conversation_messages.focus: what the person was looking at when they
-- asked (a meeting, an agenda item, a document, or a carried discussion),
-- saved with the question so the conversation can say where it started.
-- A small reference and the label the server worked out for it, never
-- record text: the server re-reads the record with the person's own access
-- each time (lib/ai/focus.ts).
--
-- Grants: none needed. conversation_messages is granted table-wide (not
-- column by column like meetings, 0072), so the new column is covered by
-- the existing grants and RLS (a person's own conversations only, 0019).
--
-- Safe to re-run.

alter table public.conversation_messages add column if not exists focus jsonb;
alter table public.conversation_messages drop constraint if exists conversation_messages_focus_check;
alter table public.conversation_messages add constraint conversation_messages_focus_check
  check (focus is null or (jsonb_typeof(focus) = 'object' and pg_column_size(focus) <= 2048));
