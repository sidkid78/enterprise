import Link from "next/link";

import AccessControlPanel from "@/components/dashboard/AccessControlPanel";
import BioRoiCommercialization from "@/components/dashboard/BioRoiCommercialization";
import GovernanceControlPlane from "@/components/dashboard/GovernanceControlPlane";
import KnowledgeBaseHub from "@/components/dashboard/KnowledgeBaseHub";
import McpToolRegistry from "@/components/dashboard/McpToolRegistry";
import OutcomeAttribution from "@/components/dashboard/OutcomeAttribution";
import QueueHealthPanel from "@/components/dashboard/QueueHealthPanel";
import SlaBillingPanel from "@/components/dashboard/SlaBillingPanel";
import SopWorkbench from "@/components/dashboard/SopWorkbench";
import DagTraceVisualizer from "@/components/dashboard/DagTraceVisualizer";
import HitlQueueDashboard from "@/components/dashboard/HitlQueueDashboard";
import LaunchRunForm from "@/components/dashboard/LaunchRunForm";
import WorkforceUpskillingHub from "@/components/dashboard/WorkforceUpskillingHub";
import WorkspaceSwitcher from "@/components/dashboard/WorkspaceSwitcher";
import { signOut } from "@/app/login/actions";
import {
  getAttributableRuns,
  getBaselines,
  getOutcomes,
  getRoiSummary,
  getSlaCredit,
} from "@/lib/data/bio";
import { countActiveExecutions, getRecentExecutions } from "@/lib/data/dag";
import {
  countOverdueGates,
  countPendingGates,
  getPendingGates,
} from "@/lib/data/hitl";
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
import { getBudgetStatus } from "@/lib/data/finops";
import { getMcpServers, getMcpTools } from "@/lib/data/mcp";
import {
  countDeadLetters,
  getQueueHealth,
  getWorkerFleet,
} from "@/lib/data/queue";
import { getInvitations, getMembers } from "@/lib/data/members";
import { getAgentMessages } from "@/lib/data/messages";
import { getTrainingModules } from "@/lib/data/workforce";
import { getUserClaims, resolveActiveWorkspace } from "@/lib/data/workspaces";
import { ROLE_POWER, type UserRole } from "@/lib/roles";

