import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

import { callTool, connect, listTools, McpError } from "./client";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Separates a server name from a tool name in the function declaration exposed
 * to the model.
 *
 * Two servers may each expose `search`, and the model is given one flat
 * namespace. A double underscore survives the API's `^[a-zA-Z0-9_-]+$` name
 * constraint, which a `.` or `/` would not.
 */
const NAMESPACE_SEPARATOR = "__";

export type RegisteredTool = {
  id: string;
  serverId: string;
  serverName: string;
  endpointUrl: string;
  transportType: string;
  authMetadata: Record<string, unknown>;
  toolName: string;
  /** The namespaced name the model sees. */
  declaredName: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  isReadOnly: boolean;
};

/** A Gemini function declaration. */
export type FunctionDeclaration = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * MCP names are looser than the Interactions API allows for a function name.
 * Anything outside the permitted set is replaced rather than dropped, so two
 * distinct tools cannot collapse onto one declaration.
 */
function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function declaredNameFor(serverName: string, toolName: string): string {
  return `${sanitizeName(serverName)}${NAMESPACE_SEPARATOR}${sanitizeName(toolName)}`.slice(
    0,
    // The API rejects very long function names; truncating keeps the prefix,
    // which is the part that disambiguates servers.
    63,
  );
}

/**
 * An MCP `inputSchema` is JSON Schema, which is broader than the subset the
 * Interactions API accepts for function parameters. Keys that are meaningless
 * to it are dropped rather than passed through, since an unrecognized keyword
 * causes the whole declaration to be rejected.
 */
function toParameters(schema: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "description",
    "nullable",
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      out[key] = key === "properties"
        ? Object.fromEntries(
            Object.entries((value ?? {}) as Record<string, unknown>).map(
              ([prop, propSchema]) => [prop, walk(propSchema)],
            ),
          )
        : walk(value);
    }
    return out;
  };

  const parameters = walk(schema) as Record<string, unknown>;
  // A function declaration must always describe an object, even a tool that
  // takes nothing.
  if (!parameters.type) parameters.type = "object";
  if (!parameters.properties) parameters.properties = {};
  return parameters;
}

/**
 * Every tool an agent in this workspace is allowed to be offered.
 *
 * Reads with the service role, so the caller must have verified workspace
 * membership — the same contract as launchGraph. Disabled tools and inactive
 * servers are excluded here rather than filtered later: a tool the operator
 * switched off should never reach the model's declaration list at all.
 */
export async function loadWorkspaceTools(
  db: Db,
  workspaceId: string,
): Promise<RegisteredTool[]> {
  const { data, error } = await db
    .from("mcp_tools")
    .select(
      `id, mcp_server_id, tool_name, description, input_schema, requires_approval, is_read_only,
       mcp_servers!inner(id, server_name, endpoint_url, transport_type, encrypted_auth_metadata, is_active)`,
    )
    .eq("workspace_id", workspaceId)
    .eq("is_enabled", true)
    .eq("mcp_servers.is_active", true);

  if (error || !data) return [];

  type ServerRow = {
    id: string;
    server_name: string;
    endpoint_url: string;
    transport_type: string;
    encrypted_auth_metadata: Record<string, unknown> | null;
  };

  type Row = {
    id: string;
    mcp_server_id: string;
    tool_name: string;
    description: string | null;
    input_schema: Record<string, unknown> | null;
    requires_approval: boolean;
    is_read_only: boolean;
    // A to-one embed arrives as an object, but the untyped client widens it.
    mcp_servers: ServerRow | ServerRow[] | null;
  };

  return (data as unknown as Row[]).flatMap((row) => {
    const server = Array.isArray(row.mcp_servers)
      ? row.mcp_servers[0]
      : row.mcp_servers;
    if (!server) return [];

    return [
      {
        id: row.id,
        serverId: server.id,
        serverName: server.server_name,
        endpointUrl: server.endpoint_url,
        transportType: server.transport_type,
        authMetadata: server.encrypted_auth_metadata ?? {},
        toolName: row.tool_name,
        declaredName: declaredNameFor(server.server_name, row.tool_name),
        description: row.description,
        inputSchema: row.input_schema ?? {},
        requiresApproval: row.requires_approval,
        isReadOnly: row.is_read_only,
      },
    ];
  });
}

