-- Council Training: background music on a module's introduction and
-- summary pages (2026-10-15).
--
-- Those two pages aren't slides (the player builds them from the module's
-- learning objectives), so their music is chosen on the module itself,
-- from the same shared library as slide music (0044). Deleting a track
-- from the library takes it off these pages too.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.training_modules
  add column if not exists intro_music_id uuid references public.training_music(id) on delete set null,
  add column if not exists outro_music_id uuid references public.training_music(id) on delete set null;
