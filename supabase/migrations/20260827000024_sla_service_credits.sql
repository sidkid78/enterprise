-- Couples measured availability to the invoice.
--
-- Migration ...19 made uptime measured rather than asserted, and nothing has
-- consumed it since: `client_subscriptions` carries the contracted target
-- (99.90%), the monthly fee ($3,500.00) and the billing period, and only
-- `sla_uptime_target` was ever read. A tab named "BIO ROI & SLA Billing" that
-- computes no billing is the same shape of gap as a `failed` job status with no
-- reader.
--
-- WHAT THE BLUEPRINT SPECIFIES, AND WHAT IT DOES NOT.
-- `ai_docs` -> BIO ROI & Upskilling describes the schema above and says the
-- breach log is "crucial for calculating billing credits if SLA thresholds are
-- violated" — and then gives no formula, no tiers, and no proration rule. So
-- the schedule below is OURS and has to be justified rather than cited. It
-- follows the ordinary enterprise shape (a step function on measured uptime,
-- paid as a percentage of the period fee) because a credit an enterprise
-- customer cannot predict from their own contract is worse than none.

/**
 * Availability across an explicit interval.
 *
 * `workspace_availability` takes a rolling window in hours, which is right for
 * "how are we doing lately" and wrong for an invoice: a credit is owed for the
 * period being billed, and a rolling seven days neither starts nor ends where
 * the period does. Same measurement, addressed by its boundaries.
 *
 * Kept as its own function rather than a parameter on the existing one so the
 * dashboard's live figure and the invoice figure cannot silently become the
 * same query with a different default.
 */
create or replace function public.workspace_availability_between(
    p_workspace_id uuid,
    p_from timestamptz,
    p_to timestamptz
)
returns table (
    downtime_seconds numeric,
    uptime_pct numeric,
    incident_count bigint,
    measured boolean
)
language sql
stable
security invoker
set search_path = ''
as $fn$
    with bounds as (
        select p_from as window_start, least(p_to, now()) as window_end
    ),
    -- Identical clipping and merging to workspace_availability. Two intervals
    -- overlapping in the same ten minutes are ten minutes of downtime, not
    -- twenty.
    clipped as (
        select greatest(e.created_at, b.window_start) as starts,
               least(coalesce(e.resolved_at, b.window_end), b.window_end) as ends
          from public.sla_breach_events e, bounds b
         where e.workspace_id = p_workspace_id
           and e.breach_type = any(private.downtime_breach_types())
           and coalesce(e.resolved_at, b.window_end) > b.window_start
           and e.created_at < b.window_end
    ),
    live_stalls as (
        select greatest(j.run_after, b.window_start) as starts,
               b.window_end as ends
          from public.agent_job_queue j, bounds b
         where j.status = 'queued'
           and j.run_after <= now() - make_interval(
                   secs => private.queue_stall_threshold_seconds())
           and j.workspace_id = p_workspace_id
    ),
    valid as (
        select starts, ends from clipped where ends > starts
        union all
        select starts, ends from live_stalls where ends > starts
    ),
    marked as (
        select starts, ends,
               max(ends) over (order by starts
                   rows between unbounded preceding and 1 preceding) as prior_end
          from valid
    ),
    islands as (
        select starts, ends,
               sum(case when prior_end is null or starts > prior_end then 1 else 0 end)
                   over (order by starts rows unbounded preceding) as island
          from marked
    ),
    merged as (
        select min(starts) as starts, max(ends) as ends from islands group by island
    ),
    totals as (
        select coalesce(sum(extract(epoch from ends - starts)), 0)::numeric as down,
               greatest(extract(epoch from (select window_end - window_start from bounds)), 0)::numeric as span
          from merged
    ),
    incidents as (
        select count(*) as total
          from public.sla_breach_events e, bounds b
         where e.workspace_id = p_workspace_id
           and e.created_at >= b.window_start
           and e.created_at < b.window_end
    )
    select t.down,
           case when t.span <= 0 then null
                else greatest(0, least(100, 100 - (t.down / t.span) * 100))::numeric
           end,
           i.total,
           -- A period that has not started, or has zero elapsed span, has no
           -- measurement behind it. Reporting 100% there is the fabrication
           -- migration ...19 exists to stop.
           t.span > 0
      from totals t, incidents i;
