"use client";

import { useActionState } from "react";

import {
  discoverTools,
  registerMcpServer,
  removeMcpServer,
  setServerActive,
  updateToolPolicy,
  type McpState,
} from "@/app/dashboard/mcp-actions";
import type { McpServerSummary, McpToolSummary } from "@/lib/data/mcp";

const initialState: McpState = { error: null, message: null };

function Feedback({ state }: { state: McpState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-3 rounded-md border px-3 py-2 text-xs ${
        state.error
          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {state.error ?? state.message}
    </p>
  );
}

function RegisterServerForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(
    registerMcpServer,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="rounded-xl border border-slate-800 bg-slate-900 p-5"
    >
      <h3 className="mb-1 text-sm font-bold text-slate-100">
        Connect a tool server
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        Streamable HTTP MCP servers only. The runtime calls them itself, so every
        invocation passes the approval gate and lands in the audit ledger.
      </p>

      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-col gap-3">
        <input
          name="serverName"
          required
          maxLength={60}
          disabled={pending}
          placeholder="billing_ops"
          aria-label="Server name"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />
        <input
          name="endpointUrl"
          required
          type="url"
          disabled={pending}
          placeholder="https://mcp.example.com/mcp"
          aria-label="Endpoint URL"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />
        <div>
          <input
            name="bearerToken"
            type="password"
            disabled={pending}
            placeholder="Bearer token (optional)"
            aria-label="Bearer token"
            autoComplete="off"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-amber-500/80">
            Write-only — it is never shown again, and no client role can read it
            back. It is not yet encrypted at rest, so treat this as development
            configuration rather than a place for a production secret.
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Registering…" : "Register"}
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function ServerCard({
  workspaceId,
  server,
  tools,
}: {
  workspaceId: string;
  server: McpServerSummary;
  tools: McpToolSummary[];
}) {
  const [discoverState, discoverAction, discovering] = useActionState(
    discoverTools,
    initialState,
  );
  const [activeState, activeAction, togglingActive] = useActionState(
    setServerActive,
    initialState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeMcpServer,
    initialState,
  );

  const unattended = tools.filter(
    (tool) => tool.isEnabled && !tool.requiresApproval,
  ).length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-100">
              {server.serverName}
            </h3>
            {!server.isActive && (
              <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Disabled
              </span>
            )}
            {!server.isExecutable && (
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                {server.transportType} — not callable
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
            {server.endpointUrl}
          </p>
          <p className="mt-1.5 text-xs text-slate-400">
            {tools.length} tool{tools.length === 1 ? "" : "s"}
            {unattended > 0 && (
              <>
                {" · "}
                <span className="text-amber-400">
                  {unattended} run{unattended === 1 ? "s" : ""} without approval
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action={discoverAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="serverId" value={server.id} />
            <button
              type="submit"
              disabled={discovering || !server.isExecutable}
              className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {discovering ? "Discovering…" : "Discover tools"}
            </button>
          </form>

          <form action={activeAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="serverId" value={server.id} />
            <input
              type="hidden"
              name="isActive"
              value={String(!server.isActive)}
            />
            <button
              type="submit"
              disabled={togglingActive}
              className="rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-slate-600 disabled:opacity-50"
            >
              {server.isActive ? "Disable" : "Enable"}
            </button>
          </form>

          <form action={removeAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="serverId" value={server.id} />
            <button
              type="submit"
              disabled={removing}
              className="rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
        </div>
      </div>

      <div className="px-5">
        <Feedback state={discoverState} />
        <Feedback state={activeState} />
        <Feedback state={removeState} />
      </div>

      {tools.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">
          No tools discovered yet.
        </p>
      ) : (
        <div className="overflow-x-auto p-5 pt-4">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="pb-2">Tool</th>
                <th className="pb-2 text-center">Offered</th>
                <th className="pb-2 text-center">Approval</th>
                <th className="pb-2 text-center">Read-only</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <ToolRow
                  key={tool.id}
                  workspaceId={workspaceId}
                  tool={tool}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PolicyToggle({
  workspaceId,
  toolId,
  field,
  value,
  onLabel,
  offLabel,
  danger,
}: {
  workspaceId: string;
  toolId: string;
  field: string;
  value: boolean;
  onLabel: string;
  offLabel: string;
  /** Styles the "off" state as a warning, for switches that remove a control. */
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateToolPolicy,
    initialState,
  );

  const tone = value
    ? danger
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
    : danger
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-slate-700 bg-slate-800 text-slate-400";

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="toolId" value={toolId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!value)} />
      <button
        type="submit"
        disabled={pending}
        title={state.error ?? undefined}
        className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-50 ${tone}`}
      >
        {pending ? "…" : value ? onLabel : offLabel}
      </button>
    </form>
  );
}

function ToolRow({
  workspaceId,
  tool,
}: {
  workspaceId: string;
  tool: McpToolSummary;
}) {
  return (
    <tr className="border-b border-slate-800/60 last:border-0">
      <td className="py-3 pr-4">
        <div className="font-mono text-xs text-slate-200">{tool.toolName}</div>
        {tool.description && (
          <div className="mt-0.5 max-w-md text-[11px] leading-relaxed text-slate-500">
            {tool.description}
          </div>
        )}
      </td>
      <td className="py-3 text-center">
        <PolicyToggle
          workspaceId={workspaceId}
          toolId={tool.id}
          field="enabled"
          value={tool.isEnabled}
          onLabel="Offered"
          offLabel="Withheld"
        />
      </td>
      <td className="py-3 text-center">
        <PolicyToggle
          workspaceId={workspaceId}
          toolId={tool.id}
          field="approval"
          value={tool.requiresApproval}
          onLabel="Required"
          offLabel="Unattended"
          danger
        />
      </td>
      <td className="py-3 text-center">
        <PolicyToggle
          workspaceId={workspaceId}
          toolId={tool.id}
          field="readOnly"
          value={tool.isReadOnly}
          onLabel="Yes"
          offLabel="No"
        />
      </td>
    </tr>
  );
}

export default function McpToolRegistry({
  workspaceId,
  servers,
  tools,
}: {
  workspaceId: string;
  servers: McpServerSummary[];
  tools: McpToolSummary[];
}) {
  const unattended = tools.filter(
    (tool) => tool.isEnabled && !tool.requiresApproval,
  ).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Tool Access & Approval Policy
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              What agents can reach, and what they may do without asking. A newly
              discovered tool always requires approval until changed here.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>
              <span className="text-slate-400">Servers: </span>
              <span className="font-bold text-slate-200">{servers.length}</span>
            </span>
            <span>
              <span className="text-slate-400">Unattended: </span>
              <span
                className={`font-bold ${unattended > 0 ? "text-amber-400" : "text-emerald-400"}`}
              >
                {unattended}
              </span>
            </span>
          </div>
        </div>

        <RegisterServerForm workspaceId={workspaceId} />
      </div>

      {servers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-12 text-center">
          <p className="text-sm text-slate-400">No tool servers connected.</p>
          <p className="mt-1 text-xs text-slate-500">
            Agents can reason and write, but cannot act on any system until one
            is registered.
          </p>
        </div>
      ) : (
        servers.map((server) => (
          <ServerCard
            key={server.id}
            workspaceId={workspaceId}
            server={server}
            tools={tools.filter((tool) => tool.serverId === server.id)}
          />
        ))
      )}
    </div>
  );
}
