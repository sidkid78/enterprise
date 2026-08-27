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

/**
 * The role hierarchy, from `ai_docs` (Drive) -> Stateful HITL Gates ->
 * Role-based access-control.
 *
 * A gate names the role needed to clear it, and anyone at or above that level
 * may act. This replaced a flat "manager roles, or an exact match on
 * required_role" test, which is not a hierarchy but five unrelated keys: owner
 * and administrator happened to come out right by sitting above everything,
 * while a compliance_auditor could not clear an agent_operator gate — the role
 * whose whole job is auditing policy violations, unable to act on the ordinary
 * ones.
 */
export const ROLE_POWER: Record<UserRole, number> = {
  workspace_owner: 5,
  ai_administrator: 4,
  compliance_auditor: 3,
  agent_operator: 2,
  business_user: 1,
};

/**
 * Mirrors the `hitl_resolve` RLS policy. This is a UI affordance only — the
 * database is the authority, and a client that ignores this still fails the
 * policy check. `private.role_power()` is the copy that decides; keep the two
 * in step.
 */
export function canResolveGates(role: UserRole, requiredRole: UserRole) {
  return ROLE_POWER[role] >= ROLE_POWER[requiredRole];
}

/**
 * The roles a given operator may hand a gate up to.
 *
 * Strictly above their own level. Escalation that did not raise the bar would
 * be a no-op dressed as an action, and the database ratchets `required_role`
 * upward anyway — offering a choice the policy will reject is worse than not
 * offering it.
 */
export function escalationTargets(role: UserRole, requiredRole: UserRole) {
  const floor = Math.max(ROLE_POWER[role], ROLE_POWER[requiredRole]);
  return (Object.keys(ROLE_POWER) as UserRole[])
    .filter((r) => ROLE_POWER[r] > floor)
    .sort((a, b) => ROLE_POWER[a] - ROLE_POWER[b]);
}
