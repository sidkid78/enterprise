import type { RoiSummary } from "@/lib/data/bio";

const usd = (value: number, fractionDigits = 2) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

export default function BioRoiCommercialization({
  workspaceName,
  roi,
}: {
  workspaceName: string;
  roi: RoiSummary;
}) {
  // Guard the divisor: an all-zero week would otherwise give every bar a NaN
  // height and collapse the chart.
  const maxChartValue = Math.max(...roi.dailyDeflectedCost.map((d) => d.value), 1);
  const hasChartData = roi.dailyDeflectedCost.some((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-xl font-bold text-white">
            <span>BIO ROI &amp; SLA Billing Portal</span>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-400">
              {workspaceName}
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Commercialization metrics and deflected labor cost, last 7 days.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur">
          <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
            <svg className="h-12 w-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Gross Deflected Cost
          </p>
          <p className="font-mono text-2xl font-bold text-white">
            ${usd(roi.totalDeflectedCostUsd)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {roi.deflectedHumanHours.toFixed(1)} human hours saved
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur">
          <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
            <svg className="h-12 w-12 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            API Compute Cost (FinOps)
          </p>
          <p className="font-mono text-2xl font-bold text-white">
            ${usd(roi.apiComputeCostUsd)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {roi.activeAgents} distinct agent roles active
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-900/80 p-5 shadow-[0_0_15px_rgba(6,182,212,0.1)] backdrop-blur">
          <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
            <svg className="h-12 w-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-cyan-400">
            Net ROI Achieved
          </p>
          <p className="font-mono text-2xl font-bold text-white">
            ${usd(roi.netRoiUsd)}
          </p>
          <p className="mt-2 text-xs font-bold text-cyan-400">
            {roi.roiPercentage === null
              ? "No compute spend yet"
              : `${roi.roiPercentage >= 0 ? "+" : ""}${roi.roiPercentage.toFixed(0)}% return on compute`}
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur">
          <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
            <svg className="h-12 w-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            SLA Uptime Tracker
          </p>
          {/*
            An unmeasured SLA must never render as a passing one. The figure
            here used to be 100.000% unconditionally, because nothing wrote
            sla_breach_events and the breach count was always zero — a perfect
            compliance claim produced by never having looked.
          */}
          {roi.availabilityMeasured ? (
            <>
              <p
                className={`font-mono text-2xl font-bold ${
                  roi.uptimeSlaActual >= roi.uptimeSlaTarget
                    ? "text-white"
                    : "text-amber-400"
                }`}
              >
                {roi.uptimeSlaActual.toFixed(3)}%
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Target: {roi.uptimeSlaTarget.toFixed(2)}% ·{" "}
                {roi.downtimeSeconds > 0
                  ? `${Math.round(roi.downtimeSeconds / 60)} min unavailable`
                  : "no downtime recorded"}{" "}
                over 7 days
              </p>
              {roi.incidentCount > 0 && (
                /*
                  Incidents are counted apart from uptime on purpose. A failed
                  run is the platform working and returning a bad answer; only a
                  queue nothing was consuming is time the service was actually
                  unavailable.
                */
                <p className="mt-1 text-xs text-slate-500">
                  {roi.incidentCount} incident
                  {roi.incidentCount === 1 ? "" : "s"} recorded
                  {roi.openIncidentCount > 0 && (
                    <span className="text-amber-400">
                      {" "}
                      · {roi.openIncidentCount} still open
                    </span>
                  )}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-mono text-2xl font-bold text-slate-500">—</p>
              <p className="mt-2 text-xs text-slate-400">
                Not measured. Target: {roi.uptimeSlaTarget.toFixed(2)}%
              </p>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h3 className="mb-6 text-sm font-bold text-white">
          Net Savings Growth (Last 7 Days)
        </h3>

        {hasChartData ? (
          <div className="relative flex h-64 w-full items-end justify-between space-x-2 pt-8">
            <div className="absolute bottom-0 left-0 top-0 flex w-12 flex-col justify-between pb-6 font-mono text-[10px] text-slate-500">
              <span>${usd(maxChartValue, 0)}</span>
              <span>${usd(maxChartValue / 2, 0)}</span>
              <span>$0</span>
            </div>

            <div className="relative flex h-full flex-1 items-end justify-between space-x-2 border-b border-slate-800 pb-2 pl-12">
              {roi.dailyDeflectedCost.map((point) => (
                <div
                  key={point.date}
                  className="group relative flex w-full flex-col items-center"
                >
                  <div className="absolute -top-8 z-10 rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[10px] font-bold text-cyan-400 opacity-0 transition-opacity group-hover:opacity-100">
                    ${usd(point.value)}
                  </div>
                  <div
                    className="w-full rounded-t-sm border-t border-cyan-400/50 bg-gradient-to-t from-cyan-900/50 to-cyan-500/80 transition-all duration-300 hover:to-cyan-400"
                    style={{ height: `${(point.value / maxChartValue) * 100}%` }}
                  ></div>
                  <span className="absolute -bottom-6 font-mono text-[10px] text-slate-500">
                    {point.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-slate-500">
            No outcome events recorded in the last 7 days.
          </p>
        )}
      </div>
    </div>
  );
}
