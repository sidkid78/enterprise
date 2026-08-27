-- Pillar 1 (multi-agent execution + MCP registry) and Pillar 2 (governance
-- control plane: hash-chained audit ledger, guardrail events).

create type public.mcp_transport_enum as enum ('sse', 'stdio', 'http_stream');

create type public.graph_status_enum as enum (
    'pending',
    'running',
    'waiting_hitl',
    'completed',
    'failed',
    'halted_finops'
);

-- ============================================================================
-- MCP REGISTRY
-- ============================================================================
create table public.mcp_servers (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    server_name text not null,
    transport_type public.mcp_transport_enum not null default 'sse',
    endpoint_url text not null,
    encrypted_auth_metadata jsonb not null default '{}'::jsonb,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.mcp_tools (
    id uuid primary key default gen_random_uuid(),
    mcp_server_id uuid not null references public.mcp_servers(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    tool_name text not null,
    description text,
    input_schema jsonb not null default '{}'::jsonb,
    is_enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (mcp_server_id, tool_name)
);

create trigger trg_mcp_servers_updated_at
    before update on public.mcp_servers
    for each row execute function private.set_updated_at();

-- ============================================================================
-- GRAPH / NODE EXECUTION
-- ============================================================================
create table public.agent_graph_executions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    orchestrator_name text not null,
    framework_type text not null default 'interactions_api',
    status public.graph_status_enum not null default 'pending',
    root_prompt text not null,
    execution_context jsonb not null default '{}'::jsonb,
    final_output jsonb,
    -- Interactions API handle. Persisting this is what makes HITL resume work:
    -- the next turn passes it as previous_interaction_id rather than replaying
    -- a manual history array.
    root_interaction_id text,
    created_by uuid references auth.users(id),
    started_at timestamptz not null default now(),
    completed_at timestamptz
);

create index idx_graph_exec_workspace_status
    on public.agent_graph_executions(workspace_id, status);
create index idx_graph_exec_started
    on public.agent_graph_executions(workspace_id, started_at desc);

create table public.agent_node_executions (
    id uuid primary key default gen_random_uuid(),
    graph_execution_id uuid not null references public.agent_graph_executions(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    node_id text not null,
    agent_role text not null,
    model_routing_used text not null,
    input_payload jsonb not null,
    output_payload jsonb,
    node_status text not null default 'running',
    latency_ms int,
    prompt_tokens int not null default 0,
    completion_tokens int not null default 0,
    cost_usd numeric(12,6) not null default 0,
    -- Node ordering within the DAG. The dashboard's DagNode.dependencies.
    depends_on text[] not null default '{}',
    -- Interaction this node's output came from, for trace drill-down.
    interaction_id text,
    retry_count int not null default 0,
    created_at timestamptz not null default now(),
    unique (graph_execution_id, node_id)
);

create index idx_node_exec_graph on public.agent_node_executions(graph_execution_id);

create table public.agent_messages (
    id uuid primary key default gen_random_uuid(),
    graph_execution_id uuid not null references public.agent_graph_executions(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    sender_agent text not null,
    recipient_agent text not null,
    message_type text not null default 'agent_to_agent',
    content jsonb not null,
    created_at timestamptz not null default now()
);

create index idx_agent_messages_graph on public.agent_messages(graph_execution_id);

-- ============================================================================
-- IMMUTABLE AUDIT LEDGER
-- ============================================================================
create table public.agent_audit_ledger (
    sequence_id bigserial primary key,
    ledger_uuid uuid unique not null default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid references public.agent_graph_executions(id) on delete cascade,
    node_execution_id uuid references public.agent_node_executions(id) on delete cascade,
    agent_id text not null,
    action_type text not null,
    payload jsonb not null,
    previous_hash text not null,
    current_hash text not null,
    created_at timestamptz not null default now()
);

create index idx_audit_ledger_workspace on public.agent_audit_ledger(workspace_id, sequence_id desc);

-- Chain each row to the previous one for the same workspace. Both hash columns
-- are computed server-side and any client-supplied value is ignored, so the
-- chain cannot be forged through the Data API.
create or replace function private.compute_ledger_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_previous_hash text;
begin
    select current_hash
      into v_previous_hash
      from public.agent_audit_ledger
     where workspace_id = new.workspace_id
     order by sequence_id desc
     limit 1;

    new.previous_hash := coalesce(v_previous_hash, repeat('0', 64));
    new.current_hash := encode(
        extensions.digest(
            new.previous_hash
                || new.sequence_id::text
                || new.workspace_id::text
                || new.payload::text,
            'sha256'
        ),
        'hex'
    );
    return new;
end;
$$;

create trigger trg_ledger_hash
    before insert on public.agent_audit_ledger
    for each row execute function private.compute_ledger_hash();

-- Tamper-evidence: the ledger is append-only even for privileged roles.
create or replace function private.enforce_immutable_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'agent_audit_ledger is append-only; % is not permitted', tg_op;
end;
$$;

create trigger trg_ledger_no_update
    before update or delete on public.agent_audit_ledger
    for each row execute function private.enforce_immutable_ledger();

create table public.guardrail_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid references public.agent_graph_executions(id) on delete cascade,
    gate_layer text not null,
    verdict text not null,
    risk_score numeric(5,4),
    raw_payload_snippet text,
    sanitized_payload jsonb,
    created_at timestamptz not null default now()
);

create index idx_guardrail_events_workspace on public.guardrail_events(workspace_id, created_at desc);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.mcp_servers enable row level security;
alter table public.mcp_tools enable row level security;
alter table public.agent_graph_executions enable row level security;
alter table public.agent_node_executions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_audit_ledger enable row level security;
alter table public.guardrail_events enable row level security;

-- Read: any member of the workspace.
create policy mcp_servers_select on public.mcp_servers
    for select to authenticated using (private.is_workspace_member(workspace_id));
create policy mcp_tools_select on public.mcp_tools
    for select to authenticated using (private.is_workspace_member(workspace_id));
create policy graph_exec_select on public.agent_graph_executions
    for select to authenticated using (private.is_workspace_member(workspace_id));
create policy node_exec_select on public.agent_node_executions
    for select to authenticated using (private.is_workspace_member(workspace_id));
create policy agent_messages_select on public.agent_messages
    for select to authenticated using (private.is_workspace_member(workspace_id));
create policy guardrail_events_select on public.guardrail_events
    for select to authenticated using (private.is_workspace_member(workspace_id));

-- The ledger is readable by compliance auditors and administrators only.
create policy audit_ledger_select on public.agent_audit_ledger
    for select to authenticated
    using (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator', 'compliance_auditor']::public.user_role_enum[]
    ));

-- MCP server config is administrative.
create policy mcp_servers_write on public.mcp_servers
    for all to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy mcp_tools_write on public.mcp_tools
    for all to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

-- Operators may launch a run; the runtime writes nodes/messages/ledger with the
-- service role, so no client INSERT policy is granted for those.
create policy graph_exec_insert on public.agent_graph_executions
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator', 'agent_operator']::public.user_role_enum[]
    ));

-- ============================================================================
-- DATA API GRANTS
-- ============================================================================
grant select on public.mcp_servers to authenticated;
grant select on public.mcp_tools to authenticated;
grant select, insert on public.agent_graph_executions to authenticated;
grant select on public.agent_node_executions to authenticated;
grant select on public.agent_messages to authenticated;
grant select on public.agent_audit_ledger to authenticated;
grant select on public.guardrail_events to authenticated;
grant insert, update, delete on public.mcp_servers to authenticated;
grant insert, update, delete on public.mcp_tools to authenticated;
