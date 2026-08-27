/**
 * Gate 1b — prompt-injection screening.
 *
 * Heuristic and deterministic, run before the call. This is a tripwire, not a
 * guarantee: a determined attacker will phrase around any pattern list. It
 * exists to catch the common cases cheaply and to leave an auditable
 * `guardrail_events` record, with the real containment being that workers hold
 * no credentials and every consequential action passes a HITL gate.
 */

export type InjectionSignal = { pattern: string; weight: number };

export type InjectionVerdict = {
  /** 0-1. >= 0.7 blocks, >= 0.3 flags for the audit trail. */
  riskScore: number;
  signals: InjectionSignal[];
  verdict: "passed" | "flagged" | "blocked";
};

const BLOCK_THRESHOLD = 0.7;
const FLAG_THRESHOLD = 0.3;

const RULES: { label: string; regex: RegExp; weight: number }[] = [
  {
    label: "instruction_override",
    regex: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|direction)/i,
    weight: 0.55,
  },
  {
    label: "system_prompt_exfiltration",
    regex: /\b(reveal|show|print|repeat|output|tell me)\b[^.]{0,30}\b(system prompt|instructions|initial prompt|your rules)/i,
    weight: 0.5,
  },
  {
    label: "role_reassignment",
    regex: /\b(you are now|from now on you|act as|pretend to be|roleplay as)\b[^.]{0,40}\b(dan|admin|root|developer mode|unrestricted|jailbro?ken)/i,
    weight: 0.5,
  },
  {
    label: "guardrail_disable",
    regex: /\b(disable|bypass|turn off|remove)\b[^.]{0,30}\b(safety|guardrail|filter|restriction|policy)/i,
    weight: 0.5,
  },
  {
    label: "fake_system_turn",
    regex: /(^|\n)\s*(system|assistant)\s*:/i,
    weight: 0.35,
  },
  {
    label: "delimiter_injection",
    regex: /(<\/?(system|instructions?)>|\[\/?INST\]|<\|im_(start|end)\|>)/i,
    weight: 0.4,
  },
  {
    label: "exfiltration_target",
    regex: /\b(send|post|upload|forward|email)\b[^.]{0,30}\b(to https?:\/\/|to [\w.-]+@)/i,
    weight: 0.45,
  },
  {
    label: "credential_probe",
    regex: /\b(api[_ -]?key|secret[_ -]?key|service[_ -]?role|password|access[_ -]?token|env(?:ironment)? variable)/i,
    weight: 0.3,
  },
];

export function screenForInjection(text: string): InjectionVerdict {
  const signals: InjectionSignal[] = [];
  let score = 0;

  for (const rule of RULES) {
    if (rule.regex.test(text)) {
      signals.push({ pattern: rule.label, weight: rule.weight });
      // Combine so that several weak signals escalate but no single rule can
      // exceed 1; independent-probability style rather than a raw sum.
      score = score + rule.weight * (1 - score);
    }
  }

  const riskScore = Math.min(1, Number(score.toFixed(4)));

  return {
    riskScore,
    signals,
    verdict:
      riskScore >= BLOCK_THRESHOLD
        ? "blocked"
        : riskScore >= FLAG_THRESHOLD
          ? "flagged"
          : "passed",
  };
}
