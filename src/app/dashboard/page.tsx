import Link from "next/link";

import BioRoiCommercialization from "@/components/dashboard/BioRoiCommercialization";
import GovernanceControlPlane from "@/components/dashboard/GovernanceControlPlane";
import KnowledgeBaseHub from "@/components/dashboard/KnowledgeBaseHub";
import McpToolRegistry from "@/components/dashboard/McpToolRegistry";
import DagTraceVisualizer from "@/components/dashboard/DagTraceVisualizer";
import HitlQueueDashboard from "@/components/dashboard/HitlQueueDashboard";
import LaunchRunForm from "@/components/dashboard/LaunchRunForm";
import WorkforceUpskillingHub from "@/components/dashboard/WorkforceUpskillingHub";
import WorkspaceSwitcher from "@/components/dashboard/WorkspaceSwitcher";
import { signOut } from "@/app/login/actions";
import { getRoiSummary } from "@/lib/data/bio";
import { countActiveExecutions, getRecentExecutions } from "@/lib/data/dag";
import { countPendingGates, getPendingGates } from "@/lib/data/hitl";
import {
  getKnowledgeBases,
  getKnowledgeDocuments,
} from "@/lib/data/knowledge";
import {
  getGuardrailEvents,
  getLedgerEntries,
  tallyGates,
  verifyLedgerChain,
  LEDGER_ROLES,
} from "@/lib/data/governance";
import { getMcpServers, getMcpTools } from "@/lib/data/mcp";
import { getTrainingModules } from "@/lib/data/workforce";
import { resolveActiveWorkspace } from "@/lib/data/workspaces";

const TABS = [
  { key: "hitl", label: "HITL Decision Queue" },
  { key: "dag", label: "DAG Execution Visualizer" },
  { key: "knowledge", label: "Domain Knowledge" },
  { key: "tools", label: "Tool Access" },
  { key: "governance", label: "Governance & Audit" },
  { key: "upskilling", label: "Workforce Enablement & SOPs" },
  { key: "bio", label: "BIO ROI & SLA Billing" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function toTab(raw: string | string[] | undefined): TabKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "hitl";
}

export default async function EnterpriseDashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const params = await searchParams;
  const tab = toTab(params.tab);
  const requestedWorkspace = Array.isArray(params.workspace)
    ? params.workspace[0]
    : params.workspace;

  // Redirects to /login or /onboarding when there is no usable workspace.
  const { active, all } = await resolveActiveWorkspace(requestedWorkspace);

  // Header counters are always shown, so they load regardless of active tab.
  const [pendingHitlCount, activeDagRuns, roi] = await Promise.all([
    countPendingGates(active.id),
    countActiveExecutions(active.id),
    getRoiSummary(active.id),
  ]);

  const tabHref = (key: TabKey) =>
    `/dashboard?tab=${key}&workspace=${active.id}`;

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 antialiased selection:bg-cyan-500 selection:text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 text-xl font-bold text-slate-950 shadow-lg shadow-cyan-500/20">
              Æ
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  Enterprise AgentOps
                </h1>
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                  {active.enterpriseTier.replaceAll("_", " ")}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Multi-Agent Orchestration &amp; Governance Control Plane
              </p>
            </div>
          </div>

          <div className="hidden items-center space-x-6 lg:flex">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></div>
              <span className="text-xs text-slate-400">SLA Uptime:</span>
              <span className="font-mono text-xs font-semibold text-emerald-400">
                {roi.uptimeSlaActual.toFixed(2)}%
              </span>
            </div>
            <div className="h-4 w-px bg-slate-800"></div>
            <div className="text-xs">
              <span className="text-slate-400">Deflected Cost: </span>
              <span className="font-mono font-bold text-cyan-400">
                $
                {roi.totalDeflectedCostUsd.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-800"></div>
            <WorkspaceSwitcher workspaces={all} activeId={active.id} />
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-slate-400 transition-colors hover:text-slate-200"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 border-b border-slate-800">
          <nav className="flex space-x-8" aria-label="Tabs">
            {TABS.map(({ key, label }) => {
              const isActive = key === tab;
              return (
                <Link
                  key={key}
                  href={tabHref(key)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center space-x-2 border-b-2 px-1 pb-4 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-cyan-500 text-cyan-400"
                      : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <span>{label}</span>
                  {key === "hitl" && pendingHitlCount > 0 && (
                    <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400">
                      {pendingHitlCount}
                    </span>
                  )}
                  {key === "dag" && (
                    <span className="ml-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400">
                      {activeDagRuns} Live
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {(tab === "hitl" || tab === "dag") && (
          <LaunchRunForm workspaceId={active.id} />
        )}

        {tab === "hitl" && (
          <HitlQueueDashboard
            gates={await getPendingGates(active.id)}
            viewerRole={active.role}
          />
        )}
        {tab === "dag" && (
          <DagTraceVisualizer executions={await getRecentExecutions(active.id)} />
        )}
        {tab === "knowledge" && (
          <KnowledgeBaseHub
            workspaceId={active.id}
            bases={await getKnowledgeBases(active.id)}
            documents={await getKnowledgeDocuments(active.id)}
          />
        )}
        {tab === "tools" && (
          <McpToolRegistry
            workspaceId={active.id}
            servers={await getMcpServers(active.id)}
            tools={await getMcpTools(active.id)}
          />
        )}
        {tab === "governance" && (
          <GovernanceTab workspaceId={active.id} viewerRole={active.role} />
        )}
        {tab === "upskilling" && (
          <WorkforceUpskillingHub
            workspaceName={active.name}
            modules={await getTrainingModules(active.id)}
          />
        )}
        {tab === "bio" && (
          <BioRoiCommercialization
            workspaceName={active.name}
            roi={roi}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Governance tab data.
 *
 * Split out so the ledger queries are skipped for roles the RLS policy would
 * return nothing to anyway — asking and getting zero rows would render as "no
 * entries recorded", which is a different and misleading claim.
 */
async function GovernanceTab({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: string;
}) {
  const canReadLedger = LEDGER_ROLES.includes(viewerRole);

  const [events, ledger, verification] = await Promise.all([
    getGuardrailEvents(workspaceId),
    canReadLedger ? getLedgerEntries(workspaceId) : Promise.resolve([]),
    canReadLedger ? verifyLedgerChain(workspaceId) : Promise.resolve(null),
  ]);

  return (
    <GovernanceControlPlane
      events={events}
      tallies={tallyGates(events)}
      ledger={ledger}
      verification={verification}
      canReadLedger={canReadLedger}
    />
  );
}