$fn$;

/**
 * The credit schedule.
 *
 * OURS, not the blueprint's — see the header. A step function rather than a
 * linear formula because that is what enterprise agreements actually say, and
 * because a customer must be able to compute their own entitlement from the
 * contract without reproducing our arithmetic.
 *
 * Meeting the target pays nothing. The first band is deliberately wide: the
 * difference between 99.90% and 99.5% over a month is about three hours, which
 * is a bad month rather than a broken service.
 *
 * IMMUTABLE and in SQL so the invoice, the dashboard and any future export
 * cannot drift apart — the same argument that put `over_budget` in the
 * database rather than in TypeScript.
 */
create or replace function private.sla_credit_rate(
    p_uptime numeric,
    p_target numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
    select case
        when p_uptime is null then 0
        when p_uptime >= p_target then 0
        when p_uptime >= 99.0 then 0.10
        when p_uptime >= 95.0 then 0.25
        else 0.50
    end::numeric;
$fn$;

/**
 * What is owed for the current billing period.
 *
 * Every figure is derived from recorded intervals and the signed contract.
 * Nothing here is estimated, and nothing is written — computing a credit is
 * measurement, whereas issuing one is a financial act, and this platform does
 * not let the runtime perform financial acts on its own behalf. The same rule
 * keeps `bio_outcome_logs` free of self-scored ROI.
 *
 * Prorated by elapsed fraction of the period, because a credit claimed on day
 * three of a month against the whole month's fee would be an overpayment on a
 * period that is mostly unbilled and unmeasured.
 *
 * SECURITY INVOKER: as DEFINER, "what do we owe our customer?" would become a
 * cross-tenant billing report.
 */
create or replace function public.workspace_sla_credit(p_workspace_id uuid)
returns table (
    period_start timestamptz,
    period_end timestamptz,
    elapsed_fraction numeric,
    monthly_recurring_fee numeric,
    uptime_target numeric,
    uptime_actual numeric,
    downtime_seconds numeric,
    incident_count bigint,
    measured boolean,
    credit_rate numeric,
    credit_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $fn$
    with sub as (
        select s.current_period_start as ps,
               s.current_period_end as pe,
               s.monthly_recurring_fee as fee,
               s.sla_uptime_target as target
          from public.client_subscriptions s
         where s.workspace_id = p_workspace_id
           and s.status = 'active'
    ),
    avail as (
        select a.*
          from sub, lateral public.workspace_availability_between(
                   p_workspace_id, sub.ps, sub.pe) a
    ),
    elapsed as (
        select sub.*,
               case when extract(epoch from sub.pe - sub.ps) <= 0 then 0
                    else least(1, greatest(0,
                        extract(epoch from least(now(), sub.pe) - sub.ps)
                        / extract(epoch from sub.pe - sub.ps)))
               end::numeric as frac
          from sub
    )
    select e.ps, e.pe, round(e.frac, 4), e.fee, e.target,
           a.uptime_pct, a.downtime_seconds, a.incident_count, a.measured,
           private.sla_credit_rate(a.uptime_pct, e.target),
           -- Rounded to the cent at the end, once. Rounding the rate or the
           -- prorated fee first compounds the error into the invoice.
           round(e.fee * e.frac * private.sla_credit_rate(a.uptime_pct, e.target), 2)
      from elapsed e, avail a;
$fn$;

revoke all on function public.workspace_availability_between(uuid, timestamptz, timestamptz) from public;
revoke all on function private.sla_credit_rate(numeric, numeric) from public;
revoke all on function public.workspace_sla_credit(uuid) from public;

-- INVOKER functions run every helper as the CALLER. `workspace_availability`
-- shipped without this and the whole dashboard died with "permission denied for
-- function queue_stall_threshold_seconds" (migration ...20). Grant the helpers
-- too, and test with `set role authenticated` — as `postgres` you have only
-- proved the SQL parses.
grant execute on function public.workspace_availability_between(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function private.sla_credit_rate(numeric, numeric) to authenticated, service_role;
grant execute on function public.workspace_sla_credit(uuid) to authenticated, service_role;
