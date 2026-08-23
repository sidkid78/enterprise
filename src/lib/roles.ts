/**
 * Role types and pure predicates, safe to import from Client Components.
 *
 * Kept separate from `lib/data/workspaces.ts` because that module is
 * `server-only` — importing it from the browser bundle is a build error, which
 * is how this file came to exist.
 */
export type UserRole =
  | "workspace_owner"
  | "ai_administrator"
  | "compliance_auditor"
  | "agent_operator"
  | "business_user";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  enterpriseTier: string;
  role: UserRole;
};

const MANAGER_ROLES: UserRole[] = ["workspace_owner", "ai_administrator"];

/**
 * Mirrors the `hitl_resolve` RLS policy. This is a UI affordance only — the
 * database is the authority, and a client that ignores this still fails the
 * policy check.
 */
export function canResolveGates(role: UserRole, requiredRole: UserRole) {
  return MANAGER_ROLES.includes(role) || role === requiredRole;
}
