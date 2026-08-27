import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Service-role client. **Bypasses RLS entirely.**
 *
 * Only the agent runtime uses this — it writes the tables that carry no client
 * INSERT policy (`agent_node_executions`, `agent_audit_ledger`,
 * `finops_token_logs`, `semantic_cache`) and raises HITL gates.
 *
 * Never import this from a Client Component, and never derive a response for a
 * user from it without first checking that user's workspace membership
 * yourself — there is no RLS backstop here.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required for agent runtime writes.",
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
