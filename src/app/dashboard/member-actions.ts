"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { ROLE_POWER, type UserRole } from "@/lib/roles";

export type MemberState = { error: string | null; message: string | null };

function isRole(value: string): value is UserRole {
  return value in ROLE_POWER;
}

/**
 * An address, normalized the one way everything else compares them.
 *
 * The table carries a CHECK that email = lower(email), so this is not merely
 * tidiness — an unnormalized insert is rejected outright rather than creating
 * an invitation that redemption would never match.
 */
function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  // Deliberately minimal. Address syntax is famously not a regex, and the only
  // thing that actually validates one here is a person confirming it on an
  // account — a stricter pattern would reject valid addresses to no benefit.
  if (!email || !email.includes("@") || email.length > 320) return null;
  return email;
}

/**
 * Invites someone to the workspace by address.
 *
 * Authorization is NOT re-implemented here. This uses the user-scoped client,
 * so the `workspace_invitations_insert` policy decides — including its rule
 * that the caller must be at least as powerful as the role being granted. A
 * caller who fails it gets a policy error rather than a silent no-op.
 *
 * Nothing looks the invitee up. The platform never learns whether the address
 * belongs to an existing account, which is the entire reason this is an
 * invitation rather than a user search.
 */
export async function inviteMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const rawEmail = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!workspaceId) return { error: "No workspace selected.", message: null };

  const email = normalizeEmail(rawEmail);
  if (!email) return { error: "Enter a valid email address.", message: null };

  if (!isRole(role)) return { error: "Pick a role.", message: null };

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Not signed in.", message: null };

  // Upsert on (workspace_id, email): re-inviting is how an administrator
  // refreshes an invitation that expired, and making them delete the old row
  // first would turn an ordinary act into a two-step puzzle. The role and the
  // expiry are both reset, so the newest invitation is the one that counts.
  const { error } = await supabase
    .from("workspace_invitations")
    .upsert(
      {
        workspace_id: workspaceId,
        email,
        invited_by: userId,
        invited_role: role,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "workspace_id,email" },
    );

  if (error) {
    // The policy's two clauses fail identically at the wire, so the message
    // names both possibilities rather than guessing which one it was.
    return {
      error: `Could not invite ${email}: ${error.message}`,
      message: null,
    };
  }

  revalidatePath("/dashboard");
  return {
    error: null,
    message: `Invited ${email} as ${role}. They join when they sign in with that address.`,
  };
}

/** Withdraws an invitation that has not been redeemed. */
export async function revokeInvitation(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const invitationId = String(formData.get("invitationId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");

  if (!invitationId || !workspaceId) {
    return { error: "Nothing to revoke.", message: null };
  }

  const supabase = await createClient();

  // Scoped by workspace as well as by id. The delete policy would refuse a
  // foreign row anyway, but a client-supplied id is never trusted to name the
  // workspace it belongs to — the same contract as requeueJob.
  const { data, error } = await supabase
    .from("workspace_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("workspace_id", workspaceId)
    .select("email");

  if (error) return { error: error.message, message: null };

  if (!data || data.length === 0) {
    return {
      error: "Invitation not found, or your role does not permit revoking it.",
      message: null,
    };
  }

  revalidatePath("/dashboard");
  return {
    error: null,
    message: `Revoked the invitation for ${(data[0] as { email: string }).email}.`,
  };
}

/**
 * Changes an existing member's role.
 *
 * Guarded against the two ways this becomes privilege escalation. The first —
 * granting a rank above your own — is checked here because the
 * `workspace_members` UPDATE policy predates the power matrix and tests only
 * that the caller is an owner or administrator; without this an administrator
 * could promote someone to owner and be outranked by their own edit.
 *
 * The second is demoting somebody above you, which is how an administrator
 * would remove an owner's ability to undo the change. Both are refused.
 */
export async function setMemberRole(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const targetUserId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!workspaceId || !targetUserId) {
    return { error: "Nothing to change.", message: null };
  }
  if (!isRole(role)) return { error: "Pick a role.", message: null };

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Not signed in.", message: null };

  const { data: rows, error: readError } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("user_id", [userId, targetUserId]);

  if (readError) return { error: readError.message, message: null };

  type Row = { user_id: string; role: UserRole };
  const members = (rows ?? []) as Row[];
  const mine = members.find((m) => m.user_id === userId);
  const theirs = members.find((m) => m.user_id === targetUserId);

  if (!mine) {
    return { error: "You are not a member of this workspace.", message: null };
  }
  if (!theirs) {
    return { error: "That person is not a member.", message: null };
  }

  const myPower = ROLE_POWER[mine.role];

  if (ROLE_POWER[role] > myPower) {
    return {
      error: `You cannot grant ${role} — it outranks your own ${mine.role}.`,
      message: null,
    };
  }

  if (ROLE_POWER[theirs.role] > myPower) {
    return {
      error: `You cannot change a ${theirs.role}, which outranks your ${mine.role}.`,
      message: null,
    };
  }

  // The last owner must not be demoted. A workspace with no owner has nobody
  // who can appoint one, and there is no self-service path back — it is the
  // one edit here that cannot be undone from inside the product.
  if (theirs.role === "workspace_owner" && role !== "workspace_owner") {
    const { count } = await supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("role", "workspace_owner");

    if ((count ?? 0) <= 1) {
      return {
        error: "This is the workspace's only owner. Appoint another first.",
        message: null,
      };
    }
  }

  const { error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: `Role updated to ${role}.` };
}
