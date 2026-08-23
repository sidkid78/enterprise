import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

export type RunReportSection = {
  nodeId: string;
  agentRole: string;
  objective: string;
  summary: string;
  result: unknown;
  fromCache: boolean;
  costUsd: number;
};

export type RunReportTotals = {
  nodeCount: number;
  cachedNodeCount: number;
  costUsd: number;
  tokens: number;
  latencyMs: number;
};

export type RunReport = {
  version: 1;
  generatedAt: string;
  title: string;
  rootPrompt: string;
  /**
   * Preserved from the previous shape of `final_output` so anything already
   * reading `final_output.steps` keeps working.
   */
  steps: string[];
  sections: RunReportSection[];
  totals: RunReportTotals;
  /** The whole deliverable as one Markdown document. */
  markdown: string;
};

/**
 * Ceiling on the rendered document. A runaway `result` object should truncate
 * with a visible marker rather than bloat every read of the executions list.
 */
const MAX_MARKDOWN_CHARS = 120_000;

/** Deepest object nesting rendered as prose before falling back to a JSON block. */
const MAX_DEPTH = 4;

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function renderPrimitive(value: unknown): string {
  if (value === null) return "_none_";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Renders an arbitrary worker `result` as Markdown.
 *
 * The generic fallback, for anything that is not the declared worker shape —
 * a human override payload, or an older run. It walks the value and picks the most readable
 * Markdown for each node, falling back to a fenced JSON block once nesting
 * passes what prose can carry legibly. Nothing is invented: every line here is
 * a value the agent actually produced.
 */
function renderValue(value: unknown, depth: number, headingLevel: number): string {
  if (isPrimitive(value)) return renderPrimitive(value);

  if (depth >= MAX_DEPTH) {
    return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "_none_";
    if (value.every(isPrimitive)) {
      return value.map((item) => `- ${renderPrimitive(item)}`).join("\n");
    }
    return value
      .map((item, index) => {
        const body = renderValue(item, depth + 1, headingLevel + 1);
        return `${"#".repeat(Math.min(headingLevel, 6))} Item ${index + 1}\n\n${body}`;
      })
      .join("\n\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "_none_";

  return entries
    .map(([key, child]) => {
      const label = humanizeKey(key);
      if (isPrimitive(child)) return `**${label}:** ${renderPrimitive(child)}`;
      if (Array.isArray(child) && child.every(isPrimitive)) {
        const body = child.length
          ? child.map((item) => `- ${renderPrimitive(item)}`).join("\n")
          : "_none_";
        return `**${label}:**\n\n${body}`;
      }
      const body = renderValue(child, depth + 1, headingLevel + 1);
      return `${"#".repeat(Math.min(headingLevel, 6))} ${label}\n\n${body}`;
    })
    .join("\n\n");
}

/**
 * Fits a worker's Markdown under the section that contains it.
 *
 * Workers write standalone documents: they open with their own `#` title and
 * number sections from `##`, which collides with the report's own hierarchy and
 * repeats the heading immediately above. This drops the duplicated title and
 * pushes the rest down to nest under the section's H3. Fenced code is left
 * alone — a `#` there is a comment, not a heading.
 */
function nestHeadings(markdown: string): string {
  const withoutTitle = markdown.trim().replace(/^#{1,2}[ \t]+\S[^\n]*\n+/, "");

  let inFence = false;
  return withoutTitle
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(#{1,6})[ \t]+/, (_, hashes: string) =>
        `${"#".repeat(Math.min(hashes.length + 2, 6))} `,
      );
    })
    .join("\n");
}

/**
 * Renders the declared worker `result` shape as a document body rather than as
 * a key/value dump. `content_markdown` is already Markdown, so it is emitted
 * verbatim; anything the worker added beyond the declared keys still falls
 * through to the generic renderer rather than being dropped.
 */
function renderResult(result: unknown): string {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return renderValue(result, 0, 3);
  }

  const value = result as Record<string, unknown>;
  if (typeof value.content_markdown !== "string") {
    return renderValue(result, 0, 3);
  }

  const blocks: string[] = [];
  if (typeof value.heading === "string" && value.heading.trim()) {
    blocks.push(`### ${value.heading.trim()}`);
  }
  blocks.push(nestHeadings(value.content_markdown));

  if (Array.isArray(value.key_findings) && value.key_findings.length > 0) {
    blocks.push(
      "**Key findings**",
      value.key_findings.map((f) => `- ${renderPrimitive(f)}`).join("\n"),
    );
  }

  if (Array.isArray(value.data) && value.data.length > 0) {
    const rows = value.data.filter(
      (row): row is Record<string, unknown> =>
        row != null && typeof row === "object" && !Array.isArray(row),
    );
    if (rows.length > 0) {
      blocks.push(
        ["| Item | Value | Note |", "| --- | --- | --- |"]
          .concat(
            rows.map(
              (row) =>
                `| ${renderPrimitive(row.label ?? "")} | ${renderPrimitive(row.value ?? "")} | ${renderPrimitive(row.note ?? "")} |`,
            ),
          )
          .join("\n"),
      );
    }
  }

  const extra = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        !["heading", "content_markdown", "key_findings", "data"].includes(key),
    ),
  );
  if (Object.keys(extra).length > 0) {
    blocks.push(renderValue(extra, 0, 4));
  }

  return blocks.join("\n\n");
}

