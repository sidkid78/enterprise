import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { UserRole, WorkspaceSummary } from "@/lib/roles";

export type { UserRole, WorkspaceSummary };

/**
 * Claims for the signed-in user, or null. Uses getClaims() — which verifies the
 * JWT — rather than getSession(), whose user object is unverified.
 */
export async function getUserClaims() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * Every workspace the signed-in user belongs to, with their role in each.
 *
 * Redeems any pending invitations first. The signup trigger covers people who
 * did not have an account yet; this covers everyone who did, which is the
 * ordinary case — an administrator invites a colleague who registered months
 * ago, no row in auth.users changes, and nothing would otherwise ever fire.
 *
 * Done on every load rather than once per session because there is no session
 * hook to hang it on, and getting it wrong is invisible: the invitee sees an
 * empty dashboard and no reason why. It is one indexed delete against a table
 * that is empty in the common case.
 */
export async function getUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();

  const claims = await getUserClaims();
  const userId = claims?.sub;
  if (!userId) return [];

  // A failure here must not cost the user their dashboard — they may already
  // be a member of several workspaces, and an unredeemed invitation is a
  // missing row, not a broken page.
  const { error: redeemError } = await supabase.rpc("redeem_my_invitations");
  if (redeemError) {
    console.error(`Could not redeem invitations: ${redeemError.message}`);
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces!inner(id, name, slug, enterprise_tier, is_active)")
    // Filter by user explicitly. The workspace_members SELECT policy is
    // `is_workspace_member(workspace_id)` — correct, because a member may see
    // the roster — which means RLS alone returns one row per MEMBER, not per
    // membership of the caller. Relying on it here listed a workspace once per
    // colleague and attached whichever member's `role` came back first.
    .eq("user_id", userId)
    .eq("workspaces.is_active", true);

  if (error) {
    throw new Error(`Failed to load workspaces: ${error.message}`);
  }

  type WorkspaceRow = {
    id: string;
    name: string;
    slug: string;
    enterprise_tier: string;
  };

  type Row = {
    role: UserRole;
    // PostgREST embeds a to-one relation as an object, but the generated
    // typings widen it to an array. Accept both and normalize.
    workspaces: WorkspaceRow | WorkspaceRow[] | null;
  };

  return ((data ?? []) as unknown as Row[]).flatMap((row) => {
    const workspace = Array.isArray(row.workspaces)
      ? row.workspaces[0]
      : row.workspaces;

    // A membership whose workspace was filtered out by the is_active join
    // yields no row rather than a card with undefined fields.
    if (!workspace) return [];

    return [
      {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        enterpriseTier: workspace.enterprise_tier,
        role: row.role,
      },
    ];
  });
}

/**
 * Resolves the workspace a dashboard request should render.
 *
 * `requested` comes from a query param, so it is never trusted directly — it is
 * only honoured if it appears in the caller's own membership list. Falls back
 * to the first workspace otherwise.
 *
 * Redirects to /login when unauthenticated and to /onboarding when the user has
 * no workspace at all, so callers can treat the result as always present.
 */
export async function resolveActiveWorkspace(requested?: string): Promise<{
  active: WorkspaceSummary;
  all: WorkspaceSummary[];
}> {
  const claims = await getUserClaims();
  if (!claims) {
    redirect("/login");
  }

  const all = await getUserWorkspaces();
  if (all.length === 0) {
    redirect("/onboarding");
  }

  const active = all.find((w) => w.id === requested) ?? all[0];
  return { active, all };
}

