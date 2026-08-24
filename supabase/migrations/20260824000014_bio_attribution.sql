-- Pillars 6 and 7: give the workforce and BIO tables writers.
--
-- Both have been readable since migration ...05 and nothing ever wrote to them,
-- which is why the ROI tab has always shown $0.00.

-- ============================================================================
-- WHERE ROI NUMBERS COME FROM
-- ============================================================================
-- The tempting shortcut is to have the runtime estimate what each run "saved"
-- and write that. That would be fabricated revenue — the platform grading its
-- own homework, and precisely the class of claim the critic gate exists to
-- refuse elsewhere.
--
-- Instead: a human records a baseline ("this task took us 45 minutes by hand,
-- done by someone on $65/hour"), and a human attributes a completed run to it.
-- Every figure on the ROI tab then traces to a measurement a person asserted
-- and a run that demonstrably happened.
--
-- The rate lives on the baseline rather than on the workspace because tasks are
-- done by differently-paid people: a partner reviewing contracts and a
-- coordinator re-keying invoices do not save the business the same amount per
-- hour recovered.
alter table public.bio_baseline_metrics
    add column if not exists hourly_rate_usd numeric(10,2) not null default 0.00;

alter table public.bio_baseline_metrics
    add column if not exists description text;

comment on column public.bio_baseline_metrics.baseline_value is
    'Manual effort per occurrence, in the stated unit, as measured by a human before automation.';
comment on column public.bio_baseline_metrics.hourly_rate_usd is
    'Loaded hourly cost of the person who used to do this work.';

-- One outcome per run per metric. Attributing the same run twice would double
-- count the saving, and an ROI figure that inflates on a double click is worse
-- than no ROI figure.
create unique index if not exists idx_bio_outcome_unique_attribution
    on public.bio_outcome_logs(graph_execution_id, metric_key);

-- ============================================================================
-- RLS AND GRANTS
-- ============================================================================
-- Baselines and outcomes are business measurements, so they are readable by
-- every member and writable by the roles that own commercial reporting.

create policy bio_baseline_insert on public.bio_baseline_metrics
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy bio_baseline_update on public.bio_baseline_metrics
    for update to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy bio_baseline_delete on public.bio_baseline_metrics
    for delete to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy bio_outcome_insert on public.bio_outcome_logs
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy bio_outcome_delete on public.bio_outcome_logs
    for delete to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

grant select, insert, update, delete on public.bio_baseline_metrics to authenticated;
grant select, insert, delete on public.bio_outcome_logs to authenticated;

-- ============================================================================
-- SOP TEMPLATES AND PROGRESS
-- ============================================================================
-- Policies already exist from migration ...05 (`sop_write` FOR ALL for owners
-- and administrators, and the three `upskilling_*` policies). Only the grants
-- were missing, so the client could never actually write through them.

grant select, insert, update, delete on public.workforce_sop_templates to authenticated;
grant select, insert, update on public.user_upskilling_progress to authenticated;
