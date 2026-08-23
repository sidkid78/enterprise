import type { TrainingModule } from "@/lib/data/workforce";

export default function WorkforceUpskillingHub({
  workspaceName,
  modules,
}: {
  workspaceName: string;
  modules: TrainingModule[];
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-xl font-bold text-white">
            <span>Workforce Enablement &amp; SOP Hub</span>
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Standard Operating Procedures and HITL training coverage for{" "}
            {workspaceName}.
          </p>
        </div>
        <button className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm font-semibold text-indigo-400 transition-colors hover:bg-indigo-500/20">
          + Create New SOP Node
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-2">
          <h3 className="mb-4 text-sm font-bold text-white">
            Active HITL Training Modules
          </h3>

          {modules.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No SOP templates yet. They are generated from completed agent runs.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-3 pr-4">Module Name</th>
                    <th className="px-4 pb-3">Completion</th>
                    <th className="px-4 pb-3">Agents Assigned</th>
                    <th className="px-4 pb-3">Human Supervisors</th>
                    <th className="pb-3 pl-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {modules.map((mod) => (
                    <tr
                      key={mod.id}
                      className="border-b border-slate-800/50 transition-colors hover:bg-slate-800/20"
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-slate-200">
                            {mod.title}
                          </span>
                          {!mod.isPublished && (
                            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                              Draft
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs text-slate-500">
                          {mod.workflowDomain}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-full min-w-[60px] rounded-full bg-slate-800">
                            <div
                              className={`h-2 rounded-full ${
                                mod.completion === 100
                                  ? "bg-emerald-400"
                                  : "bg-cyan-500"
                              }`}
                              style={{ width: `${mod.completion}%` }}
                            ></div>
                          </div>
                          <span className="font-mono text-xs text-slate-400">
                            {mod.completion}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-bold text-cyan-400">
                          {mod.agentsAssigned}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-400">
                          {mod.humans}
                        </span>
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <button className="text-xs font-semibold text-indigo-400 transition-colors hover:text-indigo-300">
                          Review SOP
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div>
            <h3 className="mb-4 text-sm font-bold text-white">
              Workforce Telemetry
            </h3>

            {/*
              These three figures were hard-coded placeholders in the mock. There
              is no instrumentation behind them yet — decision latency and
              confidence accuracy need timing columns on hitl_approval_gates and
              agent_node_executions first. Showing "—" rather than inventing
              numbers, since a governance dashboard that displays fabricated
              telemetry is worse than one that admits a gap.
            */}
            <div className="space-y-4">
              {[
                "Human Decision Avg Latency",
                "Agent Decision Avg Latency",
                "Agent Confidence Accuracy",
              ].map((label) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">
                    {label}
                  </p>
                  <p className="font-mono text-xl text-slate-600">
                    &mdash;
                    <span className="ml-2 text-[10px] uppercase tracking-wide">
                      not instrumented
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
          <button className="mt-6 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700">
            Generate Performance Report
          </button>
        </div>
      </div>
    </div>
  );
}
