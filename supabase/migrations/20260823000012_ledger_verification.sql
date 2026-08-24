-- Governance visibility: makes the audit ledger checkable, and closes a hole in
-- the append-only guarantee it depends on.

-- ============================================================================
-- TRUNCATE BYPASSES THE APPEND-ONLY TRIGGER
-- ============================================================================
-- enforce_immutable_ledger is FOR EACH ROW, and TRUNCATE fires no row triggers
-- and consults no RLS policy. Supabase's default privileges grant ALL on public
-- tables to anon and authenticated, TRUNCATE included, so the guarantee the
-- ledger's whole value rests on was defeatable in one statement. Verified
-- before writing this: `set role authenticated; truncate agent_audit_ledger;`
-- removed all 87 rows without the trigger firing.
--
-- Not reachable through PostgREST, which exposes no TRUNCATE verb — so this was
-- a defence-in-depth failure rather than a live exploit. Fixed at both layers.

-- The real fix. A statement-level trigger cannot be granted around, so the
-- guarantee now holds for every role that is not able to drop the trigger.
create or replace function private.enforce_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'agent_audit_ledger is append-only; TRUNCATE is not permitted';
end;
$$;

create trigger trg_ledger_no_truncate
    before truncate on public.agent_audit_ledger
    for each statement execute function private.enforce_no_truncate();

-- Defence in depth: no client role has any business truncating any of these.
-- Written out per table rather than looped so that a table added later is not
-- silently assumed to be covered.
revoke truncate on
    public.agent_audit_ledger,
    public.guardrail_events,
    public.agent_graph_executions,
    public.agent_node_executions,
    public.agent_messages,
    public.hitl_approval_gates,
    public.finops_budget_controls,
    public.finops_token_logs,
    public.semantic_cache,
    public.workspaces,
    public.workspace_members,
    public.mcp_servers,
    public.mcp_tools,
    public.knowledge_bases,
    public.document_parents,
    public.document_chunks,
    public.workforce_sop_templates,
    public.user_upskilling_progress,
    public.client_subscriptions,
    public.bio_baseline_metrics,
    public.bio_outcome_logs,
    public.sla_breach_events
from anon, authenticated;

-- ============================================================================
-- CHAIN VERIFICATION
-- ============================================================================
-- Recomputes the hash chain and reports the first place it breaks. The hash
-- input must match compute_ledger_hash exactly:
--   previous_hash || sequence_id::text || workspace_id::text || payload::text
--
-- SECURITY INVOKER, so the caller's RLS on agent_audit_ledger applies and a
-- member can only verify a workspace they are already allowed to read. Making
-- this DEFINER would turn "verify my own chain" into "read every tenant's".

create or replace function public.verify_ledger_chain(p_workspace_id uuid)
returns table (
    entry_count bigint,
    verified_through bigint,
    broken_at bigint,
    failure text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    r record;
    v_expected_previous text := repeat('0', 64);
    v_recomputed text;
begin
    entry_count := 0;
    verified_through := null;
    broken_at := null;
    failure := null;

    for r in
        select sequence_id, workspace_id, payload, previous_hash, current_hash
          from public.agent_audit_ledger
         where workspace_id = p_workspace_id
         order by sequence_id
    loop
        entry_count := entry_count + 1;

        -- Does this entry point at the one before it?
        if r.previous_hash is distinct from v_expected_previous then
            broken_at := r.sequence_id;
            failure := 'link_mismatch';
            return next;
            return;
        end if;

        v_recomputed := encode(
            extensions.digest(
                r.previous_hash
                    || r.sequence_id::text
                    || r.workspace_id::text
                    || r.payload::text,
                'sha256'
            ),
            'hex'
        );

        -- Does the stored hash still match the content it covers?
        if v_recomputed is distinct from r.current_hash then
            broken_at := r.sequence_id;
            failure := 'hash_mismatch';
            return next;
            return;
        end if;

        verified_through := r.sequence_id;
        v_expected_previous := r.current_hash;
    end loop;

    return next;
end;
$$;

revoke all on function public.verify_ledger_chain(uuid) from public;
grant execute on function public.verify_ledger_chain(uuid) to authenticated, service_role;
