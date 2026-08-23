-- Pillar 6 (workforce upskilling) and Pillar 7 (service-as-software / BIO ROI).

-- ============================================================================
-- WORKFORCE ENABLEMENT
-- ============================================================================
create table public.workforce_sop_templates (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    title text not null,
    workflow_domain text not null,
    generated_from_graph_id uuid references public.agent_graph_executions(id) on delete set null,
    sop_content jsonb not null,
    version int not null default 1,
    is_published boolean not null default false,
    created_at timestamptz not null default now()
);

create index idx_sop_workspace on public.workforce_sop_templates(workspace_id, is_published);

create table public.user_upskilling_progress (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    sop_id uuid not null references public.workforce_sop_templates(id) on delete cascade,
    completed_modules int not null default 0,
    total_modules int not null default 10,
    assessment_score numeric(5,2),
    interactive_prompts_executed int not null default 0,
    last_active_at timestamptz not null default now(),
    unique (user_id, sop_id)
);

-- ============================================================================
-- COMMERCIALIZATION / BIO ROI
-- ============================================================================
create table public.client_subscriptions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
    monthly_recurring_fee numeric(10,2) not null default 3500.00,
    sla_uptime_target numeric(5,2) not null default 99.90,
    status text not null default 'active',
    current_period_start timestamptz not null,
    current_period_end timestamptz not null
);

create table public.bio_baseline_metrics (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    metric_key text not null,
    baseline_value numeric(12,4) not null,
    unit text not null,
    created_at timestamptz not null default now(),
    unique (workspace_id, metric_key)
);

create table public.bio_outcome_logs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid not null references public.agent_graph_executions(id) on delete cascade,
    metric_key text not null,
    measured_value numeric(12,4) not null,
    deflected_cost_usd numeric(10,2) not null default 0.00,
    time_saved_minutes numeric(10,2) not null default 0.00,
    created_at timestamptz not null default now()
);

create index idx_bio_outcome_workspace on public.bio_outcome_logs(workspace_id, created_at desc);

create table public.sla_breach_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    breach_type text not null,
    severity text not null default 'warning',
    details jsonb not null,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create index idx_sla_breach_workspace on public.sla_breach_events(workspace_id, created_at desc);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.workforce_sop_templates enable row level security;
alter table public.user_upskilling_progress enable row level security;
alter table public.client_subscriptions enable row level security;
alter table public.bio_baseline_metrics enable row level security;
alter table public.bio_outcome_logs enable row level security;
alter table public.sla_breach_events enable row level security;

-- Published SOPs are readable by the whole workspace; drafts only by authors.
create policy sop_select on public.workforce_sop_templates
    for select to authenticated
    using (
        private.is_workspace_member(workspace_id)
        and (
            is_published
            or private.has_workspace_role(
                workspace_id,
                array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
            )
        )
    );

create policy sop_write on public.workforce_sop_templates
    for all to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

-- A user sees and edits only their own progress; managers see the whole
-- workspace's.
create policy upskilling_select on public.user_upskilling_progress
    for select to authenticated
    using (
        user_id = (select auth.uid())
        or private.has_workspace_role(
            workspace_id,
            array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
        )
    );

create policy upskilling_insert on public.user_upskilling_progress
    for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and private.is_workspace_member(workspace_id)
    );

create policy upskilling_update on public.user_upskilling_progress
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Billing and ROI are owner/admin reads; business users should not see
-- contract pricing.
create policy subscriptions_select on public.client_subscriptions
    for select to authenticated
    using (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator', 'compliance_auditor']::public.user_role_enum[]
    ));

create policy bio_baseline_select on public.bio_baseline_metrics
    for select to authenticated using (private.is_workspace_member(workspace_id));

create policy bio_outcome_select on public.bio_outcome_logs
    for select to authenticated using (private.is_workspace_member(workspace_id));

create policy sla_breach_select on public.sla_breach_events
    for select to authenticated using (private.is_workspace_member(workspace_id));

-- ============================================================================
-- DATA API GRANTS
-- ============================================================================
grant select, insert, update, delete on public.workforce_sop_templates to authenticated;
grant select, insert, update on public.user_upskilling_progress to authenticated;
grant select on public.client_subscriptions to authenticated;
grant select on public.bio_baseline_metrics to authenticated;
grant select on public.bio_outcome_logs to authenticated;
grant select on public.sla_breach_events to authenticated;
