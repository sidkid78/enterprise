import type { SlaCredit } from "@/lib/data/bio";

const usd = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function Figure({
  label,
  value,
  tone = "default",
  note,
}: {
  label: string;
  value: string;
  tone?: "default" | "credit" | "muted";
  note?: string;
}) {
  const color =
    tone === "credit"
      ? "text-amber-400"
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

/**
 * The invoice side of the SLA.
 *
 * Migration `…19` made uptime measured; this is what consumes it. Every number
 * on this panel comes from `workspace_sla_credit`, which derives it from
 * recorded downtime intervals and the signed subscription — so the panel can be
 * handed to a customer as the working, not just the answer.
 *
 * Renders nothing when there is no active subscription. A workspace nobody
 * bills owes no credit, and "$0.00 owed" would assert a contract that does not
 * exist — the same distinction as "not measured" versus "100% uptime".
 */
export default function SlaBillingPanel({ credit }: { credit: SlaCredit | null }) {
  if (!credit) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-bold text-white">SLA billing</h3>
        <p className="mt-2 text-xs text-slate-500">
          No active subscription for this workspace, so no service credit
          applies.
        </p>
      </div>
    );
  }

  const meetingTarget =
    credit.uptimeActual !== null && credit.uptimeActual >= credit.uptimeTarget;
  const proratedFee = credit.monthlyRecurringFeeUsd * credit.elapsedFraction;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-white">SLA billing</h3>
        <p className="font-mono text-[11px] text-slate-500">
          {day(credit.periodStart)} – {day(credit.periodEnd)} ·{" "}
          {(credit.elapsedFraction * 100).toFixed(0)}% elapsed
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Figure
          label="Monthly fee"
          value={`$${usd(credit.monthlyRecurringFeeUsd)}`}
          note={`$${usd(proratedFee)} elapsed`}
        />

        {/*
          This will not equal the SLA Uptime Tracker tile above, and should not.
          That one is a rolling 7 days — "how are we doing lately" — while a
          credit is owed for the period being invoiced, which starts and ends
          somewhere else entirely. Two honest numbers over different spans read
          as a bug unless the span is on the label, so it is.

          And the same rule as that tile: an unmeasured period must never render
          as a passing one. A period with no elapsed span has nothing behind it,
          and a dash says so.
        */}
        <Figure
          label="Uptime this period"
          value={
            credit.measured && credit.uptimeActual !== null
              ? `${credit.uptimeActual.toFixed(3)}%`
              : "—"
          }
          tone={
            !credit.measured ? "muted" : meetingTarget ? "default" : "credit"
          }
          note={`Target ${credit.uptimeTarget.toFixed(2)}% · billing period, not the 7-day tile`}
        />

        <Figure
          label="Downtime this period"
          value={
            credit.measured
              ? credit.downtimeSeconds > 0
                ? `${Math.round(credit.downtimeSeconds / 60)} min`
                : "none"
              : "—"
          }
          tone={credit.downtimeSeconds > 0 ? "credit" : "default"}
          note={
            credit.incidentCount > 0
              ? `${credit.incidentCount} incident${credit.incidentCount === 1 ? "" : "s"} logged separately`
              : undefined
          }
        />

        <Figure
          label="Service credit"
          value={`$${usd(credit.creditUsd)}`}
          tone={credit.creditUsd > 0 ? "credit" : "default"}
          note={
            credit.creditRate > 0
              ? `${(credit.creditRate * 100).toFixed(0)}% of the elapsed fee`
              : credit.measured
                ? "target met — nothing owed"
                : "not measured"
          }
        />
      </div>

      {credit.creditUsd > 0 && (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Measured uptime of {credit.uptimeActual?.toFixed(3)}% is below the
          contracted {credit.uptimeTarget.toFixed(2)}%. This figure is computed
          from recorded outage intervals, not estimated — but issuing the credit
          is a billing decision, and nothing here has been applied to an invoice.
        </p>
      )}
    </div>
  );
}
