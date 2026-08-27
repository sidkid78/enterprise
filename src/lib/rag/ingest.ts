import "server-only";

import { embedBatch } from "@/lib/genai/embeddings";
import { maskPii } from "@/lib/governance/pii";
import { createServiceClient } from "@/lib/supabase/service";

import { chunkDocument } from "./chunk";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Embeddings are sent to the model provider one batch at a time. Kept modest so
 * a large document does not build a single request big enough to be rejected.
 */
const EMBED_BATCH_SIZE = 32;

export type IngestResult = {
  parentId: string;
  chunkCount: number;
  piiMasked: number;
};

/**
 * Ingests one document into a knowledge base.
 *
 * The caller MUST have verified the user's membership of the workspace first:
 * this writes with the service role and has no RLS backstop, exactly like
 * launchGraph.
 *
 * Two boundaries worth knowing:
 *
 * - `full_content` is stored raw. It is our own RLS-protected database, and a
 *   reviewer needs to see the source as it actually reads. Same reasoning as
 *   `agent_graph_executions.root_prompt`.
 * - Chunks are masked BEFORE embedding, because embedding is a call to the
 *   model provider and is retained server-side. So the retrievable copy of a
 *   document never carries raw PII even though the source does.
 */
export async function ingestDocument(params: {
  workspaceId: string;
  knowledgeBaseId: string;
  title: string;
  content: string;
  sourceUri?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<IngestResult> {
  const db: Db = createServiceClient();

  const chunks = chunkDocument(params.content);
  if (chunks.length === 0) {
    throw new Error("Document produced no chunks — is it empty?");
  }

  // Verify the knowledge base belongs to this workspace before writing rows
  // that reference both. Without it a caller could file a document into
  // another tenant's knowledge base by id.
  const { data: kb, error: kbError } = await db
    .from("knowledge_bases")
    .select("id")
    .eq("id", params.knowledgeBaseId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (kbError) throw new Error(`Knowledge base lookup failed: ${kbError.message}`);
  if (!kb) throw new Error("Knowledge base not found in this workspace.");

  const { data: parent, error: parentError } = await db
    .from("document_parents")
    .insert({
      workspace_id: params.workspaceId,
      knowledge_base_id: params.knowledgeBaseId,
      document_title: params.title,
      source_uri: params.sourceUri ?? null,
      full_content: params.content,
      metadata: {
        ...(params.metadata ?? {}),
        // Recorded here so a document list can show size without selecting
        // every document's full body.
        character_count: params.content.length,
      },
    })
    .select("id")
    .single();

  if (parentError || !parent) {
    throw new Error(`Could not store document: ${parentError?.message}`);
  }

  let piiMasked = 0;
  const maskedChunks = chunks.map((chunk) => {
    const { masked, matches } = maskPii(chunk.content);
    piiMasked += matches.length;

    // What gets EMBEDDED is not what gets STORED.
    //
    // `ai_docs` (Drive) -> Advanced Hybrid Rag -> Parent-Child Late Chunking
    // asks that "every child chunk's semantic signature retains a
    // representation of the global document's overall meaning". True late
    // chunking does that by pooling token-level vectors across the whole
    // parent — and the Gemini embeddings API does not expose token-level
    // vectors. `embedContent` returns one pooled vector per input, with
    // `outputDimensionality` the only shaping knob, so the technique as
    // written is not implementable on this provider.
    //
    // What IS achievable is the same goal by a different route: give the
    // embedding the chunk's place in the document. A paragraph reading "the
    // limit is 30 days" embeds near nothing useful; the same paragraph under
    // "Acme MSA > Termination" embeds near questions about Acme's notice
    // period. The context comes from the document itself — title and heading
    // trail — so it is not a guess and costs no model call.
    //
    // The prefix is masked along with the body: a document title is as capable
    // of carrying a customer name as a paragraph is.
    const context = [params.title, ...chunk.headings].filter(Boolean).join(" > ");
    const { masked: maskedContext } = maskPii(context);

    return {
      ...chunk,
      content: masked,
      embedText: maskedContext ? `${maskedContext}\n\n${masked}` : masked,
    };
  });

  try {
    for (let start = 0; start < maskedChunks.length; start += EMBED_BATCH_SIZE) {
      const batch = maskedChunks.slice(start, start + EMBED_BATCH_SIZE);
      const vectors = await embedBatch(
        batch.map((chunk) => chunk.embedText),
        "RETRIEVAL_DOCUMENT",
      );

      const { error: chunkError } = await db.from("document_chunks").insert(
        batch.map((chunk, offset) => ({
          workspace_id: params.workspaceId,
          knowledge_base_id: params.knowledgeBaseId,
          parent_id: parent.id,
          chunk_index: chunk.index,
          // Stored WITHOUT the context prefix, deliberately.
          //
          // `fts_tokens` is generated from this column, and repeating the
          // title in every chunk would inflate its term frequency across the
          // whole document — the sparse arm would then rank every chunk of a
          // document equally for a title word, which is the opposite of what
          // BM25 is for. The dense arm gets the context, the sparse arm gets
          // the text; each is fed what it can actually use.
          //
          // It is also what a reviewer reads back, and a stored chunk that
          // silently carries a prefix nobody wrote reads as corrupted source.
          chunk_content: chunk.content,
          embedding: JSON.stringify(vectors[offset]),
          metadata: {
            title: params.title,
            // Kept so retrieval can show where a passage came from, and so the
            // embedding's context is inspectable rather than implied.
            headings: chunk.headings,
          },
        })),
      );

      if (chunkError) throw new Error(chunkError.message);
    }
  } catch (err) {
    // A parent with no chunks is invisible to search but still counts against
    // the tenant's storage and shows up in listings — worse than no document.
    // The chunk rows cascade with it.
    await db.from("document_parents").delete().eq("id", parent.id);
    throw new Error(
      `Ingestion failed, document rolled back: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  return {
    parentId: parent.id,
    chunkCount: maskedChunks.length,
    piiMasked,
  };
}
