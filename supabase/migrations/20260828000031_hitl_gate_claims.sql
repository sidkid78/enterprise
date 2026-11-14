-- Lets a reviewer take ownership of a gate, so "nobody has looked at this" is
-- distinguishable from "someone is on it".
--
-- `hitl_approval_gates.assigned_user_id` has existed since migration ...03 and
-- is referenced NOWHERE in the codebase: not written, not read, not rendered.
-- Confirmed by a sweep for always-null columns across every populated table --
-- it and `user_upskilling_progress.assessment_score` were the only two real
-- hits.
--
-- The cost of that is measurable right now: 5 gates pending, average age 89.1
-- hours, against 16.3 hours for the ones that were approved. A gate is routed to
-- a ROLE, which says any agent_operator *could* act on it and therefore that no
-- particular person *must*. Migration ...26 measured that wait and gave an
-- operator a way to close it; it did not give anybody a way to own it.
--
-- CLAIMING, NOT ASSIGNING -- and the distinction is deliberate.
--
-- `ai_docs` (Drive) -> Stateful HITL Gates -> Role-based access-control is
-- explicit and complete about routing: the orchestrator sets `required_role`,
-- resolution compares role power, escalation raises the bar. It says nothing
-- anywhere about directing a gate at an individual. So dispatch-style
-- assignment would be a workflow policy invented here, and a bad one: pushing a
-- gate to someone on holiday makes it *more* stuck, not less, while appearing
-- to have been handled.
--
-- A claim asserts nothing about who ought to do the work. It records who is
-- doing it, which is a fact, and it is the same mechanism the job queue already
-- uses -- `locked_by` plus `locked_until` -- applied to the one work queue in
-- this system that never had it.
--
-- CLAIMS EXPIRE, for the reason leases do. A reviewer who claims a gate and
-- walks away must not be able to hold it forever; that would be strictly worse
-- than the status quo, where at least anyone eligible could act. After the TTL
-- the claim is ignored and anyone eligible may take over.

alter table public.hitl_approval_gates
    add column if not exists assigned_at timestamptz;

comment on column public.hitl_approval_gates.assigned_user_id is
    'Who is currently reviewing this gate. A claim the reviewer made themselves, never a dispatch — and only live while assigned_at is within the claim TTL.';

/**
 * How long a claim holds before anyone else may take the gate.
 *
 * 60 minutes: long enough to read a reasoning log, check a system of record and
 * decide; short enough that a reviewer who is called away does not park the
 * gate for a working day. Deliberately far below the 24h review SLA, so a
 * forgotten claim cannot be the reason a gate breaches it.
 */
create or replace function private.hitl_claim_ttl_minutes()
returns int
language sql
immutable
set search_path = ''
as $fn$ select 60 $fn$;

revoke all on function private.hitl_claim_ttl_minutes() from public;
-- Granted to authenticated because the readers are INVOKER functions and the
-- dashboard itself. Migration ...20 exists because a helper was granted only to
-- service_role and the whole ROI tab died with "permission denied".
grant execute on function private.hitl_claim_ttl_minutes() to authenticated, service_role;

/**
 * Whether a claim is still holding.
 *
 * Derived from the timestamp on every read, never stored as a flag: a reviewer
 * who closes their laptop cannot write "my claim lapsed". Same reasoning as
 * worker liveness being computed from heartbeat age, and as
 * `verify_ledger_chain` recomputing instead of reading a status column.
 */