export function toDeclarations(tools: RegisteredTool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.declaredName,
    description: [
      tool.description ?? `The ${tool.toolName} tool.`,
      // Stated in the description because the model is the one deciding
      // whether a step is worth stalling for a human.
      tool.requiresApproval
        ? "Calling this pauses the run for human approval, so use it only when the objective genuinely needs it."
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    parameters: toParameters(tool.inputSchema),
  }));
}

/**
 * Builds the headers for a server, from whatever the operator stored.
 *
 * `encrypted_auth_metadata` is a free-form jsonb blob — it is not actually
 * encrypted at rest today, which is why the column is now unreadable by client
 * roles (migration ...11). Real encryption belongs here before a production
 * credential is stored.
 */
function headersFor(tool: RegisteredTool): Record<string, string> {
  const meta = tool.authMetadata;
  const headers: Record<string, string> = {};

  if (typeof meta.bearer_token === "string") {
    headers.authorization = `Bearer ${meta.bearer_token}`;
  }
  if (meta.headers && typeof meta.headers === "object") {
    for (const [key, value] of Object.entries(
      meta.headers as Record<string, unknown>,
    )) {
      if (typeof value === "string") headers[key.toLowerCase()] = value;
    }
  }

  return headers;
}

export type ToolInvocationOutcome = {
  ok: boolean;
  /** What is handed back to the model as the function result. */
  payload: Record<string, unknown>;
  /** Text form, for the injection screen and the audit trail. */
  text: string;
  durationMs: number;
};

/**
 * Invokes one registered tool.
 *
 * Never throws: a failing tool is a result the model should see and react to,
 * not an exception that kills the run. The distinction the model needs — "the
 * tool ran and said no" versus "the tool could not be reached" — is preserved
 * in the payload.
 */
export async function invokeTool(
  tool: RegisteredTool,
  args: Record<string, unknown>,
): Promise<ToolInvocationOutcome> {
  const startedAt = Date.now();

  if (tool.transportType !== "http_stream") {
    return {
      ok: false,
      payload: {
        error: `Transport "${tool.transportType}" is not executable. Register the server as http_stream.`,
      },
      text: "",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const connection = await connect({
      endpointUrl: tool.endpointUrl,
      headers: headersFor(tool),
    });

    const result = await callTool(connection, tool.toolName, args);

    return {
      ok: !result.isError,
      payload: result.isError
        ? { error: result.text || "The tool reported a failure." }
        : { result: result.structured ?? result.text },
      text: result.text,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      payload: {
        error:
          err instanceof McpError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown MCP failure.",
      },
      text: "",
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Discovers a server's tools and writes them into the registry.
 *
 * New tools arrive with `requires_approval` at its column default of true —
 * discovery deliberately cannot grant an agent the right to run something
 * unattended. Existing rows keep the operator's settings; only the description
 * and schema are refreshed, because those are the server's to change.
 */
export async function syncServerTools(
  db: Db,
  params: { workspaceId: string; serverId: string },
): Promise<{ discovered: number; error: string | null }> {
  const { data: server, error: serverError } = await db
    .from("mcp_servers")
    .select("id, server_name, endpoint_url, transport_type, encrypted_auth_metadata")
    .eq("id", params.serverId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (serverError || !server) {
    return { discovered: 0, error: "Server not found in this workspace." };
  }

  if (server.transport_type !== "http_stream") {
    return {
      discovered: 0,
      error: `Transport "${server.transport_type}" is not supported. Only http_stream servers can be reached.`,
    };
  }

  try {
    const meta = (server.encrypted_auth_metadata ?? {}) as Record<string, unknown>;
    const connection = await connect({
      endpointUrl: server.endpoint_url,
      headers: headersFor({
        authMetadata: meta,
      } as RegisteredTool),
    });

    const tools = await listTools(connection);
    if (tools.length === 0) {
      return { discovered: 0, error: "Server exposed no tools." };
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await db.from("mcp_tools").upsert(
      tools.map((tool) => ({
        workspace_id: params.workspaceId,
        mcp_server_id: server.id,
        tool_name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
        last_synced_at: now,
      })),
      // Matches the (mcp_server_id, tool_name) unique constraint. Governance
      // columns are omitted from the payload so an upsert cannot reset an
      // operator's approval decision.
      { onConflict: "mcp_server_id,tool_name" },
    );

    if (upsertError) {
      return { discovered: 0, error: upsertError.message };
    }

    return { discovered: tools.length, error: null };
  } catch (err) {
    return {
      discovered: 0,
      error: err instanceof Error ? err.message : "Discovery failed.",
    };
  }
}
