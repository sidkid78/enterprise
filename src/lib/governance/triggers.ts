/**
 * Deterministic HITL trigger evaluation.
 *
 * `ai_docs` (Drive) → Stateful HITL Gates → Trigger-Evaluation specifies four
 * triggers with exact numeric boundaries. Only the confidence one existed here;
 * the other three are implemented from that document rather than invented.
 *
 * No `server-only` marker and no imports: this is a pure decision function, so
 * the thresholds a reviewer is judged against can also be displayed in a Client
 * Component without dragging the runtime into the browser bundle. Same split as
 * `lib/rag/chunk` and `lib/queue/job-view`.
 */

/** Below this a worker's self-reported confidence escalates. */
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Above this a step's monetary exposure escalates regardless of confidence.
 *
 * A confident agent moving $14,500 is exactly the case this exists for: the
 * model being sure is not the same as the business accepting the exposure.
 */
export const FINANCIAL_THRESHOLD_USD = 10_000;

/**
 * Below this, detected stakeholder sentiment escalates.
 *
 * Deliberately far down the scale. Mildly negative source material is ordinary
 * — a complaint being processed is still routine work — and a gate that fires
 * on it would train reviewers to clear the queue without reading.
 */
export const SENTIMENT_THRESHOLD = -0.75;

export type HitlTriggerReason =
  | "low_confidence_score"
  | "financial_threshold_exceeded"
  | "negative_sentiment_detected"
  | "external_system_mutation"
  | "unparseable_output"
  | "critic_flagged";

export type GateEvaluationParams = {
  agentRole: string;
  /** Null when output could not be parsed at all. */
  confidence: number | null;
  structurallyValid: boolean;
  criticFlagged: boolean;
  criticRisk: number | null;
  /**
   * USD this step commits, transacts, or recommends paying.
   *
   * Null means the step reported none — which is not the same as zero, though
   * both pass. The distinction matters if this ever drives reporting rather
   * than only this gate.
   */
  monetaryValueUsd: number | null;
  /** -1..1 stakeholder sentiment, or null when the step assessed none. */
  sentimentScore: number | null;
  /**
   * Set at decomposition when the planner judged this step to write to an
   * external system of record. Escalates regardless of how the run went.
   */
  requiresHitlCheck: boolean;
  /** Risk factors the worker itself reported. */
  workerRiskFactors: string[];
};

export type GateEvaluation = {
  requiresHitl: boolean;
  reason: HitlTriggerReason | null;
  /** Which role may resolve it. */
  requiredRole: string;
  primaryCause: string | null;
  riskFactors: string[];
  /**
   * The confidence check as a reviewer needs to see it — the runtime score
   * against the threshold it was judged by, not just a verdict. A gate that
   * says only "low confidence" makes the reviewer go looking for the number
   * that caused it.
   */
  confidenceBreakdown: {
    score: number | null;
    threshold: number;
    passed: boolean;
  };
};

/**
 * Decides whether a worker's output may be committed.
 *
 * Order is significant and is taken from the specification's worked examples: a
 * $14,500 payout at 0.64 confidence is reported as `financial_threshold_exceeded`
 * and routed to an administrator, not as low confidence. When several triggers
 * fire, the one named is the one that most changes who must look at it.
 *
 * Every branch here is arithmetic on values already in hand. No model call, so
 * the gate cannot be talked out of firing, cannot fail open on a provider
 * outage, and costs nothing.
 */
export function evaluateGateTriggers(
  params: GateEvaluationParams,
): GateEvaluation {
  const confidenceBreakdown = {
    score: params.confidence,
    threshold: CONFIDENCE_THRESHOLD,
    passed:
      params.confidence !== null && params.confidence >= CONFIDENCE_THRESHOLD,
  };

  const pass = (): GateEvaluation => ({
    requiresHitl: false,
    reason: null,
    requiredRole: "agent_operator",
    primaryCause: null,
    riskFactors: params.workerRiskFactors,
    confidenceBreakdown,
  });

  const halt = (
    reason: HitlTriggerReason,
    requiredRole: string,
    primaryCause: string,
    extraRiskFactors: string[] = [],
  ): GateEvaluation => ({
    requiresHitl: true,
    reason,
    requiredRole,
    primaryCause,
    riskFactors: [...extraRiskFactors, ...params.workerRiskFactors],
    confidenceBreakdown,
  });

  // Nothing else can be judged from output that did not parse.
  if (!params.structurallyValid) {
    return halt(
      "unparseable_output",
      "agent_operator",
      "Model output failed structural validation.",
    );
  }

  // Money first. This is the trigger that fires on a CONFIDENT agent, so
  // checking confidence before it would let the most expensive mistakes past.
  if (
    params.monetaryValueUsd !== null &&
    params.monetaryValueUsd > FINANCIAL_THRESHOLD_USD
  ) {
    return halt(
      "financial_threshold_exceeded",
      // An administrator, not an operator: authorising this much money is a
      // different act from confirming a step looks right.
      "ai_administrator",
      `This step commits $${params.monetaryValueUsd.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}, above the $${FINANCIAL_THRESHOLD_USD.toLocaleString("en-US")} approval limit.`,
      [`Monetary exposure: $${params.monetaryValueUsd.toFixed(2)}`],
    );
  }

  // A write to a system of record, regardless of how well the step went. The
  // planner marks these at decomposition, so the decision does not depend on
  // the worker assessing its own blast radius.
  if (params.requiresHitlCheck) {
    return halt(
      "external_system_mutation",
      "ai_administrator",
      "This step writes to an external system of record and needs sign-off before it is committed.",
      ["Writes to an external system of record"],
    );
  }

  if (
    params.sentimentScore !== null &&
    params.sentimentScore < SENTIMENT_THRESHOLD
  ) {
    return halt(
      "negative_sentiment_detected",
      "agent_operator",
      `Stakeholder sentiment measured ${params.sentimentScore.toFixed(2)}, below the ${SENTIMENT_THRESHOLD} escalation floor.`,
      [`Negative sentiment: ${params.sentimentScore.toFixed(2)}`],
    );
  }

  if (!confidenceBreakdown.passed) {
    return halt(
      "low_confidence_score",
      "agent_operator",
      `${params.agentRole} reported ${((params.confidence ?? 0) * 100).toFixed(0)}% confidence, below the ${CONFIDENCE_THRESHOLD * 100}% threshold.`,
    );
  }

  if (params.criticFlagged) {
    return halt(
      "critic_flagged",
      "agent_operator",
      `Critic flagged this output as ungrounded (risk ${(params.criticRisk ?? 1).toFixed(2)}).`,
    );
  }

  return pass();
}
