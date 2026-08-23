import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

import { embedText } from "./embeddings";

type Db = ReturnType<typeof createServiceClient>;

/** Cosine similarity above which a cached response is reused verbatim. */
export const CACHE_SIMILARITY_THRESHOLD = 0.92;

export type CacheHit = {
  id: string;
  responsePayload: Record<string, unknown>;
  modelUsed: string;
  similarity: number;
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
): Promise<CacheHit | null> {
  try {
    const embedding = await embedText(maskedInput);

    const { data, error } = await db.rpc("match_semantic_cache", {
      p_workspace_id: workspaceId,
      p_query_embedding: embedding,
      p_similarity_threshold: CACHE_SIMILARITY_THRESHOLD,
      p_limit: 1,
    });

    if (error || !data || data.length === 0) return null;

    const row = data[0] as {
      id: string;
      response_payload: Record<string, unknown>;
      model_used: string;
      similarity: number;
    };

    await db.rpc("record_cache_hit", { p_cache_id: row.id });

    return {
      id: row.id,
      responsePayload: row.response_payload,
      modelUsed: row.model_used,
      similarity: row.similarity,
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
    ttlHours?: number;
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
      expires_at: expiresAt,
    });
  } catch {
    // Non-fatal for the same reason as lookup.
  }
}
