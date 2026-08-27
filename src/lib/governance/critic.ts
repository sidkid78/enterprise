import "server-only";

import {
  MODEL_TIERS,
  estimateCostUsd,
  getGenAI,
  normalizeUsage,
  withModelTimeout,
} from "@/lib/genai/client";

/**
 * Gate 3 — critic review of a worker's output.
 *
 * A second model checks whether the output asserts customer-specific facts it
 * had no way to know. Runs on the cheap tier: a critic that costs as much as
 * the worker doubles the bill for every node.
 *
 * The critic can only ever escalate to a human — it never approves anything the
 * worker did not already produce, so a compromised critic cannot widen access.
 */

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    grounded: {
      type: "boolean",
      description:
        "True if no claim about the customer goes beyond the provided context.",
    },
    risk_score: {
      type: "number",
      description: "0-1 risk that this output is wrong, fabricated, or unsafe to commit.",
    },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["grounded", "risk_score"],
};

export type CriticVerdict = {
  grounded: boolean;
  riskScore: number;
  concerns: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** True when the critic itself failed; treated as "cannot vouch". */
  degraded: boolean;
};

/** Above this the node is escalated to a human regardless of worker confidence. */
export const CRITIC_RISK_THRESHOLD = 0.6;

export async function reviewOutput(params: {
  objective: string;
  context: string;
  output: unknown;
  /**
   * Whether a knowledge base was searched for this step.
   *
   * Hard-wired false until Pillar 5 (hybrid RAG) exists. It matters because a
   * critic told to verify every claim against context, when the context is
   * always empty, flags every substantive output — which is what happened once
   * workers started returning real content. With no retrieval the gate can
   * only catch fabricated CUSTOMER facts, not unsupported general claims. That
   * is a genuinely narrower gate, and it widens again the moment retrieval
   * lands and this flag turns true.
   */
  retrievalAvailable: boolean;
}): Promise<CriticVerdict> {
  const client = getGenAI();
  const model = MODEL_TIERS.cheap;

  try {
    const interaction = await withModelTimeout(
      client.interactions.create({
        model,
        // Deliberately NOT chained to the worker's interaction: an independent
        // context is the point. Inheriting the worker's turn would let the
        // reasoning that produced a bad output also justify it.
        input: [
        `Objective given to the worker:\n${params.objective}`,
        `Context available to it:\n${params.context || "(none)"}`,
        params.retrievalAvailable
          ? "A knowledge base was searched for this step, so the context above is the full set of customer facts the worker had."
          : "No knowledge base was searched for this step. The worker had no customer records available and was asked to work from general professional practice.",
        `Output it produced:\n${JSON.stringify(params.output).slice(0, 4000)}`,
        "Does this output assert anything about the customer that it could not know?",
        ].join("\n\n"),
        system_instruction:
        "You are a critic in an enterprise governance pipeline. Judge two kinds of claim differently.\n\n" +
        "Claims about THIS customer — their data, systems, records, accounts, people, or figures — must trace to the supplied context. Anything specific that is not there is fabricated: flag it and score it high.\n\n" +
        "General professional knowledge — standard methodology, framework structure, industry-typical ranges, well-known practice — is what the worker is expected to supply from expertise. Do not flag it merely for being absent from the context.\n\n" +
        "Risk score is the chance that acting on this output would mislead. An output built entirely from general practice, asserting nothing about the customer's actual data, is low risk even when the context is empty.\n\n" +
        "Be strict about the first kind: escalating a correct answer is cheap, approving a fabricated customer fact is not.",
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: CRITIC_SCHEMA,
        },
        }),
      "critic review",
    );

    const usage = normalizeUsage(interaction.usage);
    const costUsd = estimateCostUsd(model, usage.inputTokens, usage.outputTokens);

    let parsed: { grounded?: boolean; risk_score?: number; concerns?: string[] } | null =
      null;
    try {
      parsed = JSON.parse(interaction.output_text ?? "");
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return {
        grounded: false,
        riskScore: 1,
        concerns: ["Critic returned unparseable output."],
        costUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        degraded: true,
      };
    }

    return {
      grounded: parsed.grounded === true,
      riskScore:
        typeof parsed.risk_score === "number"
          ? Math.min(1, Math.max(0, parsed.risk_score))
          : 1,
      concerns: Array.isArray(parsed.concerns)
        ? parsed.concerns.filter((c): c is string => typeof c === "string")
        : [],
      costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      degraded: false,
    };
  } catch (err) {
    // Fail closed. If the critic cannot run, the output has not been vouched
    // for, so it routes to a human rather than committing unreviewed.
    return {
      grounded: false,
      riskScore: 1,
      concerns: [
        `Critic unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
      ],
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      degraded: true,
    };
  }
}
