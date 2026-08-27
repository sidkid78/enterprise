import "server-only";

import { EMBEDDING_MODEL, getGenAI, withModelTimeout } from "./client";

/**
 * Must match the vector(768) column in semantic_cache. Changing this requires a
 * migration that rewrites the table and its HNSW index.
 *
 * 768 rather than the model's 3072 default because pgvector's HNSW index caps
 * the `vector` type at 2000 dimensions — a vector(3072) column cannot carry the
 * index the cache depends on.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * L2-normalizes in place.
 *
 * gemini-embedding-001 only auto-normalizes its default 3072-dim output. At 768
 * the raw vector is NOT unit length, and pgvector's cosine distance assumes it
 * is — skipping this makes the >0.92 similarity threshold meaningless rather
 * than merely imprecise. This is the single reason the cache can be trusted.
 */
function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const magnitude = Math.sqrt(sumSquares);

  // A zero vector has no direction; normalizing would divide by zero.
  if (magnitude === 0) return vector;

  return vector.map((v) => v / magnitude);
}

/**
 * What the embedding will be used for.
 *
 * `RETRIEVAL_DOCUMENT` and `RETRIEVAL_QUERY` are an asymmetric pair — the model
 * places a passage and a question that passage answers near each other, which
 * is not the same geometry as two texts that merely resemble each other.
 * Embedding a corpus as `SEMANTIC_SIMILARITY` and then querying it measurably
 * degrades recall, so the two RAG paths must each pass their own.
 */
export type EmbeddingTask =
  | "SEMANTIC_SIMILARITY"
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY";

/**
 * Embeds one text, returning a unit-length 768-dim vector.
 *
 * Defaults to `SEMANTIC_SIMILARITY` because the semantic cache compares two
 * prompts to each other, which is symmetric.
 */
export async function embedText(
  text: string,
  task: EmbeddingTask = "SEMANTIC_SIMILARITY",
): Promise<number[]> {
  const [vector] = await embedBatch([text], task);
  return vector;
}

/**
 * Embeds several texts in one call.
 *
 * Ingestion produces many chunks per document; one request per chunk is both
 * slower and far more likely to hit a rate limit than one request carrying the
 * batch.
 */
export async function embedBatch(
  texts: string[],
  task: EmbeddingTask = "SEMANTIC_SIMILARITY",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getGenAI();

  const response = await withModelTimeout(
    client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: task,
      },
    }),
    `embedding ${texts.length} text(s)`,
  );

  const embeddings = response.embeddings ?? [];

  if (embeddings.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} embeddings, got ${embeddings.length}.`,
    );
  }

  return embeddings.map((embedding, index) => {
    const values = embedding.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected a ${EMBEDDING_DIMENSIONS}-dim embedding at index ${index}, got ${values?.length ?? "none"}.`,
      );
    }
    return l2Normalize(values);
  });
}
