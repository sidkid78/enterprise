/**
 * Gate 1a — zero-trust PII masking.
 *
 * This runs BEFORE any text reaches the Interactions API. That ordering is the
 * whole control: interactions are stored server-side by default (55-day
 * retention on the paid tier), and `store: false` would disable
 * `previous_interaction_id` and `background`, which the HITL resume path
 * depends on. So masking-before-send is the only option that keeps both the
 * governance guarantee and the resume mechanism.
 *
 * Deliberately deterministic — no model call. A masker that itself ships the
 * raw text to an LLM to decide what is sensitive has already leaked it.
 */

export type PiiKind =
  | "EMAIL"
  | "CREDIT_CARD"
  | "SSN"
  | "IBAN"
  | "PHONE"
  | "IP_ADDRESS";

export type PiiMatch = { kind: PiiKind; value: string; token: string };

export type MaskResult = {
  masked: string;
  matches: PiiMatch[];
  /** token -> original, for restoring output shown to a human. */
  map: Record<string, string>;
};

/**
 * Order matters: emails are masked before phone/IP so their digits and dots
 * cannot be partially consumed by a later pattern.
 */
const PATTERNS: { kind: PiiKind; regex: RegExp; validate?: (s: string) => boolean }[] = [
  {
    kind: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: "IBAN",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  },
  {
    kind: "CREDIT_CARD",
    // Luhn-validated below; the bare pattern alone matches too much.
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhn,
  },
  {
    kind: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    kind: "PHONE",
    regex: /(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g,
  },
  {
    kind: "IP_ADDRESS",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
];

/** Luhn checksum — keeps order numbers and long IDs from being masked as cards. */
function luhn(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Replaces detected PII with stable tokens like `[EMAIL_1]`.
 *
 * Identical values reuse the same token within one call, so the model can still
 * reason about "the same customer appears twice" without seeing who they are.
 */
export function maskPii(text: string): MaskResult {
  const matches: PiiMatch[] = [];
  const map: Record<string, string> = {};
  const seen = new Map<string, string>();
  const counters: Partial<Record<PiiKind, number>> = {};

  let masked = text;

  for (const { kind, regex, validate } of PATTERNS) {
    masked = masked.replace(new RegExp(regex.source, regex.flags), (found) => {
      if (validate && !validate(found)) return found;

      const existing = seen.get(found);
      if (existing) return existing;

      const next = (counters[kind] ?? 0) + 1;
      counters[kind] = next;
      const token = `[${kind}_${next}]`;

      seen.set(found, token);
      map[token] = found;
      matches.push({ kind, value: found, token });
      return token;
    });
  }

  return { masked, matches, map };
}

/**
 * Restores original values in text that came back from the model.
 *
 * Only for display to an authorized human — never write an unmasked string back
 * into a payload that could be sent upstream again.
 */
export function unmaskPii(text: string, map: Record<string, string>): string {
  let restored = text;
  for (const [token, original] of Object.entries(map)) {
    restored = restored.split(token).join(original);
  }
  return restored;
}

/** Recursively masks every string in a JSON-ish structure. */
export function maskDeep(value: unknown): { value: unknown; matches: PiiMatch[] } {
  const matches: PiiMatch[] = [];

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = maskPii(node);
      matches.push(...result.matches);
      return result.masked;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };

  return { value: walk(value), matches };
}
