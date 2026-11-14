import type { Decision } from "@/lib/data/hitl";

const STATUS: Record<string, { label: string; className: string }> = {
  approved: {
    label: "APPROVED",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  rejected: {
    label: "REJECTED",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  },
  timed_out: {
    label: "EXPIRED",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
};

function waited(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/**
 * Who decided what.
 *
 * `resolved_by` and `resolved_at` were written from Phase 3 and read by
 * nothing: a gate left the interface the moment somebody acted on it, so the
 * product could raise a control and never show that it had been exercised. For
 * a governance platform that record is the point, not a convenience.
 *
 * The viewer sees the history of gates they could have opened — the RPC is
 * SECURITY INVOKER and `hitl_select` filters by role, so this does not become a
 * side channel onto gates above someone's rank.
 */
export default function DecisionHistory({
  decisions,
}: {
  decisions: Decision[];
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Decision history</h3>
        <span className="font-mono text-[11px] text-slate-500">
          {decisions.length}
        </span>
      </div>

      {decisions.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          No gate has been decided yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-semibold">Decision</th>
                <th className="px-4 py-2 font-semibold">Step</th>
                <th className="px-4 py-2 font-semibold">Trigger</th>
                <th className="px-4 py-2 font-semibold">Decided by</th>
                <th className="px-4 py-2 font-semibold">Waited</th>
                <th className="px-4 py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => {
                const badge = STATUS[d.status] ?? {
                  label: d.status.toUpperCase(),
                  className: "border-slate-700 bg-slate-950 text-slate-400",
                };

                return (
                  <tr key={d.gateId} className="border-b border-slate-800/60">
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {d.nodeId ?? "—"}
                      {d.agentRole && (
                        <span className="ml-1 text-slate-500">
                          {d.agentRole}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-slate-400">
                      {d.triggerReason}
                      <span className="ml-1 font-mono text-[10px] text-slate-600">
                        {d.requiredRole}
                      </span>
                    </td>

                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {/*
                        An email, or an explicit statement that we cannot name
                        them. Never a bare uuid: "approved by c91ea881" is not
                        an audit record anyone can act on, and a truncated id
                        reads as an identity while conveying none.
                      */}
                      {d.resolvedByEmail ??
                        (d.resolvedBy ? (
                          <span className="text-slate-500">
                            no longer a member
                          </span>
                        ) : (
                          <span className="text-slate-600">unrecorded</span>
                        ))}
                    </td>

                    <td className="px-4 py-2.5 font-mono text-slate-400">
                      {waited(d.waitSeconds)}
                    </td>

                    <td className="px-4 py-2.5 text-slate-500">
                      {when(d.resolvedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {decisions.some((d) => d.resolvedBy === null) && (
        /*
          Gates resolved before the resolver was recorded. Stated rather than
          rendered as a blank, so an auditor can tell "we did not capture this"
          from "nobody acted".
        */
        <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
          Some decisions predate operator attribution and carry no resolver.
        </p>
      )}
    </div>
  );
}
