-- Makes gate resolution a role HIERARCHY rather than a flat membership test,
-- and stops escalation from parking a run forever.
--
-- `ai_docs` (Drive) -> Stateful HITL Gates -> Role-based access-control
-- specifies a power matrix — workspace_owner 5, ai_administrator 4,
-- compliance_auditor 3, agent_operator 2, business_user 1 — resolved by
-- "userRolePower >= requiredRolePower". Two things diverged from that.
--
-- FIRST: `hitl_resolve` tested manager-roles OR an exact match on
-- `required_role`. Owner and administrator came out right by accident, being
-- above everything anyway, but a compliance_auditor could not clear an
-- agent_operator gate — the role whose entire job is auditing policy
-- violations was strictly less able than the hierarchy says it is. An exact
-- match is not a hierarchy; it is five unrelated keys.
--
-- SECOND, and worse: the policy required `status = 'pending'`, while the
-- escalate action moves a gate to 'escalated'. So escalating a gate removed it
-- from the queue view AND from the set of rows the policy would ever admit
-- again. Nobody could resolve it afterwards — not an administrator, not the
-- owner — and the run stayed in waiting_hitl indefinitely. Never observed in
-- practice only because nobody had yet pressed the button: 11 approved, 3
-- rejected, 3 pending, 0 escalated.
--
-- The spec does not treat escalation as an ending. It "updates the
-- required_role on the active record ... restricting resolution power to
-- high-tier personnel" — the gate stays open, it just needs a bigger key. So
-- 'escalated' becomes an OPEN state here, not a terminal one.

/**
 * The power matrix, as one function.
 *
 * Kept in SQL rather than only in TypeScript because the database is the
 * authority on this and the client copy is an affordance. Two encodings of a
 * hierarchy will eventually disagree, and the one that decides is this one.
 */
create or replace function private.role_power(p_role public.user_role_enum)
returns int
language sql
immutable
set search_path = ''
as $fn$
    select case p_role
        when 'workspace_owner'    then 5
        when 'ai_administrator'   then 4
        when 'compliance_auditor' then 3
        when 'agent_operator'     then 2
        when 'business_user'      then 1
        else 0
    end;
$fn$;

/**
 * Whether the caller's role in a workspace meets or exceeds a required role.
 *
 * SECURITY DEFINER for the same single reason as its neighbours: a policy on
 * workspace_members cannot select from workspace_members. It filters on
 * auth.uid() internally, so it cannot widen access beyond the caller.
 *
 * A caller with no membership row has no power, not zero power that might
 * still clear a floor — `role_power` returns 0 for an unknown role and
 * `p_required` is always a real enum member, so 0 >= required is never true.
 */
create or replace function private.has_role_power(
    p_workspace_id uuid,
    p_required public.user_role_enum
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
    select exists (
        select 1
        from public.workspace_members m
        where m.workspace_id = p_workspace_id
          and m.user_id = (select auth.uid())
          and private.role_power(m.role) >= private.role_power(p_required)
    );
$fn$;

revoke all on function private.role_power(public.user_role_enum) from public;
revoke all on function private.has_role_power(uuid, public.user_role_enum) from public;
grant execute on function private.role_power(public.user_role_enum) to authenticated;
grant execute on function private.has_role_power(uuid, public.user_role_enum) to authenticated;

-- ============================================================================
-- The policy
-- ============================================================================
-- An OPEN gate is one that has not been decided. Both 'pending' and
-- 'escalated' are open: escalation raised the bar, it did not answer the
-- question. 'approved' and 'rejected' stay closed, so a decision cannot be
-- quietly revised after the DAG has already acted on it.

-- USING and WITH CHECK carry different questions here, and the split matters.
--
-- USING sees the row AS IT STANDS: may you act on this gate at all? That is
-- the power comparison.
--
-- WITH CHECK sees the row AS PROPOSED, and it must NOT repeat the power test.
-- Escalation is precisely the act of handing a gate to someone more senior, so
-- the operator doing it never has power over the value they are writing — an
-- agent_operator raising a gate to ai_administrator would fail its own update.
-- All WITH CHECK can usefully say is that the row stays in a workspace the
-- caller belongs to, which stops a resolution from relocating the gate.
--
-- The rule WITH CHECK cannot express — that required_role may only be raised,
-- never lowered — needs to compare OLD against NEW, which no policy can do. It
-- lives in the trigger below. Without it, "resolve" would double as "make this
-- gate resolvable by anyone": drop an ai_administrator gate to business_user
-- and approve your own $14,500 payout.

drop policy if exists hitl_resolve on public.hitl_approval_gates;

create policy hitl_resolve on public.hitl_approval_gates
    for update to authenticated
    using (
        status in ('pending', 'escalated')
        and private.has_role_power(workspace_id, required_role)
    )
    with check (
        private.is_workspace_member(workspace_id)
    );

/**
 * A gate's required role ratchets upward.
 *
 * Lowering it is the one move that turns the resolution path into a privilege
 * escalation: anyone who may touch the gate at its current level could
 * otherwise widen it to a level they are already above and then resolve it
 * themselves. Raising it is the whole point of escalate.
 *
 * Only enforced while the gate is open. A closed gate is not editable through
 * the policy at all, and the runtime (service role) bypasses RLS by design —
 * it is what raises gates in the first place.
 */
create or replace function private.enforce_gate_role_ratchet()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
    if old.status in ('pending', 'escalated')
       and private.role_power(new.required_role)
           < private.role_power(old.required_role) then
        raise exception
            'Cannot lower a gate''s required role from % to %.',
            old.required_role, new.required_role
            using errcode = 'check_violation';
    end if;
    return new;
end;
$fn$;

drop trigger if exists trg_gate_role_ratchet on public.hitl_approval_gates;

create trigger trg_gate_role_ratchet
    before update on public.hitl_approval_gates
    for each row execute function private.enforce_gate_role_ratchet();
