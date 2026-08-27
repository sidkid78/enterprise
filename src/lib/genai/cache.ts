import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

import { embedText } from "./embeddings";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Cosine similarity above which a cached response is reused verbatim.
 *
 * 0.97, not the blueprint's 0.92: at 0.92 sibling nodes within one run matched
 * each other and the cache served one node's output for four distinct steps.
 * For agent steps a wrong hit silently fabricates work, so only near-identical
 * inputs qualify.
 */
export const CACHE_SIMILARITY_THRESHOLD = 0.97;

export type CacheHit = {
  id: string;
  responsePayload: Record<string, unknown>;
  modelUsed: string;
  similarity: number;
  /**
   * What producing this answer actually cost, on the miss that created it.
   *
   * Null for entries written before the column existed. That is deliberately
   * not zero: "we never recorded it" and "it was free" are different claims,
   * and only the second would justify reporting a saving of $0.00.
   */
  producedCostUsd: number | null;
  producedTokens: number | null;
};

/**
 * Looks for a semantically equivalent prior call in this workspace.
 *
 * Scoped to one workspace by the RPC's WHERE clause — a cross-tenant cache hit
 * would leak one customer's model output to another, which is why this never
 * runs against a shared pool.
 *
 * IMPORTANT: only call this with text that has already passed PII masking. The
 * cache stores `query_text` verbatim, so an unmasked lookup would persist raw
 * PII into a table that exists to be read back later.
 */
export async function lookupCache(
  db: Db,
  workspaceId: string,
  maskedInput: string,
  /** The running graph. Its own entries are never served back to it. */
  excludeGraphId?: string,
): Promise<CacheHit | null> {
  try {
    const embedding = await embedText(maskedInput);

    const { data, error } = await db.rpc("match_semantic_cache", {
      p_workspace_id: workspaceId,
      p_query_embedding: embedding,
      p_similarity_threshold: CACHE_SIMILARITY_THRESHOLD,
      p_limit: 1,
      p_exclude_graph_id: excludeGraphId ?? null,
    });

    if (error || !data || data.length === 0) return null;

    const row = data[0] as {
      id: string;
      response_payload: Record<string, unknown>;
      model_used: string;
      similarity: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      cost_usd: number | string | null;
    };

    await db.rpc("record_cache_hit", { p_cache_id: row.id });

    const tokens =
      row.prompt_tokens === null && row.completion_tokens === null
        ? null
        : (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0);

    return {
      id: row.id,
      responsePayload: row.response_payload,
      modelUsed: row.model_used,
      similarity: row.similarity,
      producedCostUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      producedTokens: tokens,
    };
  } catch {
    // A cache failure must never fail the run — worst case is a cache miss and
    // a normal model call.
    return null;
  }
}

/**
 * Stores a successful response for reuse.
 *
 * Only ever called with masked input. Entries expire so that stale answers to
 * questions about changing data do not persist indefinitely.
 */
export async function storeCache(
  db: Db,
  params: {
    workspaceId: string;
    maskedInput: string;
    responsePayload: Record<string, unknown>;
    modelUsed: string;
    graphExecutionId: string;
    ttlHours?: number;
    /**
     * What this call cost. Recorded so a later hit can report a MEASURED
     * saving rather than a counterfactual — see migration ...27.
     */
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
  },
): Promise<void> {
  try {
    const embedding = await embedText(params.maskedInput);
    const expiresAt = new Date(
      Date.now() + (params.ttlHours ?? 24) * 60 * 60 * 1000,
    ).toISOString();

    await db.from("semantic_cache").insert({
      workspace_id: params.workspaceId,
      query_text: params.maskedInput,
      query_embedding: embedding,
      response_payload: params.responsePayload,
      model_used: params.modelUsed,
      graph_execution_id: params.graphExecutionId,
      expires_at: expiresAt,
      prompt_tokens: params.promptTokens ?? null,
      completion_tokens: params.completionTokens ?? null,
      cost_usd: params.costUsd ?? null,
    });
  } catch {
    // Non-fatal for the same reason as lookup.
  }
}
