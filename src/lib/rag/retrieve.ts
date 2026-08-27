import "server-only";

import { embedText } from "@/lib/genai/embeddings";
import { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

export type RetrievedChunk = {
  chunkId: string;
  parentId: string;
  chunkContent: string;
  parentFullContent: string;
  documentTitle: string;
  sourceUri: string | null;
  score: number;
};

export type RetrievalResult = {
  chunks: RetrievedChunk[];
  /** Rendered for the worker prompt, deduplicated by parent document. */
  context: string;
  /** Distinct documents cited, for the audit trail and the UI. */
  sources: { parentId: string; title: string; sourceUri: string | null }[];
};

const EMPTY: RetrievalResult = { chunks: [], context: "", sources: [] };

/**
 * Ceiling on how much retrieved text is pasted into a worker prompt.
 *
 * Parent documents are returned whole, so three long ones can dwarf the
 * objective they were fetched for and push the model's attention off the actual
 * task. Truncating is better than dropping a document outright — the top of a
 * document is usually where it says what it is.
 */
const MAX_CONTEXT_CHARS = 12_000;

/** How many parent documents can be quoted into one prompt. */
const MAX_SOURCES = 3;

/**
 * Retrieves grounding context for one agent step.
 *
 * Never throws. Retrieval failing is a degraded answer, not a failed run — and
 * the critic is told whether retrieval actually happened, so a silent empty
 * result cannot be mistaken for "the knowledge base says nothing relevant".
 * The caller MUST have verified workspace membership: this reads with the
 * service role.
 */
export async function retrieveContext(params: {
  workspaceId: string;
  query: string;
  knowledgeBaseId?: string | null;
  matchCount?: number;
}): Promise<RetrievalResult> {
  const query = params.query.trim();
  if (!query) return EMPTY;

  const db: Db = createServiceClient();

  try {
    // RETRIEVAL_QUERY, not SEMANTIC_SIMILARITY: the corpus was embedded as
    // RETRIEVAL_DOCUMENT and the pair is asymmetric by design.
    const embedding = await embedText(query, "RETRIEVAL_QUERY");

    const { data, error } = await db.rpc("hybrid_search_knowledge_chunks", {
      p_workspace_id: params.workspaceId,
      p_query_text: query,
      p_query_embedding: JSON.stringify(embedding),
      p_knowledge_base_id: params.knowledgeBaseId ?? null,
      p_match_count: params.matchCount ?? 5,
    });

    if (error) return EMPTY;

    type Row = {
      chunk_id: string;
      parent_id: string;
      chunk_content: string;
      parent_full_content: string;
      document_title: string;
      source_uri: string | null;
      combined_score: number;
    };

    const chunks: RetrievedChunk[] = ((data ?? []) as Row[]).map((row) => ({
      chunkId: row.chunk_id,
      parentId: row.parent_id,
      chunkContent: row.chunk_content,
      parentFullContent: row.parent_full_content,
      documentTitle: row.document_title,
      sourceUri: row.source_uri,
      score: Number(row.combined_score ?? 0),
    }));

    if (chunks.length === 0) return EMPTY;

    return { chunks, ...renderContext(chunks) };
  } catch {
    return EMPTY;
  }
}

/**
 * Renders retrieved chunks as prompt context.
 *
 * Several chunks routinely come from one document; quoting the parent once per
 * chunk would spend the budget repeating the same text. Documents are emitted
 * whole, in the rank order of their best chunk — the parent/child point is that
 * the chunk decides relevance and the parent supplies the context.
 */
function renderContext(
  chunks: RetrievedChunk[],
): Pick<RetrievalResult, "context" | "sources"> {
  const seen = new Set<string>();
  const sources: RetrievalResult["sources"] = [];
  const blocks: string[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const chunk of chunks) {
    if (seen.has(chunk.parentId) || sources.length >= MAX_SOURCES) continue;
    seen.add(chunk.parentId);

    const body = chunk.parentFullContent.slice(0, Math.max(budget, 0));
    if (!body) break;
    budget -= body.length;

    const truncated = body.length < chunk.parentFullContent.length;
    blocks.push(
      `--- ${chunk.documentTitle}${chunk.sourceUri ? ` (${chunk.sourceUri})` : ""} ---\n${body}${truncated ? "\n[…truncated]" : ""}`,
    );
    sources.push({
      parentId: chunk.parentId,
      title: chunk.documentTitle,
      sourceUri: chunk.sourceUri,
    });
  }

  return { context: blocks.join("\n\n"), sources };
}
