-- Makes SOP training progress mean something.
--
-- `user_upskilling_progress` has had INSERT/UPDATE policies, grants, and a
-- Server Action (`updateOwnProgress`) since migration ...05, and zero rows. The
-- action has never had a caller: the "Review SOP" control on the Workforce tab
-- is a bare <button> with no handler, left over from the mock. So the writer was
-- built and the button never was -- the inverse of the recurring defect in this
-- schema, where the column existed and nothing wrote it.
--
-- The result: Completion renders 0% and Human Supervisors renders 0 on every
-- SOP, for four generated procedures, three of them published to the team.
--
-- WHY THE COLUMNS CHANGE RATHER THAN JUST GETTING A WRITER.
--
-- `total_modules` defaulted to 10 and nothing anywhere defined what those ten
-- were. The SOPs have four steps. Wiring a button to the old shape would have
-- rendered "3 of 10 complete" against a denominator with no referent -- a
-- fabricated number on a governance dashboard, which is the thing this codebase
-- refuses everywhere else. The denominator belongs to the PROCEDURE, not to a
-- person's progress row, so it is dropped here and read from
-- `workforce_sop_templates.sop_content->'steps'`, where it cannot drift.
--
-- `completed_modules` was a bare count, which cannot answer the question a
-- supervisor actually asks: not "how far through are they" but "have they done
-- the step that needs a human". So progress records WHICH steps, and the count
-- becomes generated from that -- two copies that can disagree is the same
-- objection that ruled out `current_job_id` on the queue.
--
-- Versioning needs no special handling: `generateSop` INSERTS a new row with a
-- bumped `version`, and `sop_id` is a foreign key to that row, so progress
-- belongs to the version it was made against. A regenerated procedure starts
-- its own record rather than inheriting ticks against steps that may have
-- changed underneath them.

-- Safe as a destructive change: the table has no rows.
alter table public.user_upskilling_progress
    drop column if exists completed_modules,
    drop column if exists total_modules;

-- Which steps this person has completed, by the step's `order` in
-- `sop_content.steps`. An array of integers.
alter table public.user_upskilling_progress
    add column if not exists completed_steps jsonb not null default '[]'::jsonb;

alter table public.user_upskilling_progress
    drop constraint if exists upskilling_completed_steps_is_array;

alter table public.user_upskilling_progress
    add constraint upskilling_completed_steps_is_array
    check (jsonb_typeof(completed_steps) = 'array');

comment on column public.user_upskilling_progress.completed_steps is
    'Step `order` values from the SOP this row points at. The denominator is the SOP''s own step count, never stored here.';

-- Generated, so it cannot disagree with the array it summarises.
alter table public.user_upskilling_progress
    add column if not exists completed_count int
    generated always as (jsonb_array_length(completed_steps)) stored;

-- Enrollment is the existence of the row: a person who has started a procedure
-- but ticked nothing is a real state, and one the Human Supervisors count must
-- include. `last_active_at` already carries recency.
comment on table public.user_upskilling_progress is
    'One row per person per SOP version. The row existing means enrolled; completed_steps means how far.';
