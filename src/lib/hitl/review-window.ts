/**
 * The two review-window constants, and nothing that reaches the server.
 *
 * Deliberately NOT marked `server-only`, and importing nothing that is: the
 * HITL queue is a Client Component, and pulling a VALUE out of
 * `lib/data/hitl.ts` drags `next/headers` into the browser bundle. Types alone
 * would have been erased; a number would not.
 *
 * `tsc` and eslint both pass on that mistake — only the bundler catches it, at
 * build time, with a stack that points at `lib/supabase/server.ts` rather than
 * at the import that caused it. Same split as `lib/queue/job-view.ts` and
 * `lib/rag/chunk.ts`, and made for the same reason.
 *
 * Both values mirror `private.` functions in the database, which re-derive them
 * on every write. These copies are for rendering, and cannot cause a lapsed
 * claim to be treated as live or an early expiry to be accepted.
 */

/** Mirrors `private.hitl_review_sla_hours()`. */
export const REVIEW_SLA_HOURS = 24;

/**
 * Mirrors `private.hitl_claim_ttl_minutes()`.
 *
 * Deliberately far below the review SLA, so a claim somebody forgot cannot be
 * the reason a gate breaches it.
 */
export const CLAIM_TTL_MINUTES = 60;
