-- Pillar 3: stateful Human-in-the-Loop approval gates.

create type public.hitl_status_enum as enum (
    'pending',
    'approved',
    'rejected',
    'escalated',
    'timed_out'
);

create table public.hitl_approval_gates (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid not null references public.agent_graph_executions(id) on delete cascade,
    node_execution_id uuid references public.agent_node_executions(id) on delete cascade,
    trigger_reason text not null,
    confidence_score numeric(5,4),
    required_role public.user_role_enum not null default 'agent_operator',
    assigned_user_id uuid references auth.users(id),
    status public.hitl_status_enum not null default 'pending',
    reasoning_log_summary jsonb not null,
    -- Snapshot of what the agent proposed, so the reviewer sees the exact
    -- payload that will be committed on approval.
    input_payload jsonb not null default '{}'::jsonb,
    output_payload jsonb not null default '{}'::jsonb,
    human_feedback text,
    resolved_by uuid references auth.users(id),
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create index idx_hitl_pending
    on public.hitl_approval_gates(workspace_id, status, created_at desc);
create index idx_hitl_graph on public.hitl_approval_gates(graph_execution_id);

alter table public.hitl_approval_gates enable row level security;

-- A gate is visible to members who hold the role it demands, plus the roles
-- that oversee the workspace.
create policy hitl_select on public.hitl_approval_gates
    for select to authenticated
    using (
        private.has_workspace_role(
            workspace_id,
            array['workspace_owner', 'ai_administrator', 'compliance_auditor']::public.user_role_enum[]
        )
        or private.has_workspace_role(workspace_id, array[required_role])
    );

-- Resolving a gate is an UPDATE. USING controls which rows may be acted on;
-- WITH CHECK re-asserts the same predicate so a reviewer cannot move a gate to
-- another workspace or relabel the role that was required to approve it.
create policy hitl_resolve on public.hitl_approval_gates
    for update to authenticated
    using (
        status = 'pending'
        and (
            private.has_workspace_role(
                workspace_id,
                array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
            )
            or private.has_workspace_role(workspace_id, array[required_role])
        )
    )
    with check (
        private.has_workspace_role(
            workspace_id,
            array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
        )
        or private.has_workspace_role(workspace_id, array[required_role])
    );

-- Gates are raised by the runtime (service role), never by a browser client,
-- so no INSERT policy is granted.

grant select, update on public.hitl_approval_gates to authenticated;
