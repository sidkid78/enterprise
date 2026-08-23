import "server-only";

import { GoogleGenAI } from "@google/genai";

/**
 * Gemini client. Requires GEMINI_API_KEY — server-side only, never exposed to
 * the browser.
 */
export function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set; the agent runtime cannot run.");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * The FinOps model cascade. Tiers are chosen per DAG node by the decomposition
 * step: cheap for routing/extraction, default for ordinary agent work,
 * reasoning only for genuinely hard analysis.
 */
export const MODEL_TIERS = {
  cheap: "gemini-3.5-flash-lite",
  default: "gemini-3.7-flash",
  reasoning: "gemini-3.1-pro-preview",
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

export const ROUTING_TIER_LABEL: Record<ModelTier, string> = {
  cheap: "model_cascade_cheap",
  default: "model_cascade_default",
  reasoning: "frontier_model",
};

export function isModelTier(value: string): value is ModelTier {
  return value in MODEL_TIERS;
}

/**
 * USD per 1M tokens, from ai.google.dev/gemini-api/docs/pricing (paid tier).
 *
 * Two wrinkles are modelled rather than flattened, because both would silently
 * skew the ROI dashboard:
 *   - gemini-3.7-flash doubles on 2027-01-01.
 *   - gemini-3.1-pro-preview costs more once the prompt exceeds 200k tokens.
 */
export const EMBEDDING_MODEL = "gemini-embedding-001";

const FLASH_PRICE_CHANGE = Date.parse("2027-01-01T00:00:00Z");
const PRO_CONTEXT_TIER_TOKENS = 200_000;

type Rate = { input: number; output: number };

function ratesFor(model: string, inputTokens: number, at: number): Rate {
  switch (model) {
    case MODEL_TIERS.cheap:
      return { input: 0.3, output: 2.5 };
    case MODEL_TIERS.default:
      return at >= FLASH_PRICE_CHANGE
        ? { input: 1.5, output: 7.5 }
        : { input: 0.75, output: 3.75 };
    case MODEL_TIERS.reasoning:
      return inputTokens > PRO_CONTEXT_TIER_TOKENS
        ? { input: 4.0, output: 18.0 }
        : { input: 2.0, output: 12.0 };
    case EMBEDDING_MODEL:
      return { input: 0.15, output: 0 };
    default:
      // Unknown model: cost 0 rather than a guess. A zero in the ledger is
      // visibly wrong; an invented rate is not.
      return { input: 0, output: 0 };
  }
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  at: number = Date.now(),
): number {
  const rate = ratesFor(model, inputTokens, at);
  return (
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output
  );
}

/**
 * Token counts as the Interactions API actually reports them.
 *
 * The response exposes `total_input_tokens` / `total_output_tokens`, NOT the
 * `prompt_tokens` / `completion_tokens` naming used by the older API — reading
 * the wrong field yields a silent zero, so this normalizes in one place.
 */
export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtTokens: number;
  totalTokens: number;
};

export function normalizeUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  return {
    inputTokens: num(u.total_input_tokens),
    outputTokens: num(u.total_output_tokens),
    cachedTokens: num(u.total_cached_tokens),
    thoughtTokens: num(u.total_thought_tokens),
    totalTokens: num(u.total_tokens),
  };
}
