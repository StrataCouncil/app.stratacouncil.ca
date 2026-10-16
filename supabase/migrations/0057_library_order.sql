-- Library: Super Admins set the order of items (2026-10-16).
--
-- Items show in this order in the console and in every strata's Library
-- (moved with the arrows in the console). Until now they were newest first,
-- so existing items keep that order: most recently edited at the top. New
-- items go to the top.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.library_resources add column if not exists order_index integer;

update public.library_resources r
   set order_index = o.n
  from (select id, row_number() over (order by updated_at desc, created_at desc) as n
          from public.library_resources) o
 where r.id = o.id
   and not exists (select 1 from public.library_resources where order_index is not null);
