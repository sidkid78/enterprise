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

`src/lib/genai/` — `client.ts` (tiers, pricing, usage normalization), `embeddings.ts`, `orchestrator.ts` (the engine), `report.ts` (the deliverable assembler).

At completion `buildRunReport()` assembles every completed node into one Markdown document and stores it as `agent_graph_executions.final_output` (`{ version, title, steps, sections, totals, markdown }`); the DAG tab renders it above the node grid. Assembly is deterministic — no synthesis call, so every line traces to the node that produced it and the end of a run costs nothing extra. It reads back from the database rather than in-memory state, so a resumed run includes its pre-pause steps and a human override lands in the document. Nodes are ordered by `depends_on`, not `created_at`: a whole plan is inserted in one statement and shares a timestamp to the microsecond, so `created_at` alone orders sections arbitrarily.

`launchGraph()` plans with the cheap tier, **persists every node upfront as `pending`**, then `executePending()` runs them in dependency order. `resumeGraph()` calls the same `executePending()` after a gate is resolved — that shared engine is the reason the plan is persisted before any of it runs, and it's what makes resume a continuation rather than a replay. Conversational continuity comes from `previous_interaction_id`, taken from the last completed node's stored `interaction_id`.

A node escalates when the worker self-reports confidence below `CONFIDENCE_THRESHOLD` (0.7) or returns unparseable JSON. Workers are instructed never to fabricate missing data and to report low confidence instead — in testing that correctly routed an un-runnable step to a human rather than inventing SAP records.

## Retrieval (Pillar 5)

`src/lib/rag/` — `chunk.ts` (pure, no `server-only`, safe to import from a Client Component), `ingest.ts`, `retrieve.ts`.

Parent/child: chunks are embedded small so retrieval is precise, and what the worker actually reads is the **parent document**, so it gets context a short chunk cannot carry. `hybrid_search_knowledge_chunks` fuses dense (HNSW cosine) and sparse (`tsvector` + GIN) arms by **Reciprocal Rank Fusion on rank, never on raw score** — cosine distance and `ts_rank_cd` are on incomparable scales.

- **The blueprint's version of that RPC is `SECURITY DEFINER`; ours is `SECURITY INVOKER`, granted to `service_role` only.** DEFINER bypasses RLS, so any authenticated caller could pass another workspace's id and read its documents. As with `launchGraph`, the caller must verify membership itself.
- **Embedding task types are asymmetric and must match.** Corpus is embedded `RETRIEVAL_DOCUMENT`, queries `RETRIEVAL_QUERY`; the semantic cache stays `SEMANTIC_SIMILARITY` because comparing two prompts is symmetric. Mixing them degrades recall silently.
- **Chunks are PII-masked before embedding; `full_content` is stored raw.** Embedding is a call to the provider and is retained server-side, so the retrievable copy must be clean. The parent is local, RLS-protected, and is what a reviewer needs to read. Same boundary as `root_prompt`.
- `retrieveContext` **never throws** — retrieval failing is a degraded answer, not a failed run. The critic is told separately whether retrieval actually happened, so an empty result can't be mistaken for "the knowledge base says nothing relevant".
- Retrieval is keyed on each node's **objective**, not the root prompt: every step asks a different question, and retrieving once up front would defeat the plan.
- `fts_tokens` casts the regconfig explicitly (`'pg_catalog.english'::regconfig`) — the one-argument `to_tsvector` is only STABLE and a generated column requires IMMUTABLE.

## MCP tools

`src/lib/mcp/` — `client.ts` (Streamable HTTP JSON-RPC), `registry.ts` (DB rows to function declarations, and invocation), plus `src/lib/genai/tool-loop.ts` (the model/tool round trip).

**The Interactions API's native `mcp_server` tool type is unusable here** — it supports Streamable HTTP only, and does not support Gemini 3 models, which is the whole cascade. So the runtime proxies MCP itself: registry tools are declared as ordinary functions and `runWorkerTurn` brokers the calls. That is also the better arrangement, because native remote MCP has the model provider call the tool directly, putting every invocation outside the approval gate, the guardrail events and the ledger.

