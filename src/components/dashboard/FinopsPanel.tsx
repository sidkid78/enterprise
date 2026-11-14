import type { FinopsSummary } from "@/lib/data/finops";

const usd = (value: number, digits = 2) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/**
 * Sub-cent amounts rendered at two decimals read as "$0.00", which looks like
 * a broken figure rather than a small one. Same reasoning as `formatUsd` in the
 * orchestrator.
 */
const money = (value: number) =>
  value > 0 && value < 0.01 ? `$${usd(value, 6)}` : `$${usd(value)}`;

function Stat({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "good" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-emerald-400"
      : tone === "muted"
        ? "text-slate-500"
        : "text-white";

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`font-mono text-lg font-bold ${color}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

/** One bar of the tier mix. */
function TierBar({
  label,
  count,
  total,
  className,
}: {
  label: string;
  count: number;
  total: number;
  className: string;
}) {
  if (count === 0) return null;
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div
      className={`h-full ${className}`}
      style={{ width: `${pct}%` }}
      title={`${label}: ${count} (${pct.toFixed(0)}%)`}
    />
  );
}

/**
 * What the cost controls did.
 *
 * The platform's pitch is margin protection — a cheap-first cascade, a semantic
 * cache, a budget stop and a loop guard — and until this panel none of it was
 * visible to the person paying for it. A budget bar says how much is left; it
 * says nothing about whether any of the machinery is working.
 */
export default function FinopsPanel({
  finops,
}: {
  finops: FinopsSummary | null;
}) {
  if (!finops) {
    return null;
  }

  const routedCalls =
    finops.cheapCalls + finops.defaultCalls + finops.reasoningCalls;
  const totalRequests = finops.modelCalls + finops.cacheHits;
  const hitRate =
    totalRequests > 0 ? (finops.cacheHits / totalRequests) * 100 : 0;

  // Hits on entries written before costs were recorded. Named rather than
  // folded away, because they are the difference between the hit count and the
  // money figure.
  const unpricedHits = finops.cacheHits - finops.cacheHitsPriced;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-white">FinOps engine</h3>
        <p className="font-mono text-[11px] text-slate-500">
          last {Math.round(finops.windowHours / 24)} days
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat
          label="Model spend"
          value={money(finops.totalSpendUsd)}
          note={`${finops.modelCalls.toLocaleString()} calls · ${finops.totalTokens.toLocaleString()} tokens`}
        />

        <Stat
          label="Served from cache"
          value={`${finops.cacheHits.toLocaleString()}`}
          tone={finops.cacheHits > 0 ? "good" : "muted"}
          note={
            totalRequests > 0
              ? `${hitRate.toFixed(0)}% of ${totalRequests.toLocaleString()} requests`
              : "no requests yet"
          }
        />

        {/*
          The saving is what those answers cost when they were FIRST produced —
          a measurement of a real past call, not a guess at what a miss would
          have cost today. The note says so, because a dollar figure on a
          dashboard is assumed to be a forecast unless it says otherwise.
        */}
        <Stat
          label="Cost avoided"
          value={money(finops.avoidedCostUsd)}
          tone={finops.avoidedCostUsd > 0 ? "good" : "muted"}
          note={
            finops.cacheHitsPriced > 0
              ? `measured on ${finops.cacheHitsPriced} of ${finops.cacheHits} hits, at first-production cost`
              : finops.cacheHits > 0
                ? "no priced hits yet"
                : undefined
          }
        />

        <Stat
          label="Critic gates"
          value={finops.criticCalls.toLocaleString()}
          note="billed to the run, belonging to no node"
        />
      </div>

      {routedCalls > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Cascade routing
            </p>
            <p className="font-mono text-[11px] text-slate-500">
              {finops.cheapCalls} cheap · {finops.defaultCalls} default ·{" "}
              {finops.reasoningCalls} reasoning
            </p>
          </div>

          <div className="flex h-2 overflow-hidden rounded-full bg-slate-950">
            <TierBar
              label="cheap"
              count={finops.cheapCalls}
              total={routedCalls}
              className="bg-emerald-500"
            />
            <TierBar
              label="default"
              count={finops.defaultCalls}
              total={routedCalls}
              className="bg-cyan-500"
            />
            <TierBar
              label="reasoning"
              count={finops.reasoningCalls}
              total={routedCalls}
              className="bg-amber-500"
            />
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            The cascade is only working if most work lands on the cheap tier —
            the reasoning tier costs roughly 20× more per token.
          </p>
        </div>
      )}

      {unpricedHits > 0 && (
        <p className="mt-4 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-400">
          {unpricedHits} cache hit{unpricedHits === 1 ? "" : "s"} came from
          entries stored before production costs were recorded. They saved real
          money; how much was never measured, so none is claimed here.
        </p>
      )}
    </div>
  );
}
