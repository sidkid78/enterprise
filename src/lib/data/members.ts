import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";

export type Member = {
  userId: string;
  role: UserRole;
  joinedAt: string;
  /**
   * Null whenever the viewer may not read the address.
   *
   * `authenticated` cannot select from auth.users, so a member's email is only
   * available where the platform already holds it — the invitation that
   * created them. For a founder-created workspace there is no invitation and
   * this is simply unknown, which is a truer thing to render than a blank
   * pretending to be an empty address.
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
    email: null,
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
