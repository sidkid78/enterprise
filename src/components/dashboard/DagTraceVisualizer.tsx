"use client";

import { useState } from "react";

import type { DagNode, GraphExecution } from "@/lib/data/dag";

import JsonView from "./JsonView";

function StatusBadge({ status }: { status: DagNode["status"] }) {
  const styles: Record<DagNode["status"], string> = {
    completed:
      "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    running: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 animate-pulse",
    waiting_hitl: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  };
  const labels: Record<DagNode["status"], string> = {
    completed: "COMPLETED",
    running: "EXECUTING",
    waiting_hitl: "HALTED (HITL)",
    failed: "FAILED",
  };

  return (
    <span
      className={`rounded border px-2 py-0.5 text-[10px] font-bold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

/**
 * The prose deliverable inside a node's `result`, when there is one. Returns
 * null for payloads that are genuinely structured, which read better as a tree.
 */
function resultMarkdown(result: unknown): string | null {
  if (result == null || typeof result !== "object") return null;
  const value = result as Record<string, unknown>;
  const body =
    typeof value.content_markdown === "string" ? value.content_markdown : null;
  if (!body) return null;
  const heading = typeof value.heading === "string" ? value.heading : null;
  return heading ? `${heading}\n\n${body}` : body;
}

export default function DagTraceVisualizer({
  executions,
}: {
  executions: GraphExecution[];
}) {
  const [activeExecutionId, setActiveExecutionId] = useState(
    executions[0]?.id ?? null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [deliverableOpen, setDeliverableOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  if (executions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-12 text-center">
        <p className="text-sm text-slate-400">No agent runs recorded yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Executions appear here as soon as the orchestrator starts a graph.
        </p>
      </div>
    );
  }

  const execution =
    executions.find((e) => e.id === activeExecutionId) ?? executions[0];
  const selectedNode =
    execution.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const totalLatencyMs = execution.nodes.reduce(
    (sum, n) => sum + n.latencyMs,
    0,
  );
  const totalCost = execution.nodes.reduce((sum, n) => sum + n.costUsd, 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-white">
            <span>DAG Execution Graph Visualizer</span>
            <select
              value={execution.id}
              onChange={(event) => {
                setActiveExecutionId(event.target.value);
                setSelectedNodeId(null);
                setCopied(false);
              }}
              className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 font-mono text-xs text-cyan-400 focus:outline-none"
            >
              {executions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id.slice(0, 8)} · {e.status}
                </option>
              ))}
            </select>
          </h2>
          <p className="mt-1 truncate text-xs text-slate-400">
            {execution.orchestratorName} — {execution.rootPrompt}
          </p>
        </div>

        <div className="flex items-center space-x-4 font-mono text-xs">
          <div>
            <span className="text-slate-400">Total Latency: </span>
            <span className="font-bold text-slate-200">
              {(totalLatencyMs / 1000).toFixed(2)}s
            </span>
          </div>
          <div>
            <span className="text-slate-400">Execution Cost: </span>
            <span className="font-bold text-cyan-400">
              ${totalCost.toFixed(6)}
            </span>
          </div>
        </div>
      </div>

      {/*
        The deliverable comes first: it is what the run was for. The node grid
        below is the audit trail behind it, not the answer.
      */}
      {execution.deliverable && (
        <div className="mb-8 rounded-xl border border-cyan-900/60 bg-slate-950/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
            <button
              type="button"
              onClick={() => setDeliverableOpen((open) => !open)}
              aria-expanded={deliverableOpen}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
            >
              <span
                className={`inline-block transition-transform ${deliverableOpen ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                ▸
              </span>
              <span>Run Deliverable</span>
            </button>

            <div className="flex items-center gap-3">
              {execution.deliverable.cachedNodeCount > 0 && (
                <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                  {execution.deliverable.cachedNodeCount} cached
                </span>
              )}
              <button
                type="button"
                onClick={async () => {
                  // Clipboard access can be denied (insecure origin, permission
                  // policy); a failed copy must not blank the panel.
                  try {
                    await navigator.clipboard.writeText(
                      execution.deliverable!.markdown,
                    );
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300"
              >
                {copied ? "Copied" : "Copy Markdown"}
              </button>
            </div>
          </div>

          {deliverableOpen && (
            <div className="max-h-128 overflow-auto px-5 py-4">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">
                {execution.deliverable.markdown}
              </pre>
            </div>
          )}
        </div>
      )}

      {/*
        The mock drew fixed SVG connector paths between exactly four evenly
        spaced nodes. Real graphs vary in width, so the edges are rendered per
        card from `dependencies` instead — a decorative line that contradicts
        the actual DAG is worse than no line.
      */}
      <div className="mb-8 grid grid-cols-1 gap-6 pt-4 md:grid-cols-2 lg:grid-cols-4">
        {execution.nodes.map((node, index) => {
          const isSelected = selectedNode?.id === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelectedNodeId(node.id)}
              aria-pressed={isSelected}
              className={`relative cursor-pointer rounded-xl border p-4 text-left transition-all duration-300 ${
                isSelected
                  ? "scale-105 border-cyan-500 bg-slate-800 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                  : "border-slate-800 bg-slate-950/80 backdrop-blur-md hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-500">
                  Step {index + 1}
                </span>
                <StatusBadge status={node.status} />
              </div>

              <h3 className="mb-1 text-sm font-bold text-slate-100">
                {node.agentRole}
              </h3>
              <span className="mb-4 block w-fit rounded border border-slate-800 bg-slate-900/50 px-2 py-0.5 font-mono text-[10px] text-cyan-400">
                {node.model}
              </span>

              <div className="space-y-1.5 border-t border-slate-800/80 pt-3 text-[10px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Latency:</span>
                  <span className="font-mono font-medium text-slate-300">
                    {node.latencyMs > 0 ? `${node.latencyMs}ms` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Token Cost:</span>
                  <span className="font-mono font-medium text-slate-300">
                    ${node.costUsd.toFixed(6)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Depends on:</span>
                  <span className="font-mono font-medium text-slate-300">
                    {node.dependencies.length > 0
                      ? node.dependencies.join(", ")
                      : "root"}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedNode ? (
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/80 p-5 backdrop-blur">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h4 className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              <span>Node Inspector — [{selectedNode.agentRole}]</span>
            </h4>
            <span className="rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-500">
              Dependencies: {selectedNode.dependencies.join(", ") || "None"}
            </span>
          </div>

          <p className="mb-4 whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-300">
            {selectedNode.outputSnippet}
          </p>

          {/*
            The work product itself. Previously only the one-line summary was
            rendered, so a completed run gave no way to see what it actually
            produced — the reason to run it at all.
          */}
          {selectedNode.result != null && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                  Work Product
                </span>
                {selectedNode.fromCache && (
                  <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                    Served from cache
                  </span>
                )}
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border border-cyan-900/50 bg-[#0d1117] p-4">
                {/*
                  Workers write the deliverable into `content_markdown`. Piping
                  a long prose string through the JSON view renders it as one
                  escaped line, so prose is shown as prose and only genuinely
                  structured payloads (or a human override) get the tree.
                */}
                {resultMarkdown(selectedNode.result) ? (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">
                    {resultMarkdown(selectedNode.result)}
                  </pre>
                ) : (
                  <pre className="font-mono text-[11px] leading-relaxed">
                    <JsonView value={selectedNode.result} />
                  </pre>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                Tokens Consumed
              </span>
              <span className="font-mono text-sm text-slate-200">
                {selectedNode.tokensUsed.toLocaleString()}{" "}
                <span className="text-[10px] text-slate-500">tks</span>
              </span>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                Model Router Tier
              </span>
              <span className="font-mono text-sm text-cyan-400">
                {selectedNode.model}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                Calculated Cost
              </span>
              <span className="font-mono text-sm text-emerald-400">
                ${selectedNode.costUsd.toFixed(6)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 py-8 text-center text-xs text-slate-500">
          Select any DAG node above to inspect its execution output and telemetry.
        </div>
      )}
    </div>
  );
}
