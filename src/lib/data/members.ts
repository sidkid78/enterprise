import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";

export type Member = {
  userId: string;
  role: UserRole;
  joinedAt: string;
  /**
   * Null only when the directory lookup was refused or the account is gone.
   *
   * `authenticated` cannot select from auth.users directly; this comes from
   * `workspace_member_directory`, a DEFINER RPC that checks membership
   * internally (migration `…28`). Before it existed the roster rendered raw
   * uuids, which is not an identity anyone can act on.
   */
  email: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  invitedRole: UserRole;
  expiresAt: string;
  createdAt: string;
  /** Derived at read time rather than stored — nothing writes "I expired". */
  expired: boolean;
};

/**
 * The workspace roster.
 *
 * Every member may read it: knowing who can act in a workspace, and at what
 * rank, is not privileged information within that workspace — the same
 * reasoning that makes the MCP tool registry readable by everyone while only
 * managers may change it.
 */
export async function getMembers(workspaceId: string): Promise<Member[]> {
  const supabase = await createClient();
  const directory = await getMemberDirectory(workspaceId);

  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load members: ${error.message}`);
  }

  type Row = { user_id: string; role: UserRole; created_at: string };

  return ((data ?? []) as Row[]).map((row) => ({
    userId: row.user_id,
    role: row.role,
    joinedAt: row.created_at,
    email: directory.get(row.user_id) ?? null,
  }));
}

/**
 * Outstanding invitations, expired ones included.
 *
 * An expired invitation is kept and shown rather than swept away, because the
 * administrator's next question is "did I ever invite them?" and a table that
 * silently forgets cannot answer it. Only redeemed rows are deleted.
 *
 * Returns an empty list rather than throwing when RLS refuses: the policy
 * admits only `ai_administrator` and above, so an ordinary member reading the
 * roster page gets no rows, which is the correct answer and not an error.
 */
export async function getInvitations(
  workspaceId: string,
): Promise<Invitation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("id, email, invited_role, expires_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return [];

  type Row = {
    id: string;
    email: string;
    invited_role: UserRole;
    expires_at: string;
    created_at: string;
  };

  const now = Date.now();

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    email: row.email,
    invitedRole: row.invited_role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    expired: new Date(row.expires_at).getTime() <= now,
  }));
}

/**
 * user_id → email for the people in a workspace.
 *
 * `authenticated` cannot read `auth.users`, so this goes through a
 * SECURITY DEFINER RPC that checks membership internally (migration `…28`).
 * It is not the email-existence oracle invitations were built to avoid: that
 * would answer "does an account exist for this address?" for any address a
 * caller invents, whereas this names people already on a roster the caller can
 * enumerate. It adds no membership information, only the name on a visible row.
 *
 * Returns an empty map rather than throwing. A decision log that renders
 * "approved by c91ea881" is degraded; one that fails to render is worse.
 */
export async function getMemberDirectory(
  workspaceId: string,
): Promise<Map<string, string>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("workspace_member_directory", {
    p_workspace_id: workspaceId,
  });

  if (error) return new Map();

  return new Map(
    ((data ?? []) as { user_id: string; email: string }[]).map((row) => [
      row.user_id,
      row.email,
    ]),
  );
}
