import "server-only";

import { EMBEDDING_MODEL, getGenAI } from "./client";

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
 * Embeds text for the semantic cache, returning a unit-length 768-dim vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const client = getGenAI();

  const response = await client.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: "SEMANTIC_SIMILARITY",
    },
  });

  const values = response.embeddings?.[0]?.values;

  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected a ${EMBEDDING_DIMENSIONS}-dim embedding, got ${values?.length ?? "none"}.`,
    );
  }

  return l2Normalize(values);
}
