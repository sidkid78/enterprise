"use server";

import { revalidatePath } from "next/cache";

import { launchGraph } from "@/lib/genai/orchestrator";
import { createClient } from "@/lib/supabase/server";

export type LaunchState = { error: string | null; message: string | null };

/**
 * Starts an agent run.
 *
 * Membership is verified here with the user-scoped client BEFORE handing off to
 * the orchestrator, which writes with the service role and has no RLS backstop.
 * Trusting the submitted workspaceId would let any signed-in user spend another
 * tenant's budget.
 */
export async function launchRun(
  _prev: LaunchState,
  formData: FormData,
): Promise<LaunchState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const rootPrompt = String(formData.get("rootPrompt") ?? "").trim();

  if (!workspaceId || !rootPrompt) {
    return { error: "Describe the task to run.", message: null };
  }

  if (rootPrompt.length > 2000) {
    return { error: "Task description is too long (2000 char max).", message: null };
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return { error: "Not signed in.", message: null };
  }

  // Filter by user_id explicitly rather than leaning on RLS. The
  // workspace_members SELECT policy is `is_workspace_member(workspace_id)`, so
  // it returns a row per MEMBER of the workspace — in a workspace with two
  // members maybeSingle() then failed and told an actual member "you are not a
  // member of this workspace".
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { error: "You are not a member of this workspace.", message: null };
  }

  const allowed = ["workspace_owner", "ai_administrator", "agent_operator"];
  if (!allowed.includes(membership.role as string)) {
    return {
      error: "Your role cannot launch agent runs.",
      message: null,
    };
  }

  try {
    const result = await launchGraph({
      workspaceId,
      rootPrompt,
      userId: userId as string,
    });
    revalidatePath("/dashboard");
    return { error: null, message: result.message };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Run failed to start.",
      message: null,
    };
  }
}