- **`mcp_tools.requires_approval` defaults to `true`.** Discovery cannot grant an agent the right to act unattended; an operator opts a tool out deliberately. A pending call escalates to a HITL gate carrying the tool, the arguments, and the interaction id to chain from.
- **Tool results are screened for injection and PII-masked.** A result is third-party text flowing straight into the model's context — the most direct injection route in the system, since nobody reads it first. A blocked result is replaced with a refusal notice, never passed through. Masking applies because the result leaves the process again on the next turn.
- **Tool results are part of the critic's context**, along with the root prompt. Both were omitted at first, and each omission made the critic flag genuine facts as fabrications: values fetched from a system of record, and facts the requester themselves asserted. If you add a new source of grounding, add it to the critic's context in the same change.
- **An approved call is staged, not replayed.** `applyApprovedToolCall` runs the tool, writes `input_payload.resume_tool_result`, and returns the node to `pending`; the node loop then sends a `function_result` chained from the requesting interaction. If the turn after the call fails, `hasStagedToolResult` resumes the continuation without re-invoking — issuing a credit twice because the second half failed is precisely what the gate exists to prevent.
- Ledger action types: real MCP calls are `tool_invocation`; node summaries are `node_completion` (they used to share `tool_invocation`, which made them indistinguishable).
- `mcp_servers.encrypted_auth_metadata` is **not** actually encrypted; it is kept out of client reach by column-level grants (migration ...11), since RLS filters rows and cannot mask a column. Encrypt it before storing a production credential.
- Tool loops multiply requests per run — plan, per-node turns, each tool hop, plus the critic. This hits the Gemini free tier's 20/min limit quickly.
- The **Tool Access** dashboard tab (`McpToolRegistry`) registers servers, runs discovery, and flips the three per-tool switches. Every member can read the registry — seeing what agents can reach is the point — while only `workspace_owner` / `ai_administrator` may change it, enforced by RLS as well as by the Server Action.

## Governance visibility

The **Governance & Audit** tab reads `guardrail_events` and `agent_audit_ledger`, which the runtime had been writing since Phase 5 with nothing reading them.

- `verify_ledger_chain(workspace_id)` **recomputes** the SHA-256 chain from the stored payloads rather than reading a status column, so a claim of integrity is earned per request. Its hash input must stay identical to `private.compute_ledger_hash`: `previous_hash || sequence_id::text || workspace_id::text || payload::text`. Change one and you must change the other.
- It is `SECURITY INVOKER`, so it verifies only what the caller may already read. As DEFINER it would turn "verify my own chain" into "read every tenant's".
- The ledger is restricted to `workspace_owner` / `ai_administrator` / `compliance_auditor`; guardrail events are visible to every member. The tab **skips the ledger queries entirely** for other roles rather than querying and getting zero rows — "no entries recorded" and "not yours to read" are different claims, and a verification the viewer cannot perform must never render as a pass.

**TRUNCATE defeated the append-only ledger.** `enforce_immutable_ledger` is `FOR EACH ROW`, and TRUNCATE fires no row triggers and consults no RLS; Supabase's default privileges grant it to `authenticated`. Confirmed by test: `set role authenticated; truncate agent_audit_ledger;` removed every row silently. Not reachable through PostgREST (no TRUNCATE verb), so it was a defence-in-depth failure rather than a live exploit. Migration `…12` adds a **statement-level** TRUNCATE trigger — which cannot be granted around — and revokes TRUNCATE from `anon`/`authenticated` across the schema.

## Governance gates

`src/lib/governance/` — `pii.ts`, `injection.ts`, `critic.ts`. Every gate writes a `guardrail_events` row.

Order per node, and the order matters:

1. **PII masking** (`maskPii`) — deterministic regex, no model call. Runs *before* anything leaves the process, because interactions are stored server-side for 55 days and `store: false` would break `previous_interaction_id`. A masker that asks an LLM what is sensitive has already leaked it. Credit cards are Luhn-validated so order numbers aren't destroyed.
2. **Injection screen** (`screenForInjection`) — weighted patterns, ≥0.7 blocks, ≥0.3 flags. A tripwire, not a guarantee; real containment is that workers hold no credentials and consequential actions pass a HITL gate.
3. **Semantic cache** — keyed on the *masked* text, scoped per workspace. A cross-tenant hit would leak one customer's output to another.
4. **Structural validation** — `response_format` constrains shape but doesn't guarantee it; truncated or refused responses still need catching.
5. **Critic** (`reviewOutput`) — cheap tier, billed as `critic_gate`. Runs only when output is otherwise committable; a node already heading to a human doesn't need a second opinion. Deliberately *not* chained to the worker's interaction — independent context is the point. Fails closed: if the critic errors, the node escalates.

   The critic judges two kinds of claim differently: anything specific about **this customer** (records, figures, accounts, people) must trace to the supplied context, while **general professional knowledge** may come from the model. That split exists because there is no retrieval layer yet — `retrievalAvailable` is hard-wired `false` in the orchestrator. A critic asked to verify every claim against an always-empty context flags every substantive output, which is exactly what happened the moment workers started returning real content. The gate is genuinely narrower until Pillar 5 lands; flip the flag when it does.

**Worker output shape.** `WORKER_SCHEMA.result` declares `heading` / `content_markdown` / `key_findings` / `data`. Structured output only ever emits keys the schema declares, so the earlier bare `{ type: "object" }` produced `result: {}` on every node — runs "completed" carrying nothing but their own one-line summaries. If you add a field to a worker's output, declare it or it will silently not exist.

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