create or replace function private.gate_claim_is_live(
    p_assigned_user_id uuid,
    p_assigned_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $fn$
    select p_assigned_user_id is not null
       and p_assigned_at is not null
       and p_assigned_at > now() - make_interval(
               mins => private.hitl_claim_ttl_minutes());
$fn$;

revoke all on function private.gate_claim_is_live(uuid, timestamptz) from public;
grant execute on function private.gate_claim_is_live(uuid, timestamptz) to authenticated, service_role;

/**
 * Takes a gate.
 *
 * SECURITY INVOKER, unlike `expire_hitl_gate`. That one had to be DEFINER
 * because closing a gate also updates `agent_node_executions` and
 * `agent_graph_executions`, which `authenticated` cannot touch. This writes
 * only to `hitl_approval_gates`, where the `hitl_resolve` policy already grants
 * exactly the right thing: its USING clause demands
 * `has_role_power(workspace_id, required_role)` and an open status, which is
 * precisely "may you act on this gate". Re-implementing that as an explicit
 * DEFINER check would be a second copy of a rule that already exists, free to
 * drift from it.
 *
 * The pre-read is through `hitl_select`, which also filters by role, so a gate
 * above the caller's rank reports as `not_found` rather than `forbidden` — it
 * is not theirs to know about.
 */
create or replace function public.claim_hitl_gate(p_gate_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
    v_gate record;
    v_me uuid := (select auth.uid());
    v_updated int;
begin
    select g.id, g.status, g.assigned_user_id, g.assigned_at
      into v_gate
      from public.hitl_approval_gates g
     where g.id = p_gate_id;

    if v_gate.id is null then
        return 'not_found';
    end if;

    if v_gate.status not in ('pending', 'escalated') then
        return 'not_open';
    end if;

    if v_gate.assigned_user_id = v_me
       and private.gate_claim_is_live(v_gate.assigned_user_id, v_gate.assigned_at) then
        return 'already_yours';
    end if;

    -- Someone else is actively on it. Two reviewers deciding the same gate is
    -- the duplicated-work problem this exists to prevent, so the second one is
    -- told rather than allowed to race. A LAPSED claim is not protected: the
    -- whole point of the TTL is that an abandoned gate returns to the queue.
    if v_gate.assigned_user_id is distinct from v_me
       and private.gate_claim_is_live(v_gate.assigned_user_id, v_gate.assigned_at) then
        return 'held_by_other';
    end if;

    update public.hitl_approval_gates
       set assigned_user_id = v_me,
           assigned_at = now()
     where id = p_gate_id;

    get diagnostics v_updated = row_count;

    -- Zero rows means the `hitl_resolve` USING clause refused: the caller lacks
    -- power over this gate's required_role. The policy is the authority; this
    -- function only turns its answer into a word.
    if v_updated = 0 then
        return 'forbidden';
    end if;

    return 'claimed';
end;
$fn$;

revoke all on function public.claim_hitl_gate(uuid) from public;
grant execute on function public.claim_hitl_gate(uuid) to authenticated, service_role;

/**
 * Gives a gate back.
 *
 * Only the holder may release, and only their own live claim. A reviewer
 * clearing somebody else's claim is assignment through the back door — it
 * decides on another person's behalf that they are not working on something.
 * A claim held by someone unavailable is handled by the TTL, which needs no
 * one's judgement.
 */
create or replace function public.release_hitl_gate(p_gate_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
    v_gate record;
    v_me uuid := (select auth.uid());
    v_updated int;
begin
    select g.id, g.status, g.assigned_user_id, g.assigned_at
      into v_gate
      from public.hitl_approval_gates g
     where g.id = p_gate_id;

    if v_gate.id is null then
        return 'not_found';
    end if;

    if not private.gate_claim_is_live(v_gate.assigned_user_id, v_gate.assigned_at) then
        return 'not_claimed';
    end if;

    if v_gate.assigned_user_id is distinct from v_me then
        return 'not_yours';
    end if;

    update public.hitl_approval_gates
       set assigned_user_id = null,
           assigned_at = null
     where id = p_gate_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        return 'forbidden';
    end if;

    return 'released';
end;
$fn$;

revoke all on function public.release_hitl_gate(uuid) from public;
grant execute on function public.release_hitl_gate(uuid) to authenticated, service_role;

-- ============================================================================
-- A claim is self-made, enforced in the database
-- ============================================================================
-- `authenticated` holds UPDATE on this table through `hitl_resolve`, and
-- PostgREST exposes it directly, so without this a member with power over a
-- gate could PATCH `assigned_user_id` to a COLLEAGUE — the dispatch-style
-- assignment this migration deliberately does not implement, reachable by
-- skipping the function that does not implement it. Same reasoning as the RBAC
-- note in CLAUDE.md: a rule that lives only in a Server Action is a rule on a
-- directly addressable server.
--
-- Folded into the existing BEFORE UPDATE trigger rather than added beside it,
-- so the ordering of two triggers on one table can never become the thing that
-- decides whether the rule holds.
create or replace function private.enforce_gate_role_ratchet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
    -- `required_role` may only ever rise. Lowering it is the one move that turns
    -- resolution into privilege escalation: drop an ai_administrator gate to
    -- business_user, then approve your own payout. No policy can express this,
    -- because the rule compares OLD to NEW and WITH CHECK cannot see OLD.
    if private.role_power(new.required_role)
       < private.role_power(old.required_role) then
        raise exception
            'required_role cannot be lowered (% -> %)',
            old.required_role, new.required_role
            using errcode = 'check_violation';
    end if;

    -- Escalation hands the gate to a different tier, so the previous claim no
    -- longer means anything — and the holder may not even have power over the
    -- new bar. Clearing it here rather than in the escalate action keeps it true
    -- for any path that raises the role.
    if new.required_role is distinct from old.required_role then
        new.assigned_user_id := null;
        new.assigned_at := null;
    end if;

    -- A claim is something you make for yourself. Releasing (to null) is always
    -- allowed by this rule; the release function decides whose claim it was.
    if new.assigned_user_id is distinct from old.assigned_user_id
       and new.assigned_user_id is not null
       and new.assigned_user_id is distinct from (select auth.uid()) then
        raise exception
            'a gate claim must be made by the reviewer taking it'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$fn$;

-- Claims are only meaningful on open gates, and the queue reads them by
-- workspace. Partial index for the same reason `idx_hitl_gates_open_age` is one.
create index if not exists idx_hitl_gates_claimed
    on public.hitl_approval_gates (workspace_id, assigned_at desc)
    where status in ('pending', 'escalated') and assigned_user_id is not null;

/**
 * Open gates nobody is working on, past the review SLA.
 *
 * `overdue_gate_count` deliberately keeps counting every overdue gate,
 * claimed or not — a claim is not progress, and a gate someone took three days
 * ago and never decided has still breached. This is the narrower, more
 * actionable figure: work that is late AND that nobody has picked up.
 *
 * INVOKER, so `hitl_select` filters it to gates the caller could actually open.
 */
create or replace function public.unclaimed_overdue_gate_count(p_workspace_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
    select count(*)
      from public.hitl_approval_gates g
     where g.workspace_id = p_workspace_id
       and g.status in ('pending', 'escalated')
       and g.created_at < now() - make_interval(
               hours => private.hitl_review_sla_hours())
       and not private.gate_claim_is_live(g.assigned_user_id, g.assigned_at);
$fn$;

revoke all on function public.unclaimed_overdue_gate_count(uuid) from public;
grant execute on function public.unclaimed_overdue_gate_count(uuid) to authenticated, service_role;