const TABS = [
  { key: "hitl", label: "HITL Decision Queue" },
  { key: "dag", label: "DAG Execution Visualizer" },
  { key: "knowledge", label: "Domain Knowledge" },
  { key: "tools", label: "Tool Access" },
  { key: "governance", label: "Governance & Audit" },
  { key: "upskilling", label: "Workforce Enablement & SOPs" },
  { key: "bio", label: "BIO ROI & SLA Billing" },
  { key: "access", label: "Access Control" },
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
  const [
    pendingHitlCount,
    activeDagRuns,
    roi,
    budget,
    deadLetterCount,
    overdueGateCount,
  ] =
    await Promise.all([
      countPendingGates(active.id),
      countActiveExecutions(active.id),
      getRoiSummary(active.id),
      getBudgetStatus(active.id),
      // On every tab, not just Governance: a run the queue gave up on is
      // invisible otherwise, which is the whole failure this counter exists to
      // prevent. An operator should not have to go looking for it.
      countDeadLetters(active.id),
      // Also on every tab. A gate nobody answers is the quietest failure in the
      // product: it holds no worker, blocks no queue and raises no error, while
      // the run behind it stays frozen. One had been waiting 111 hours.
      countOverdueGates(active.id),
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
            {/*
              Only shown when there is a measurement behind it. A green pulsing
              dot beside an unmeasured 100.00% is an availability claim the
              platform has not earned.
            */}
            <div className="flex items-center space-x-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  !roi.availabilityMeasured
                    ? "bg-slate-600"
                    : roi.uptimeSlaActual >= roi.uptimeSlaTarget
                      ? "animate-pulse bg-emerald-400"
                      : "animate-pulse bg-amber-400"
                }`}
              ></div>
              <span className="text-xs text-slate-400">SLA Uptime:</span>
              <span
                className={`font-mono text-xs font-semibold ${
                  !roi.availabilityMeasured
                    ? "text-slate-500"
                    : roi.uptimeSlaActual >= roi.uptimeSlaTarget
                      ? "text-emerald-400"
                      : "text-amber-400"
                }`}
              >
                {roi.availabilityMeasured
                  ? `${roi.uptimeSlaActual.toFixed(2)}%`
                  : "not measured"}
              </span>
            </div>
            {budget && budget.monthlyBudgetUsd > 0 && (
              <>
                <div className="h-4 w-px bg-slate-800"></div>
                {/*
                  Spend against the cap, in the header rather than on a tab,
                  because a workspace that has run out of budget stops
                  everything — that is not a fact to go looking for.
                */}
                <div
                  className="text-xs"
                  title={
                    budget.hardStopEnabled
                      ? "Runs are refused once spend reaches the cap."
                      : "Hard stop is disabled; runs continue past the cap."
                  }
                >
                  <span className="text-slate-400">Budget: </span>
                  <span
                    className={`font-mono font-bold ${
                      budget.overBudget
                        ? "text-rose-400"
                        : (budget.fractionUsed ?? 0) >= 0.8
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}
                  >
                    ${budget.currentSpendUsd.toFixed(2)} / $
                    {budget.monthlyBudgetUsd.toFixed(2)}
                  </span>
                  {budget.overBudget && (
                    <span className="ml-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-400">
                      {budget.hardStopEnabled ? "Halted" : "Over"}
                    </span>
                  )}
                </div>
              </>
            )}
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
                  {key === "hitl" && overdueGateCount > 0 && (
                    <span className="ml-1 rounded-full border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
                      {overdueGateCount} overdue
                    </span>
                  )}
                  {key === "governance" && deadLetterCount > 0 && (
                    <span className="ml-2 rounded-full border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
                      {deadLetterCount} stalled
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
        {tab === "dag" && <DagTab workspaceId={active.id} />}
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
        {tab === "access" && (
          <AccessTab workspaceId={active.id} viewerRole={active.role} />
        )}
        {tab === "upskilling" && (
          <UpskillingTab workspaceId={active.id} workspaceName={active.name} viewerRole={active.role} />
        )}
        {tab === "bio" && (
          <div className="space-y-6">
            <BioRoiCommercialization workspaceName={active.name} roi={roi} />
            <SlaBillingPanel credit={await getSlaCredit(active.id)} />
            <BioAttributionTab workspaceId={active.id} viewerRole={active.role} />
          </div>
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
/**
 * Membership and invitations.
 *
 * The roster is readable by every member — knowing who may act in a workspace,
 * and at what rank, is not privileged inside that workspace. Only
 * `ai_administrator` and above may change it, which the RLS policies enforce;
 * `canManage` only decides whether to render controls that would otherwise
 * fail.
 */
/**
 * The DAG tab and its transcripts.
 *
 * Transcripts are fetched for every execution shown rather than for the
 * selected one, because which execution is selected is client state and a
 * server component cannot see it. Five runs of a handful of turns each is a
 * small enough read to prefer over a round trip on every selection.
 */
async function DagTab({ workspaceId }: { workspaceId: string }) {
  const executions = await getRecentExecutions(workspaceId);

  const transcripts = Object.fromEntries(
    await Promise.all(
      executions.map(
        async (e) => [e.id, await getAgentMessages(e.id)] as const,
      ),
    ),
  );

  return (
    <DagTraceVisualizer executions={executions} transcripts={transcripts} />
  );
}

async function AccessTab({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: UserRole;
}) {
  const claims = await getUserClaims();
  const viewerId = String(claims?.sub ?? "");
  const canManage = ROLE_POWER[viewerRole] >= ROLE_POWER.ai_administrator;

  const [members, invitations] = await Promise.all([
    getMembers(workspaceId),
    // Returns [] rather than throwing when the policy admits nothing, so an
    // ordinary member reading the roster is not an error page.
    canManage ? getInvitations(workspaceId) : Promise.resolve([]),
  ]);

  return (
    <AccessControlPanel
      workspaceId={workspaceId}
      viewerId={viewerId}
      viewerRole={viewerRole}
      members={members}
      invitations={invitations}
      canManage={canManage}
    />
  );
}

async function GovernanceTab({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: string;
}) {
  const canReadLedger = LEDGER_ROLES.includes(viewerRole);

  const [events, ledger, verification, queue, workers] = await Promise.all([
    getGuardrailEvents(workspaceId),
    canReadLedger ? getLedgerEntries(workspaceId) : Promise.resolve([]),
    canReadLedger ? verifyLedgerChain(workspaceId) : Promise.resolve(null),
    // Queue rows are readable by every member (migration ...15) — seeing that
    // a run stalled is not a privileged fact. Restarting one is, which the
    // action enforces separately.
    getQueueHealth(workspaceId),
    // Fleet-wide, not workspace-scoped: one worker drains every tenant, so
    // "is anything running?" has the same answer for all of them.
    getWorkerFleet(),
  ]);

  return (
    <>
      <QueueHealthPanel
        workspaceId={workspaceId}
        health={queue}
        workers={workers}
        canRetry={REQUEUE_ROLES.includes(viewerRole)}
        renderedAt={queue.observedAt}
      />
      <GovernanceControlPlane
        events={events}
        tallies={tallyGates(events)}
        ledger={ledger}
        verification={verification}
        canReadLedger={canReadLedger}
      />
    </>
  );
}

/** Mirrors REQUEUE_ROLES in queue-actions.ts, which is the enforcing copy. */
const REQUEUE_ROLES = ["workspace_owner", "ai_administrator", "agent_operator"];

/** Roles that may draft procedures and record commercial measurements. */
const REPORTING_ROLES = ["workspace_owner", "ai_administrator"];

async function UpskillingTab({
  workspaceId,
  workspaceName,
  viewerRole,
}: {
  workspaceId: string;
  workspaceName: string;
  viewerRole: string;
}) {
  const [modules, runs] = await Promise.all([
    getTrainingModules(workspaceId),
    getAttributableRuns(workspaceId),
  ]);

  return (
    <>
      <SopWorkbench
        workspaceId={workspaceId}
        runs={runs}
        sops={modules}
        canEdit={REPORTING_ROLES.includes(viewerRole)}
      />
      <WorkforceUpskillingHub workspaceName={workspaceName} modules={modules} />
    </>
  );
}

async function BioAttributionTab({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: string;
}) {
  const [baselines, outcomes, runs] = await Promise.all([
    getBaselines(workspaceId),
    getOutcomes(workspaceId),
    getAttributableRuns(workspaceId),
  ]);

  return (
    <OutcomeAttribution
      workspaceId={workspaceId}
      baselines={baselines}
      outcomes={outcomes}
      runs={runs}
      canEdit={REPORTING_ROLES.includes(viewerRole)}
    />
  );
}
