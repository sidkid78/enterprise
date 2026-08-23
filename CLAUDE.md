# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # next dev — also rewrites the nextjs-agent-rules block in AGENTS.md
npm run build    # next build
npm run start    # next start (requires a prior build)
npm run lint     # eslint (flat config, eslint.config.mjs)
npx tsc --noEmit # typecheck; there is no `typecheck` script
```

There is no test framework, test script, or test directory in this repo. Do not invent one without asking.

## What this project is

An enterprise "AgentOps" control-plane dashboard — the front-end shell for a multi-agent AI governance platform, currently being built out backend-first.

**Build status.** Phases 1-3 are implemented and **verified against a live local Postgres** (13/13 schema + RLS tests, all four tabs rendering real rows, HITL write path exercised). No hosted Supabase project exists yet.

- Phase 1 — schema, RLS, three Supabase clients, password auth, workspace onboarding. Done.
- Phase 2 — all four dashboard tabs read real rows via `src/lib/data/*`; no mock literals remain. Done.
- Phase 3 — HITL approve/reject/escalate/override via `src/app/dashboard/actions.ts`. Done; approving resumes the DAG.
- Phase 4 — agent runtime in `src/lib/genai/`. Done and exercised end to end against the live API: plan → execute → escalate → human approve → resume → escalate, with the hash chain intact across all ledger rows.
- Phase 5 — triple-gate governance + semantic cache. Done and verified live: injection blocked at risk 0.89 before any model call, PII redacted with zero raw values reaching any stored column, critic passing a grounded output, and a repeat run served from cache at $0.00.

Dashboard state lives in the URL (`?tab=`, `?workspace=`), not React state, so the server component refetches per tenant.

The intended full architecture lives as prose/DDL/code blocks in `ai_docs/` and has not been built. Read the relevant file before implementing any backend surface, so new work matches the intended design rather than inventing a parallel one:

| File | Covers |
| --- | --- |
| `ai_docs/summary copy.md` | Whole-system blueprint; start here |
| `ai_docs/database_arch copy.md` | Supabase DDL — multi-tenant RLS, pgvector + BM25 hybrid RAG, SHA-256 audit ledger |
| `ai_docs/ai_systems copy.md` | Orchestrator-worker engine, `@google/genai`, model cascade |
| `ai_docs/ai_security copy.md` | Triple-gate governance (injection/PII → JSON validation → critic), FinOps budget stops |
| `ai_docs/full-stack-workflow copy.md` | Stateful HITL pause/resume, execution snapshots |
| `ai_docs/ui-ux copy.md` | Dashboard component suite the current `src/components/dashboard/` files derive from |

The blueprints target Next.js 15 + Supabase; the app is actually on Next.js 16 and has no Supabase dependency installed. Treat the docs as design intent, not as a description of installed reality.

## Architecture

**Routing.** `next.config.ts` permanently redirects `/` → `/dashboard`, so `src/app/page.tsx` (still the untouched create-next-app splash) is dead code. `src/app/dashboard/page.tsx` is the real entry point.

**Dashboard shape.** `dashboard/page.tsx` is a single `'use client'` component holding all app state — `activeTab`, `workspaceId`, and a `stats` object — and switching between four tab components in `src/components/dashboard/`: `HitlQueueDashboard`, `DagTraceVisualizer`, `WorkforceUpskillingHub`, `BioRoiCommercialization`. Each takes only `{ workspaceId }` and seeds its own mock state from that; changing the tenant dropdown does **not** currently re-fetch or re-filter anything. When wiring real data, that prop is the intended tenant key.

**Two styling systems coexist.** The dashboard components are written in hand-rolled Tailwind utilities against a fixed `slate-950`/`cyan-400` dark palette with no dark-mode variants. The shadcn layer (`src/components/ui/`) uses semantic tokens (`bg-primary`, `text-muted-foreground`) and `@custom-variant dark`. Match whichever file you are editing; don't mix token and literal-color idioms in one component.

## Conventions

- **Tailwind v4, CSS-first.** Config is `@import` directives at the top of `src/app/globals.css` (`tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`). `components.json` points at a `tailwind.config.ts` that **does not exist** — do not create one to satisfy it; add theme changes as CSS variables in `globals.css`.
- **shadcn uses Base UI, not Radix.** Style is `base-nova`; `src/components/ui/button.tsx` wraps `@base-ui/react/button`. There is no `@radix-ui/*` dependency and no `asChild` — Base UI uses `render`. Add components with the shadcn CLI so the registry style is preserved. See `.agents/skills/shadcn/rules/base-vs-radix.md`.
- Path alias `@/*` → `./src/*`. Icons: `lucide-react`.
- `LayoutProps<"/">` in `src/app/layout.tsx` is a Next 16 generated global type, not an import — regenerated into `.next/types` by `next dev`/`next build`. Root metadata is still the create-next-app default.

## Database

Development runs against the **local Supabase stack**, not a hosted project (creating one is blocked on overdue invoices in the `homeease.ai` org).

```bash
npx supabase start     # applies supabase/migrations/ in order on boot
npx supabase stop      # --no-backup to discard the local volume
npx supabase status    # URLs and keys
```

`supabase/config.toml` disables `realtime`, `studio`, `storage`, `edge_runtime`, and `analytics` — only `db`, `auth`, and `rest` run, which keeps the image footprint small. Re-enable any of them if you need that surface.

`.env.local` holds the local stack's credentials. They are identical on every machine and are not secrets.

**Type generation is currently broken.** `supabase gen types typescript --local` fails with `LegacyPgDeltaSslProbeError` on CLI 2.115.0 (tried `--local`, `--db-url` with `sslmode=disable`, `-s public`, and pgdelta both on and off; the database itself is fine). So `src/lib/supabase/database.types.ts` is a permissive `any` placeholder and **column names in `.select()` strings are not compile-checked** — a typo is a runtime error. Each query in `src/lib/data/*` declares its own explicit row type to contain the blast radius. Retry generation after a CLI upgrade.

PostgREST embed shapes, confirmed against the running database: a **to-one** relation returns an object (or `null`), a **to-many** returns an array. `getPendingGates` normalizes both via `firstOf()` because the untyped client can't distinguish them.

Three clients, and the distinction matters:

| Module | Acts as | Use for |
| --- | --- | --- |
| `lib/supabase/client.ts` | signed-in user | Client Components |
| `lib/supabase/server.ts` | signed-in user | Server Components, Server Functions, Route Handlers — `await` it, per request |
| `lib/supabase/service.ts` | service role, **bypasses RLS** | agent runtime writes only; never import from a Client Component |

RLS conventions the migrations follow, which new tables should match: every table has RLS enabled; policies are `TO authenticated` **plus** an ownership predicate (role alone is not authorization); every UPDATE policy carries both `USING` and `WITH CHECK`; membership checks go through `private.is_workspace_member()` / `private.has_workspace_role()` rather than selecting `workspace_members` directly (a policy on that table cannot query itself). Those helpers are `SECURITY DEFINER` in an unexposed `private` schema with `EXECUTE` granted only to `authenticated`.

Two tables are deliberately client-invisible: `semantic_cache` has RLS on with **no policies** (it stores verbatim prompts — highest PII risk), and `agent_audit_ledger` is append-only via trigger with hashes computed server-side. Tables also need explicit `GRANT`s — since 2026-04-28 new public tables are not auto-exposed to the Data API.

Auth is email+password. `src/proxy.ts` (Next 16's rename of `middleware`) refreshes the session and gates `/dashboard`. It uses `getClaims()`, which validates the JWT — never substitute `getSession()` for authorization.

## Gemini API

No LLM SDK is installed yet. When adding one, use `@google/genai` >= 2.3.0 and the **Interactions API** (`client.interactions.create()`) — not `generateContent`, and not the deprecated `@google/generative-ai` package. Load the `gemini-interactions-api` skill before writing any call.

The model ids in the mock DAG data are real and current; the cascade `gemini-3.5-flash-lite` → `gemini-3.7-flash` → `gemini-3.1-pro-preview` (cheap → default → reasoning) is the intended FinOps routing. Never use `gemini-2.5-*`, `gemini-2.0-*`, or `gemini-1.5-*`.

Points where the API shapes this project's design:

- Multi-turn state is `previous_interaction_id`, and long work is `background: true` + polling `interactions.get(id)`. The `requires_action` status is what a HITL gate maps onto; persist the interaction id on the gate record to resume after sign-off.
- Both of those require `store: true` (the default), so interaction inputs are retained server-side — PII masking must happen *before* the call, not as a post-filter.
- Responses are a typed `steps[]` timeline (`model_output`, `thought`, `function_call`/`function_result`, …) that maps onto the `DagNode` trace the dashboard renders. Derive trace nodes from `steps` rather than inventing a parallel structure. Prefer the `output_text` helper over indexing `steps`.
- `temperature`/`top_p`/`top_k` are deprecated; use `thinking_level`, not `thinking_budget`.

## Agent runtime

`src/lib/genai/` — `client.ts` (tiers, pricing, usage normalization), `embeddings.ts`, `orchestrator.ts` (the engine).

`launchGraph()` plans with the cheap tier, **persists every node upfront as `pending`**, then `executePending()` runs them in dependency order. `resumeGraph()` calls the same `executePending()` after a gate is resolved — that shared engine is the reason the plan is persisted before any of it runs, and it's what makes resume a continuation rather than a replay. Conversational continuity comes from `previous_interaction_id`, taken from the last completed node's stored `interaction_id`.

A node escalates when the worker self-reports confidence below `CONFIDENCE_THRESHOLD` (0.7) or returns unparseable JSON. Workers are instructed never to fabricate missing data and to report low confidence instead — in testing that correctly routed an un-runnable step to a human rather than inventing SAP records.

## Governance gates

`src/lib/governance/` — `pii.ts`, `injection.ts`, `critic.ts`. Every gate writes a `guardrail_events` row.

Order per node, and the order matters:

1. **PII masking** (`maskPii`) — deterministic regex, no model call. Runs *before* anything leaves the process, because interactions are stored server-side for 55 days and `store: false` would break `previous_interaction_id`. A masker that asks an LLM what is sensitive has already leaked it. Credit cards are Luhn-validated so order numbers aren't destroyed.
2. **Injection screen** (`screenForInjection`) — weighted patterns, ≥0.7 blocks, ≥0.3 flags. A tripwire, not a guarantee; real containment is that workers hold no credentials and consequential actions pass a HITL gate.
3. **Semantic cache** — keyed on the *masked* text, scoped per workspace. A cross-tenant hit would leak one customer's output to another.
4. **Structural validation** — `response_format` constrains shape but doesn't guarantee it; truncated or refused responses still need catching.
5. **Critic** (`reviewOutput`) — cheap tier, billed as `critic_gate`. Runs only when output is otherwise committable; a node already heading to a human doesn't need a second opinion. Deliberately *not* chained to the worker's interaction — independent context is the point. Fails closed: if the critic errors, the node escalates.

Two things that look like bugs but aren't:

- **`agent_graph_executions.root_prompt` stores the raw, unmasked prompt.** That's intentional — it's our own RLS-protected database, and the reviewer needs to see what was actually asked. The masking boundary is the model provider, not local storage.
- **A cache hit leaves `previousInteractionId` unchanged**, since no new interaction exists to chain from. Continuity survives because every node's input carries `priorContext` textually.

Things that will bite:

- **Usage fields are `total_input_tokens` / `total_output_tokens`**, not `prompt_tokens` / `completion_tokens`. Reading the wrong name yields a silent zero and understates cost. `normalizeUsage()` is the single place this is handled.
- `service_role` bypasses RLS but **still needs table GRANTs** — migration `…07` exists because the runtime failed with `permission denied for table agent_graph_executions`. It also sets default privileges so new tables are covered.
- The orchestrator runs **inline in the request**. Fine for 3-6 node plans; a larger graph will outlive a serverless request budget. Every step is persisted as it completes, so moving to a queue is a change of caller, not of engine.
- `bumpSpend()` is read-modify-write and can lose an update under concurrency. Make it an atomic SQL increment before it drives real billing.
- Any caller of `launchGraph`/`resumeGraph` **must verify workspace membership first** — the runtime writes with the service role and has no RLS backstop. `run-actions.ts` does this with the user-scoped client.

**`ai_docs/` predates this API.** Its samples use `ai.models.generateContent`, `ai.models.embedContent`, and `text-embedding-004`, and have deliberately not been migrated. Treat them as architectural intent only — follow the rules above for the actual call shape.

## Agent tooling in this repo

- `.claude/skills/*` are **directory junctions** pointing into `.agents/skills/*`. Edit files under `.agents/skills/`; never replace a junction with a real directory. `skills-lock.json` tracks their upstream sources (`google-gemini/gemini-skills`, `shadcn/ui`) with content hashes, so treat these as vendored — regressions belong upstream.
- `.gemini-agent/` configures a separate Gemini-driven agent (`config.json` sets `specs_dir: ./specs`); `agent_instructions.md` is its system instruction and mirrors this file — keep the two in sync when project conventions change. `specs/{current,archive}/`, `commands/`, `workflows/`, and `logs/` are empty scaffolding for that workflow.
