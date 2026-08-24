"use server";

import { revalidatePath } from "next/cache";

import { syncServerTools } from "@/lib/mcp/registry";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type McpState = { error: string | null; message: string | null };

/** Roles allowed to decide what agents can reach and what they may do unattended. */
const ADMIN_ROLES = ["workspace_owner", "ai_administrator"];

/**
 * Verifies the caller may administer this workspace's tool registry.
 *
 * Filters by user_id explicitly: the workspace_members SELECT policy admits the
 * whole roster, so RLS alone returns a row per member rather than per caller.
 */
async function assertAdmin(workspaceId: string): Promise<string | null> {
  if (!workspaceId) return "No workspace selected.";

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "Not signed in.";

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return "You are not a member of this workspace.";
  if (!ADMIN_ROLES.includes(membership.role as string)) {
    return "Your role cannot change the tool registry.";
  }

  return null;
}

export async function registerMcpServer(
  _prev: McpState,
  formData: FormData,
): Promise<McpState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const serverName = String(formData.get("serverName") ?? "").trim();
  const endpointUrl = String(formData.get("endpointUrl") ?? "").trim();
  const bearerToken = String(formData.get("bearerToken") ?? "").trim();

  if (!serverName) return { error: "Name the server.", message: null };
  if (!endpointUrl) return { error: "An endpoint URL is required.", message: null };

  // The declared function name is derived from this, and the API's name
  // grammar is narrow. Rejecting here beats a tool that silently never appears.
  if (!/^[a-zA-Z0-9_]+$/.test(serverName)) {
    return {
      error: "Server name may contain only letters, numbers and underscores.",
      message: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    return { error: "That is not a valid URL.", message: null };
  }

  const isLocal =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    // The bearer token is sent as a header on every call.
    return {
      error: "Endpoint must use https (localhost excepted for development).",
      message: null,
    };
  }

  const denied = await assertAdmin(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase.from("mcp_servers").insert({
    workspace_id: workspaceId,
    server_name: serverName,
    // The only transport the runtime can call. The enum still allows sse and
    // stdio for servers registered before this was known.
    transport_type: "http_stream",
    endpoint_url: endpointUrl,
    encrypted_auth_metadata: bearerToken ? { bearer_token: bearerToken } : {},
  });

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return {
    error: null,
    message: `Registered ${serverName}. Discover its tools to make them available.`,
  };
}

/**
 * Discovers a server's tools.
 *
 * Runs with the service role because it reads the stored credential, which no
 * client role can select — hence the membership check above rather than relying
 * on RLS.
 */
export async function discoverTools(
  _prev: McpState,
  formData: FormData,
): Promise<McpState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const serverId = String(formData.get("serverId") ?? "");

  if (!serverId) return { error: "No server selected.", message: null };

  const denied = await assertAdmin(workspaceId);
  if (denied) return { error: denied, message: null };

  const result = await syncServerTools(createServiceClient(), {
    workspaceId,
    serverId,
  });

  if (result.error) return { error: result.error, message: null };

  revalidatePath("/dashboard");
  return {
    error: null,
    message:
      `Discovered ${result.discovered} tool${result.discovered === 1 ? "" : "s"}. ` +
      "New tools require approval until you say otherwise.",
  };
}

export async function updateToolPolicy(
  _prev: McpState,
  formData: FormData,
): Promise<McpState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const toolId = String(formData.get("toolId") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "") === "true";

  const columns: Record<string, string> = {
    enabled: "is_enabled",
    approval: "requires_approval",
    readOnly: "is_read_only",
  };

  const column = columns[field];
  if (!toolId || !column) {
    return { error: "Unknown setting.", message: null };
  }

  const denied = await assertAdmin(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("mcp_tools")
    .update({ [column]: value })
    .eq("id", toolId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: null };
}

export async function setServerActive(
  _prev: McpState,
  formData: FormData,
): Promise<McpState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const serverId = String(formData.get("serverId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";

  if (!serverId) return { error: "No server selected.", message: null };

  const denied = await assertAdmin(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("mcp_servers")
    .update({ is_active: isActive })
    .eq("id", serverId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return {
    error: null,
    message: isActive
      ? "Server enabled."
      : "Server disabled. Its tools are no longer offered to agents.",
  };
}

export async function removeMcpServer(
  _prev: McpState,
  formData: FormData,
): Promise<McpState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const serverId = String(formData.get("serverId") ?? "");

  if (!serverId) return { error: "No server selected.", message: null };

  const denied = await assertAdmin(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  // Tools cascade with the server.
  const { error } = await supabase
    .from("mcp_servers")
    .delete()
    .eq("id", serverId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: "Server removed." };
}