function renderMarkdown(
  report: Omit<RunReport, "markdown">,
): string {
  const { totals } = report;
  const lines: string[] = [
    `# ${report.title}`,
    "",
    `> ${report.rootPrompt}`,
    "",
    [
      `**Steps:** ${totals.nodeCount}`,
      `**Cost:** $${totals.costUsd.toFixed(6)}`,
      `**Tokens:** ${totals.tokens.toLocaleString()}`,
      `**Wall time:** ${(totals.latencyMs / 1000).toFixed(2)}s`,
      totals.cachedNodeCount > 0
        ? `**Served from cache:** ${totals.cachedNodeCount}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    "",
    "## Summary",
    "",
    ...report.steps.map((step) => `- ${step}`),
    "",
  ];

  for (const [index, section] of report.sections.entries()) {
    lines.push(
      `## ${index + 1}. ${humanizeKey(section.agentRole)}`,
      "",
      `_${section.objective}_`,
      "",
      section.summary,
      "",
    );
    if (section.fromCache) {
      lines.push("`served from semantic cache — no model call`", "");
    }
    if (section.result != null) {
      lines.push(renderResult(section.result), "");
    }
  }

  const markdown = lines.join("\n").trimEnd();
  return markdown.length > MAX_MARKDOWN_CHARS
    ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n_[truncated]_`
    : markdown;
}

/**
 * The document's heading. Derived from the request rather than from
 * `orchestrator_name`, which is the same engine label on every run and so tells
 * a reader nothing about which run they are holding.
 */
function toTitle(rootPrompt: string | null, fallback: string | null): string {
  const firstLine = (rootPrompt ?? "").split("\n")[0]?.trim() ?? "";
  if (!firstLine) return fallback ?? "Agent Run";
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

/**
 * Puts nodes in dependency order.
 *
 * Every node of a plan is inserted in one statement, so they all share a
 * `created_at` to the microsecond and ordering by it is arbitrary — the first
 * assembled document came out step_03, step_04, step_01, step_02. Dependencies
 * are the real order; `node_id` breaks ties between independent steps so the
 * document is stable across reads.
 */
function inDependencyOrder<T extends { node_id: string; depends_on: string[] | null }>(
  rows: T[],
): T[] {
  const remaining = [...rows].sort((a, b) => a.node_id.localeCompare(b.node_id));
  const emitted = new Set<string>();
  const ordered: T[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((row) =>
      (row.depends_on ?? []).every(
        (dep) => emitted.has(dep) || !rows.some((r) => r.node_id === dep),
      ),
    );
    // A dependency cycle would leave nothing ready; emit the rest in id order
    // rather than looping forever.
    const [next] = remaining.splice(index === -1 ? 0 : index, 1);
    emitted.add(next.node_id);
    ordered.push(next);
  }

  return ordered;
}

type ReportNodeRow = {
  node_id: string;
  agent_role: string;
  node_status: string;
  depends_on: string[] | null;
  input_payload: { objective?: string } | null;
  output_payload: { summary?: string; result?: unknown } | null;
  interaction_id: string | null;
  cost_usd: number | string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
};

/**
 * Assembles a run's completed nodes into one deliverable.
 *
 * Deliberately deterministic — no model call. A synthesis pass at the end would
 * cost money, sit outside the per-node gates, and could rewrite findings the
 * critic already cleared. Concatenation keeps every line traceable to the node
 * that produced it.
 *
 * Reads back from the database rather than from in-memory state so that a
 * resumed run includes the nodes completed before the pause, and so a
 * human-overridden payload is the one that lands in the document.
 */
export async function buildRunReport(
  db: Db,
  graphExecutionId: string,
): Promise<RunReport | null> {
  const [{ data: graph }, { data: rows }] = await Promise.all([
    db
      .from("agent_graph_executions")
      .select("root_prompt, orchestrator_name")
      .eq("id", graphExecutionId)
      .maybeSingle(),
    db
      .from("agent_node_executions")
      .select(
        "node_id, agent_role, node_status, depends_on, input_payload, output_payload, interaction_id, cost_usd, prompt_tokens, completion_tokens, latency_ms",
      )
      .eq("graph_execution_id", graphExecutionId)
      .order("created_at", { ascending: true }),
  ]);

  if (!graph) return null;

  const nodes = inDependencyOrder(
    ((rows ?? []) as ReportNodeRow[]).filter((n) => n.node_status === "completed"),
  );

  const sections: RunReportSection[] = nodes.map((n) => ({
    nodeId: n.node_id,
    agentRole: n.agent_role,
    objective: n.input_payload?.objective ?? "",
    summary: n.output_payload?.summary ?? "(no summary)",
    result: n.output_payload?.result ?? null,
    // The runtime records an interaction id only when it actually called the
    // model, so a completed node without one was served from cache.
    fromCache: !n.interaction_id,
    costUsd: Number(n.cost_usd ?? 0),
  }));

  const totals: RunReportTotals = {
    nodeCount: sections.length,
    cachedNodeCount: sections.filter((s) => s.fromCache).length,
    costUsd: nodes.reduce((sum, n) => sum + Number(n.cost_usd ?? 0), 0),
    tokens: nodes.reduce(
      (sum, n) => sum + (n.prompt_tokens ?? 0) + (n.completion_tokens ?? 0),
      0,
    ),
    latencyMs: nodes.reduce((sum, n) => sum + (n.latency_ms ?? 0), 0),
  };

  const base: Omit<RunReport, "markdown"> = {
    version: 1,
    generatedAt: new Date().toISOString(),
    title: toTitle(graph.root_prompt, graph.orchestrator_name),
    rootPrompt: graph.root_prompt ?? "",
    steps: sections.map((s) => `${s.nodeId}: ${s.summary}`),
    sections,
    totals,
  };

  return { ...base, markdown: renderMarkdown(base) };
}
