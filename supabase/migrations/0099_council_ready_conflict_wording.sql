-- Council Training: Council Ready Module 1, conflict of interest (2026-11-21).
--
-- Module 1's blueprint said a council member with a conflict should "leave
-- the discussion if asked". Strata Property Act section 32 says the
-- opposite: they must leave the meeting while the matter is discussed
-- unless council asks them to stay to provide information, and while
-- council votes. Checked against the current consolidation on BC Laws.
--
-- Changes only that sentence in Module 1's settings (its blueprint), never
-- its slides or a published version; a blueprint an author has already
-- reworded is left alone. If Module 1 already has slides, fix the slide
-- that teaches section 32 in the module builder, then publish. Safe to
-- re-run. Paste the whole file into an empty SQL editor tab.

do $$
declare
  v_old text := $t$Conflicts of interest (section 32): disclose any direct or indirect interest in a matter council is deciding, leave the discussion if asked, and don't vote on it.$t$;
  v_new text := $t$Conflicts of interest (section 32): a council member with a direct or indirect interest in a contract or transaction with the strata, or in a matter council is considering, that could materially conflict with their duty as a council member must disclose it fully and promptly, must not vote on it, and must leave the meeting while it is discussed (unless council asks them to stay to provide information) and while council votes.$t$;
  v_count int;
begin
  update public.training_modules m
  set blueprint = replace(m.blueprint::text, v_old, v_new)::jsonb
  where m.curriculum_key = 'cr1'
    and position(v_old in m.blueprint::text) > 0;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise notice 'Module 1''s conflict of interest sentence was already changed (or the module was not found); nothing changed.';
  elsif exists (select 1 from public.training_slides sl join public.training_modules m on m.id = sl.module_id where m.curriculum_key = 'cr1') then
    raise notice 'Module 1 blueprint fixed. It already has slides: correct the slide on section 32 in the module builder, then publish.';
  else
    raise notice 'Module 1 blueprint fixed.';
  end if;
end $$;
