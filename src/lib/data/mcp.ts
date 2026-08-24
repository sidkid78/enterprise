import "server-only";

import { createClient } from "@/lib/supabase/server";

export type McpServerSummary = {
  id: string;
  serverName: string;
  endpointUrl: string;
  transportType: string;
  isActive: boolean;
  /** True when this transport can actually be called by the runtime. */
  isExecutable: boolean;
  toolCount: number;
  createdAt: string;
};

export type McpToolSummary = {
  id: string;
  serverId: string;
  toolName: string;
  description: string | null;
  isEnabled: boolean;
  requiresApproval: boolean;
  isReadOnly: boolean;
  lastSyncedAt: string | null;
};

/**
 * Registered MCP servers in a workspace.
 *
 * `encrypted_auth_metadata` is deliberately absent from the select. Migration
 * ...11 revoked column access to it for client roles, so asking for it here
 * would fail the whole query — and the dashboard has no reason to show a
 * credential back to anyone.
 */
export async function getMcpServers(
  workspaceId: string,
): Promise<McpServerSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mcp_servers")
    .select(
      "id, server_name, endpoint_url, transport_type, is_active, created_at, mcp_tools(count)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load MCP servers: ${error.message}`);
  }

  type Row = {
    id: string;
    server_name: string;
    endpoint_url: string;
    transport_type: string;
    is_active: boolean;
    created_at: string;
    mcp_tools: { count: number }[] | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    serverName: row.server_name,
    endpointUrl: row.endpoint_url,
    transportType: row.transport_type,
    isActive: row.is_active,
    isExecutable: row.transport_type === "http_stream",
    toolCount: row.mcp_tools?.[0]?.count ?? 0,
    createdAt: row.created_at,
  }));
}

export async function getMcpTools(
  workspaceId: string,
): Promise<McpToolSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mcp_tools")
    .select(
      "id, mcp_server_id, tool_name, description, is_enabled, requires_approval, is_read_only, last_synced_at",
    )
    .eq("workspace_id", workspaceId)
    .order("tool_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load MCP tools: ${error.message}`);
  }

  type Row = {
    id: string;
    mcp_server_id: string;
    tool_name: string;
    description: string | null;
    is_enabled: boolean;
    requires_approval: boolean;
    is_read_only: boolean;
    last_synced_at: string | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    serverId: row.mcp_server_id,
    toolName: row.tool_name,
    description: row.description,
    isEnabled: row.is_enabled,
    requiresApproval: row.requires_approval,
    isReadOnly: row.is_read_only,
    lastSyncedAt: row.last_synced_at,
  }));
}
