"use client";

import { useState } from "react";

import type {
  ChainVerification,
  GateTally,
  GuardrailEvent,
  LedgerEntry,
} from "@/lib/data/governance";

import JsonView from "./JsonView";

/** Human labels for the gate identifiers the runtime writes. */
const GATE_LABELS: Record<string, string> = {
  pii_leakage: "PII redaction",
  input_jailbreak: "Injection screen (input)",
  tool_result_injection: "Injection screen (tool result)",
  semantic_cache: "Semantic cache",
  structural_json: "Structural validation",
  output_hallucination: "Critic review",
};

function gateLabel(layer: string): string {
  return GATE_LABELS[layer] ?? layer.replaceAll("_", " ");
}

/**
 * `blocked` and `redacted` are the gates doing their job, not failures — a
 * blocked injection is the system working. Only the critic passing is styled as
 * plainly good; the rest read as "something was caught here".
 */
function verdictTone(verdict: string): string {
  switch (verdict) {
    case "blocked":
      return "border-rose-500/30 bg-rose-500/10 text-rose-400";
    case "flagged":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case "redacted":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";
    case "passed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    default:
      return "border-slate-700 bg-slate-800 text-slate-400";
  }
}

function ChainStatus({
  verification,
  canRead,
}: {
  verification: ChainVerification | null;
  canRead: boolean;
}) {
  if (!canRead || !verification) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Ledger integrity
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          Chain verification is available to owners, administrators and
          compliance auditors.
        </p>
      </div>
    );
  }

  const intact = verification.brokenAt === null;

  return (
    <div
      className={`rounded-xl border p-5 ${
        intact
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-rose-500/40 bg-rose-500/10"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Ledger integrity
          </h3>
          <p
            className={`mt-1 text-sm font-semibold ${
              intact ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {intact
              ? `Hash chain intact across ${verification.entryCount} ${verification.entryCount === 1 ? "entry" : "entries"}.`
              : `Chain broken at entry ${verification.brokenAt} (${verification.failure === "hash_mismatch" ? "content no longer matches its hash" : "entry does not link to the one before it"}).`}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {intact
              ? "Recomputed server-side from the stored payloads, not read back from a status column."
              : "Every entry from this point on should be treated as unverified."}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
            intact
              ? "border-emerald-500/40 text-emerald-400"
              : "border-rose-500/50 text-rose-400"
          }`}
        >
          {intact ? "Verified" : "Tampered"}
        </span>
      </div>
    </div>
  );
}

function GateSummary({ tallies }: { tallies: GateTally[] }) {
  if (tallies.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {tallies.map((tally) => (
        <span
          key={`${tally.gateLayer}-${tally.verdict}`}
          className={`rounded-lg border px-3 py-1.5 text-[11px] ${verdictTone(tally.verdict)}`}
        >
          <span className="font-semibold">{gateLabel(tally.gateLayer)}</span>
          <span className="opacity-70"> · {tally.verdict} </span>
          <span className="font-mono font-bold">{tally.count}</span>
        </span>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: GuardrailEvent }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.details) || Boolean(event.snippet);

  return (
    <>
      <tr className="border-b border-slate-800/60">
        <td className="py-3 pr-3">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            disabled={!hasDetail}
            aria-expanded={open}
            className="text-left text-xs font-medium text-slate-200 hover:text-cyan-300 disabled:cursor-default disabled:hover:text-slate-200"
          >
            {hasDetail && (
              <span
                aria-hidden="true"
                className={`mr-1.5 inline-block text-[9px] transition-transform ${open ? "rotate-90" : ""}`}
              >
                ▸
              </span>
            )}
            {gateLabel(event.gateLayer)}
          </button>
        </td>
        <td className="py-3 pr-3">
          <span
            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${verdictTone(event.verdict)}`}
          >
            {event.verdict}
          </span>
        </td>
        <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
          {event.riskScore === null ? "--" : event.riskScore.toFixed(2)}
        </td>
        <td className="py-3 pr-3 font-mono text-[10px] text-slate-500">
          {event.graphExecutionId ? event.graphExecutionId.slice(0, 8) : "--"}
        </td>
        <td className="py-3 text-right font-mono text-[10px] text-slate-500">
          {new Date(event.createdAt).toLocaleTimeString()}
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="border-b border-slate-800/60">
          <td colSpan={5} className="pb-4">
            {event.details && (
              <div className="mb-2 overflow-x-auto rounded-lg border border-slate-800 bg-[#0d1117] p-3">
                <pre className="font-mono text-[11px] leading-relaxed">
                  <JsonView value={event.details} />
                </pre>
              </div>
            )}
            {event.snippet && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                  Caught content (truncated)
                </div>
                <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
                  {event.snippet}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-slate-800/60">
        <td className="py-3 pr-3 font-mono text-[11px] text-slate-500">
          {entry.sequenceId}
        </td>
        <td className="py-3 pr-3">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="text-left text-xs text-slate-200 hover:text-cyan-300"
          >
            <span
              aria-hidden="true"
              className={`mr-1.5 inline-block text-[9px] transition-transform ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            {entry.actionType.replaceAll("_", " ")}
          </button>
        </td>
        <td className="py-3 pr-3 text-xs text-slate-400">{entry.agentId}</td>
        <td className="py-3 pr-3 font-mono text-[10px] text-slate-600">
          {entry.currentHash.slice(0, 12)}…
        </td>
        <td className="py-3 text-right font-mono text-[10px] text-slate-500">
          {new Date(entry.createdAt).toLocaleTimeString()}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-800/60">
          <td colSpan={5} className="pb-4">
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0d1117] p-3">
              <pre className="font-mono text-[11px] leading-relaxed">
                <JsonView value={entry.payload} />
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function GovernanceControlPlane({
  events,
  tallies,
  ledger,
  verification,
  canReadLedger,
}: {
  events: GuardrailEvent[];
  tallies: GateTally[];
  ledger: LedgerEntry[];
  verification: ChainVerification | null;
  canReadLedger: boolean;
}) {
  const caught = events.filter(
    (event) => event.verdict === "blocked" || event.verdict === "flagged",
  ).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Governance Control Plane
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Every gate evaluation the runtime recorded, and the tamper-evident
              log of what agents did.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>
              <span className="text-slate-400">Evaluations: </span>
              <span className="font-bold text-slate-200">{events.length}</span>
            </span>
            <span>
              <span className="text-slate-400">Caught: </span>
              <span
                className={`font-bold ${caught > 0 ? "text-amber-400" : "text-slate-200"}`}
              >
                {caught}
              </span>
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <ChainStatus verification={verification} canRead={canReadLedger} />
          <GateSummary tallies={tallies} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
          Guardrail Evaluations
        </h3>

        {events.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No gate evaluations recorded yet. They appear as soon as an agent
            run starts.
          </p>
        ) : (
          <div className="overflow-x-auto px-6 pb-4">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-3">Gate</th>
                  <th className="py-3 pr-3">Verdict</th>
                  <th className="py-3 pr-3 text-right">Risk</th>
                  <th className="py-3 pr-3">Run</th>
                  <th className="py-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
          Immutable Audit Ledger
        </h3>

        {!canReadLedger ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            The audit ledger is restricted to owners, administrators and
            compliance auditors.
          </p>
        ) : ledger.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No ledger entries yet.
          </p>
        ) : (
          <div className="overflow-x-auto px-6 pb-4">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-3">#</th>
                  <th className="py-3 pr-3">Action</th>
                  <th className="py-3 pr-3">Actor</th>
                  <th className="py-3 pr-3">Hash</th>
                  <th className="py-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <LedgerRow key={entry.sequenceId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
