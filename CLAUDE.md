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

**There is more in Google Drive than in `ai_docs/`.** Folder `ai_docs` (id `1PTCjjbWRzEPuNBuBEBWdo1KpDMnSxGZ1`), reachable with the Google Drive MCP tools, mirrors these six blueprints at its top level and then adds seven subfolders of per-subsystem PDFs that are **not** in the repo — Governance Control Plane (the three gates, the ledger), FinOps Engine (cascade, cache, budget controls, loop guard), Multi-Agent Orchestration (DAG, decomposition, MCP, state persistence), Stateful HITL Gates (triggers, resumption, reasoning logs, RBAC), Advanced Hybrid Rag (parent/child chunking, dense, BM25, RRF), BIO ROI & Upskilling (baselines, outcome logs, SOP generator, gross margin uplift), and Infrastructure & Stack (Next.js, Supabase, GenAI SDK, tenant isolation via RLS). Search `parentId = '<folder id>'`, then read by file id. Consult these before designing a subsystem they cover. Nothing there covers the queue, the worker fleet, or SLA availability.

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

**Email confirmation is ON locally** (`enable_confirmations = true`), and that is deliberate rather than an oversight to work around. Invitation redemption is gated on `email_confirmed_at`; with the flag false GoTrue stamps that column at signup, the check passes vacuously, and the protection is inert — so developing against the weaker setting hides the exact failure it exists to prevent. Mail is caught by `[local_smtp]`, never delivered: web UI at **http://127.0.0.1:54324**, REST at `/api/v1/messages` and `/api/v1/message/<id>` for scripted tests. Signup therefore returns **no session** until the link is followed, so any test that creates a user and immediately signs in must either follow the confirmation link or use the admin API with `"email_confirm": true`.

**Migrations applied by hand must be recorded by hand.** `supabase/migrations/` is applied on boot by `supabase start`, which consults `supabase_migrations.schema_migrations` — and applying a file with `docker exec … psql` does **not** write that row. Migrations `…10` through `…23` had all been applied that way and none were recorded, so the next `supabase start` would have tried to re-run fourteen of them; several are not idempotent (`…21` renames a column, `…23` creates a table) and the boot would have failed. Backfilled after verifying each object actually exists. If you apply a migration with psql, insert its `(version, name)` row in the same breath.

**Type generation is currently broken.** `supabase gen types typescript --local` fails with `LegacyPgDeltaSslProbeError` on CLI 2.115.0 (tried `--local`, `--db-url` with `sslmode=disable`, `-s public`, and pgdelta both on and off; the database itself is fine). So `src/lib/supabase/database.types.ts` is a permissive `any` placeholder and **column names in `.select()` strings are not compile-checked** — a typo is a runtime error. Each query in `src/lib/data/*` declares its own explicit row type to contain the blast radius. Retry generation after a CLI upgrade.

PostgREST embed shapes, confirmed against the running database: a **to-one** relation returns an object (or `null`), a **to-many** returns an array. `getPendingGates` normalizes both via `firstOf()` because the untyped client can't distinguish them.

Three clients, and the distinction matters:

| Module | Acts as | Use for |
| --- | --- | --- |
| `lib/supabase/client.ts` | signed-in user | Client Components |
| `lib/supabase/server.ts` | signed-in user | Server Components, Server Functions, Route Handlers — `await` it, per request |
| `lib/supabase/service.ts` | service role, **bypasses RLS** | agent runtime writes only; never import from a Client Component |

RLS conventions the migrations follow, which new tables should match: every table has RLS enabled; policies are `TO authenticated` **plus** an ownership predicate (role alone is not authorization); every UPDATE policy carries both `USING` and `WITH CHECK`; membership checks go through `private.is_workspace_member()` / `private.has_workspace_role()` rather than selecting `workspace_members` directly (a policy on that table cannot query itself). Those helpers are `SECURITY DEFINER` in an unexposed `private` schema with `EXECUTE` granted only to `authenticated`.

**Do not replace these with the blueprint's Dynamic Policy Generator.** `ai_docs` (Drive) → Infrastructure & Stack → `tenant-isolation-via-RLS.pdf` proposes deploying one uniform policy across every table via a PL/pgSQL `DO` loop:

```sql
CREATE POLICY tenant_isolation_<t> ON <t> FOR ALL
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
```

Everything else in that document is already true here — verified against the live database: RLS on **25/25** public tables (the doc says 22; `agent_workers`, `agent_job_queue` and `workspace_invitations` came later), `idx_document_chunks_tenant` present alongside the HNSW and GIN indexes, the SSR cookie session carrying the JWT to `auth.uid()`, and the 1–5 role hierarchy that migration `…22` implements. Only the generator is wrong for this schema, and adopting it would be a regression:

- **`FOR ALL` is tenant isolation and nothing else.** It grants every member — a `business_user`, power 1, included — INSERT/UPDATE/DELETE on every table in their workspace. That would let them delete `agent_audit_ledger` rows (the only policy there is SELECT, and only for three roles), raise their own `finops_budget_controls` cap (UPDATE is owner/admin), and delete `hitl_approval_gates` (the sole write path is `hitl_resolve`, with the power check and the ratchet trigger).
- **`semantic_cache` must keep zero policies.** It is the one table with RLS on and nothing attached, because it stores verbatim prompts. The generator would hand every member read access to them.
- It omits `TO authenticated` (no policy here applies to `public` — check with `select * from pg_policies where roles = '{public}'`) and inlines a `workspace_members` subquery instead of the `private.` helpers.

Membership answers **which tenant**; it never answers **what may this person do**. Keeping those separate is what the whole RBAC hierarchy rests on.

**And both halves belong in the database, not only in Server Actions.** The same document places tenant isolation in RLS but authorization in the application layer, accepting that "if application logic gets messed up, your users might occasionally be able to click buttons they shouldn't". That reasoning assumes the Server Action is the only door. It is not — PostgREST exposes the table directly and `authenticated` holds `UPDATE` on `hitl_approval_gates`, so a role check that lives only in `app/dashboard/actions.ts` is a client-side check on a directly addressable server. Application logic does not have to break; it only has to be skipped.

Demonstrated, then reverted: a real `business_user`, their own JWT, one `curl -X PATCH` at `/rest/v1/hitl_approval_gates`. Under our policies it returns `[]` and the gate stays `pending`. With the generator's policy installed on that one table it returns `{"status":"approved","required_role":"agent_operator"}` — a level-1 user approving a level-2 gate, no button clicked, `resolveGate` never invoked. The consequence is not cosmetic: the approval lands in `agent_audit_ledger`, hash-chained, and reads to an auditor as proof the control held.

So RBAC is enforced twice on purpose — `hitl_resolve` plus the ratchet trigger in the database, and the same check in the Server Action for a usable error message rather than a silent zero-row update. The database is the authority; the Server Action is UX. Same reasoning as `verify_ledger_chain` recomputing hashes instead of reading a status column. Note this predates the current work: `hitl_resolve` has carried a role predicate since migration `…03`, and `…22` only made it a hierarchy instead of an exact match.

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

## Queue and workers

`src/lib/queue/`, `scripts/worker.ts`, migration `…15`. Run the worker alongside the app: `npm run worker`.

The engine did not change — every node was already persisted as it completed — so this is a change of caller. `createRun()` inserts a `pending` execution and returns (no model call; planning belongs to the worker). `runGraph()` / `resumeGraph()` are the worker's entry points. A HITL approval **dispatches** a resume job instead of driving the continuation on the reviewer's connection.

- **Delivery is at-least-once.** A worker that dies holds nothing once `locked_until` passes, so every step must be safe to re-enter.
- **Planning is guarded by node count.** Without it a retry inserts a second plan and the run silently has twice the steps.
- **Nodes left `running` are reset to `pending` on re-entry.** Node-level idempotency makes retry safe from duplication, but the same rule silently *skips* a node whose worker died mid-step — observed exactly that: a 429 killed attempt 1 with `task_02` marked running, and attempt 2 marked the graph complete without it.
- **That reset is only safe because at most one job per graph may be active** — a partial unique index on `graph_execution_id where status in ('queued','running')` (migration `…16`). The lease alone does not give this: it is per JOB, and two rows for one graph were demonstrably both accepted and both executed. Without the index the reset stops being a repair and becomes a cause of double execution, tools included. `enqueueJob` treats the resulting 23505 as success and returns the active job, since "already scheduled" is what the caller wanted.
- **`waiting_hitl` is a job success, not a failure.** Retrying it would find the same gate and stall until attempts ran out.
- **Model calls have a timeout** (`withModelTimeout`, `GENAI_TIMEOUT_MS`, default 120s). Inline, a hung provider call died with the request; on a worker it holds the lease for its full 15 minutes. Seen live — a job sat `running` for eight minutes with no tokens logged and no CPU burned.
- The worker needs `--conditions react-server` so the `server-only` marker resolves to its empty module; without it Node takes the default export, which throws by design.
- Not pgmq (available, 1.5.1): its messages are an opaque store beside `agent_graph_executions`, and the dashboard would need a second lookup to tell "queued" from "running". A job row referencing the execution keeps one story and is ~40 lines of `FOR UPDATE SKIP LOCKED`.

## Workforce and BIO (Pillars 6-7)

`src/lib/workforce/sop.ts`, `src/app/dashboard/outcome-actions.ts`. Both tables were readable from the start and had no writer, which is why the ROI tab showed $0.00 for so long.

- **The runtime never estimates its own savings.** ROI enters only when a person records a baseline (minutes by hand, and the loaded hourly rate of whoever did it) and a person attributes a *completed* run to it. Having the platform score itself would be fabricated revenue — the same claim the critic gate refuses everywhere else. A halted or failed run cannot be attributed, since it delivered nothing.
- The rate lives on the baseline, not the workspace: a partner reviewing contracts and a coordinator re-keying invoices do not save the business the same amount per hour recovered.
- A unique index on `(graph_execution_id, metric_key)` stops double attribution. An ROI figure that grows on a double click is worse than no figure.
- **SOPs are generated deterministically from a completed run** — no model call, same reasoning as `buildRunReport`. A synthesis pass could describe a procedure that differs from the one that actually ran, which is the one thing an SOP must not do. Steps come out in `depends_on` order, each carrying its node's **objective** (what to do) separately from its **outcome** (what happened last time), and steps that hit a HITL gate are marked `requiredHuman`.
- Summaries the runtime writes for bookkeeping ("Approved by human reviewer.") are filtered out of `outcome` — true, and useless as an instruction.
- A new SOP is always `is_published: false`. Observing how something was done once is not endorsing it as how the team should work; publishing is a separate human act. Re-generating supersedes with a bumped `version`.
- `ai_docs/edgecraft-revops.md` describes the business this models — assessment, baseline, blueprint, measured recovery. The BIO tables map onto it directly.

## FinOps

`src/lib/data/finops.ts` plus three RPCs in migration `…13`.

- **`record_spend` is atomic and returns the resulting budget state.** `bumpSpend()` was read-modify-write in TypeScript, so two runs billing concurrently lost one of the updates — demonstrated: charging $5 then $7 that way left the total at $7. Never reintroduce a read-then-write here; the charge and the "am I now over?" answer must come from the same statement or they are a second race.
- **Budget is enforced before every node, not only at launch.** A graph inside its cap at launch can exhaust it midway, and completing anyway is how a hard stop becomes a suggestion. A halt sets `halted_finops`, writes a `budget_halt` ledger row, and **preserves completed nodes** — raising the cap and resuming continues from the halt point.
- Spend settles **per node** rather than once at the end, so an in-flight run is visible to a concurrent budget check and a crash mid-graph still bills the work done.
- `max_tokens_per_execution` is now enforced too (`token_ceiling_halt`); it had existed unused since migration `…04`. It catches the single pathological run that the monthly cap cannot.
- A cap of `0` means **unset**, not "no budget" — the `over_budget` predicate lives in SQL so the launch gate and the per-node gate cannot drift apart.
- **`agent_node_executions.cost_usd` is not the cost of a run.** The planning call and every critic gate are billed to the run but belong to no node, so summing node rows under-reports — measured at 18% on one run. `run_spend_summary` sums `finops_token_logs` instead, and the DAG tab shows that figure with an "(incl. orchestration)" note.
- Operator-facing dollar amounts go through `formatUsd()`: `toFixed(2)` renders this platform's sub-cent runs as "$0.00 of $0.00", which reads as a bug rather than a budget stop.

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

   The critic judges two kinds of claim differently: anything specific about **this customer** (records, figures, accounts, people) must trace to the supplied context, while **general professional knowledge** may come from the model. A critic asked to verify every claim against an empty context flags every substantive output, which is exactly what happened the moment workers started returning real content — so the split matters most when there is nothing to check against. `retrievalAvailable` is no longer hard-wired: since Pillar 5 landed it is computed per node as `retrieval.chunks.length > 0 || toolEvidence(toolCalls) !== ""`, so the critic is told whether this particular step actually had grounding, and an empty knowledge base cannot masquerade as "the corpus says nothing relevant".

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

## Dead letters

`src/lib/data/queue.ts`, `src/lib/queue/job-view.ts`, `src/app/dashboard/queue-actions.ts`, migration `…17`. Surfaced on the **Governance & Audit** tab, with a "stalled" badge on the tab nav so a given-up run is visible from anywhere.

- **`fail_agent_job` had been writing `failed` since migration `…15` with nothing reading it.** A run whose worker gave up simply stopped — no view, no count, no way back short of SQL. Same class of defect as the node the engine used to skip silently: work that did not happen, presented as nothing at all.
- **Retry is an operator action, never automatic.** The queue already retried `max_attempts` times; if the cause were transient it would be finished. A fourth automatic attempt is a loop, not a recovery.
- `requeue_agent_job` resets `attempts` to 0 but **keeps `last_error`** — it is the only record of why the job died, and clearing it on retry destroys the diagnosis at the moment someone is investigating.
- It returns an outcome word (`queued` / `already_active` / `not_failed` / `not_found`) rather than raising. `already_active` is checked explicitly instead of letting the `…16` unique index throw: an operator retrying a run someone else already restarted has not done anything wrong.
- The action verifies membership **and** that the submitted `jobId` belongs to that workspace. Membership proves rights over the workspace, not over an arbitrary id the client supplied.
- **`executePending` now refuses to mark a graph completed while any node is not `completed`.** The node loop `continue`s past anything not `pending`, so a node left `failed` (human rejection, injection block) fell through to an unconditional "completed" — verified: the same graph reports `completed` without the guard and `Cannot complete: task_02 is failed.` with it, and would have assembled a deliverable from the surviving nodes. Unreachable until a failed graph could be re-entered, which the requeue path introduces.
- **`job-view.ts` carries the queue's types and `isLeaseExpired` with no `server-only` marker.** The panel is a Client Component; importing a *value* from `lib/data/queue.ts` dragged `next/headers` into the browser bundle. `tsc` and eslint both pass on that — only the bundler catches it. Same split as `lib/rag/chunk.ts`.
- A `running` job past its lease is shown as "lease expired · reclaimable", not as running (false) or as an error (also false — the next claim recovers it).

## Worker fleet

`src/lib/queue/heartbeat.ts`, `agent_workers` + `worker_heartbeat` / `worker_shutdown` in migration `…18`, rendered by `QueueHealthPanel`.

Before this the only evidence a worker existed was `agent_job_queue.locked_by` on a job it happened to hold — which answers "who is working this row?" and nothing else. An idle worker was invisible, a dead worker was invisible, and an empty fleet was indistinguishable from an empty queue. So the most consequential operational fact in the system — **nothing is draining the queue, so every run is stalled and none will move** — could not be observed. Confirmed while testing: nine worker processes were running, accumulated across sessions, and nothing anywhere showed it.

- **The heartbeat runs on its own timer, never inside the poll loop.** `drainQueue` runs a job to completion synchronously, so a worker that only beat between polls would read as dead for the whole time it was doing the most work. Verified: a ~40s real run kept `beat_age` ≤ 2s while `jobs_claimed` stayed 0, which is only possible if the two are independent. It does share the event loop, so it survives `await`s, not CPU-blocking work.
- **Liveness is derived from the heartbeat age, never stored.** A process that dies cannot write "I died", so a column claiming a worker is alive is only as true as the last time someone remembered to update it. Same reasoning as `verify_ledger_chain` recomputing instead of reading a status.
- **Staleness is judged against the interval that worker declared** (`heartbeat_interval_ms`), not a constant in the reader — a worker tuned to 30s is not late at 12s. Three missed beats, not one: a single late beat is ordinary, and a fleet view that cries wolf gets ignored.
- **`agent_workers` has no `workspace_id`** — one worker drains every tenant — so every signed-in user reads every row. That is only acceptable because a row carries no tenant data: no workspace ids, no job ids, no prompts. Nothing added to this table may break that. `hostname`/`pid` are withheld by column grant, as with `mcp_servers.encrypted_auth_metadata`.
- No `current_job_id`: `locked_by` already says who holds what, and a second copy could disagree with the first — the same objection that ruled out pgmq.
- A clean exit sets `stopped_at` (grey, "stopped") so a planned shutdown does not decay into a stale heartbeat that reads as a crash. A restart reusing the same worker id clears it and resets `started_at`, or the new process inherits the dead one's shutdown and never appears live.
- Rows older than a day are pruned inside the heartbeat, which keeps the table bounded without a scheduled job.
- **A worker running an older build never registers and is invisible here.** Heartbeating can only see processes that heartbeat; the fleet view is not a proof that nothing else is consuming the queue.
- **Elapsed times come from `QueueHealth.observedAt`, a server-side read clock**, not `Date.now()` during render. The dashboard is a server component that changes only on navigation, so a live clock would age a worker into "presumed gone" against rows frozen at page load. React's compiler lint rejects the impure call outright; `tsc` does not.

## SLA measurement

`src/lib/data/bio.ts` plus `workspace_availability` / `record_sla_breach` in migration `…19`. `sla_breach_events` had existed since migration `…05` with no writer, so the count was always zero and the dashboard rendered **100.00% uptime unconditionally** — a perfect compliance claim produced by never having looked, which is the same fabrication the critic gate refuses everywhere else.

- **Availability is not the error rate.** A run that fails is the platform working and returning a bad answer: an incident, recorded and counted, that leaves uptime alone. A job sitting queued with nothing consuming it *is* downtime — the platform was asked to do work and could not begin. A budget or token halt is neither: that is the customer's own cap doing what they configured it to do, and charging it against our availability would penalise the platform for enforcing their policy.
- **Overlapping outages are merged** (gaps-and-islands in the RPC). Two jobs each waiting ten minutes in the same ten minutes is ten minutes of downtime, not twenty; summing rows inflates an outage by however many jobs happened to be queued during it. Intervals straddling the window edge are clipped to the part inside.
- **Two sources, and the second is the one that matters.** `claim_agent_job` records a closed interval `[run_after, claimed_at]` when a job waited past `private.queue_stall_threshold_seconds()` (300s) — measured at the moment the duration becomes known. But recording only at claim time leaves the worst case unrecorded: if no worker ever returns, nothing is claimed, nothing is written, and a wholly dead platform reports 100% on the strength of having no evidence. So the RPC also counts jobs *currently* queued past the threshold as downtime in progress. The two cannot double-count — a job feeds the live source only while still queued, and the closed row is written as it stops being queued.
- The wait is measured from `run_after`, not `created_at`: a retry deliberately backs off, and serving it promptly at its backoff deadline is not a stall.
- **An unmeasured SLA never renders as a passing one.** `availabilityMeasured` false shows "not measured" with a grey dot, not a green 100%.
- `workspace_availability` is SECURITY INVOKER — as DEFINER, "how is my platform doing?" would become a cross-tenant availability report.
- **Every helper an INVOKER function calls must be granted to `authenticated` too.** `workspace_availability` shipped calling `private.queue_stall_threshold_seconds()`, which was granted to `service_role` alone, and the whole dashboard died with `permission denied for function queue_stall_threshold_seconds` (fixed in migration `…20`). It passed testing because the RPC was exercised as `postgres`, a superuser that bypasses every grant. **Test an INVOKER function with `set role authenticated`** — as `postgres` you have only proved the SQL parses.

**A human rejection was being retried as a failure.** `resumeGraph` returned `failed` for a rejected gate, so the worker re-queued it, re-read the same rejection three times, and dead-lettered the run — presenting a reviewer's deliberate "no" to the operator as a platform breakdown. Verified before fixing. There is now a `rejected` RunStatus that the worker completes rather than retries, for exactly the reason `waiting_hitl` is a job success. Any new terminal outcome the engine can reach needs the same treatment.

**Incidents are recorded once, at dead-letter, not per failed attempt.** A transient failure the queue retried successfully is the system working; counting it would make the incident log a measure of provider flakiness rather than of what anyone was let down by.

## HITL trigger evaluation

`src/lib/governance/triggers.ts`. The four triggers and their numeric boundaries come from **`ai_docs` (Drive) → Stateful HITL Gates → `Trigger-Evaluation.pdf`**, not from invention. Only the confidence one existed before.

| Trigger | Boundary | Resolves as |
| --- | --- | --- |
| `low_confidence_score` | < 0.70 | `agent_operator` |
| `financial_threshold_exceeded` | > $10,000.00 | `ai_administrator` |
| `negative_sentiment_detected` | < -0.75 | `agent_operator` |
| `external_system_mutation` | planner flag | `ai_administrator` |

- **Order is load-bearing and comes from the spec's worked examples.** A $14,500 payout at 0.64 confidence reports as `financial_threshold_exceeded` routed to an administrator, *not* as low confidence. Money is checked before confidence because it is the trigger that fires on a **confident** agent — being sure is not the same as being authorised.
- **`requires_hitl_check` is set by the PLANNER at decomposition, never by the worker.** A step must not be able to decide for itself that its own blast radius is harmless. It is persisted into `input_payload` so a resume gates on the same judgement the original plan made.
- **`monetary_value_usd` and `sentiment_score` are optional in `WORKER_SCHEMA`, deliberately.** Making them required would force a model with no monetary content to invent a number, and a fabricated `$0` is indistinguishable from a real one — the gate would then be deciding on evidence the worker made up to fill a field. Absent means "nothing to declare", not zero.
- **Per-trigger `required_role` needed no policy change**: `hitl_resolve` already compares against the `required_role` column, and the column is `user_role_enum`, so an invalid value would be an insert error rather than a silent widening. Both emitted values are enum members.
- The evaluator is pure and unmarked by `server-only`, so thresholds can be shown in a Client Component. `CONFIDENCE_THRESHOLD` now has one definition, re-exported into the orchestrator.
- **0.70 is correct and matches the spec.** The `> 0.85` that appears in `SOP Auto Generator.pdf` and the ui-ux mock is inside a *sample SOP body* — a claims-domain rule an operator wrote into a procedure, not the platform threshold. Don't "fix" the constant to match it.

## Runaway loop guard

`claim_node_attempt` + `haltForLoop` in `src/lib/genai/orchestrator.ts`, migration `…21`. The boundary (15, per workspace, in `finops_budget_controls.max_agent_loop_recursion`) comes from **`ai_docs` (Drive) → FinOps Engine → `Runaway-loop-guard.pdf`**, which specifies a limit validated at runtime as the DAG progresses — not only at planning.

- **Half of it already existed and was the wrong half.** `max_agent_loop_recursion` was read at launch and used to cap *plan size*. That bounds how many steps a planner may emit and nothing else. The runaway it exists for is not a big plan; it is a small plan re-entered without end — escalate → approve → resume → escalate — each cycle a fresh model call. The queue's `max_attempts` cannot see it either, because **every HITL resolution dispatches a new job whose attempt counter starts at zero**.
- **`agent_node_executions.retry_count` had existed since migration `…02` with no writer and no reader** — same class as `sla_breach_events` and `fail_agent_job`'s `failed`. It is the counter now, renamed to **`attempt_count`**: it is incremented on the first execution, so a column called `retry_count` reading 1 for a node that was never retried was a lie. Nothing referenced it, so the rename was free.
- **It is a claim, not a check.** Permission to run is consumed by running, so a read followed by a write is a race and the thing at stake is spend — the same argument that made `record_spend` atomic. The RPC locks the parent `agent_graph_executions` row before aggregating (`for update` cannot be combined with an aggregate, and the invariant belongs to the graph, not to any node).
- **A refusal consumes nothing.** Otherwise every resume an operator tried would push the counter further past the cap, and raising the limit to 20 would find the graph already at 23 through nothing but failed resumptions. Verified: two consecutive refusals left the total at 3.
- **`halted_loop_guard` is a distinct graph status, not `halted_finops`.** Both protect the budget, but the remedies are opposite: a budget halt is cleared by raising the cap and the run then finishes, whereas clearing this one the same way just loops again. Reporting them alike sends an operator to the billing screen for a broken agent. Like `halted_finops` and `waiting_hitl` it is a job **success** — retrying a run that halted for looping is itself a loop.
- **Refused and un-answerable are different outcomes.** A failed RPC returns `errorMessage` and the run is marked `failed` (so the queue retries a transient cause) rather than halted — telling an operator their agent is in a runaway loop because the database blinked is a false accusation about their agent.
- Checked *after* the budget and token-ceiling gates, so a run about to halt anyway does not spend an attempt on being told so.
- Verified end to end with no model call: a 5-node graph pre-seeded to 5 attempts against a limit of 3 halted before `task_05`, preserved all four completed nodes, left `task_05` `pending`, wrote a `loop_guard_halt` ledger row (`graph_attempts: 5, recursion_limit: 3`), and did not increment anything. Raising the limit to 10 then resumed and completed it, `task_05` going to `attempt_count` 2. Chain verified across 113 entries.

`MAX_TOOL_HOPS` (6, in `tool-loop.ts`) is a different guard and does not overlap: it bounds tool round trips **within one turn**, and every re-entry gets a fresh six.

## RBAC and gate resolution

`src/lib/roles.ts`, `src/app/dashboard/actions.ts`, migration `…22`. The power matrix comes from **`ai_docs` (Drive) → Stateful HITL Gates → `Role-based access-control.pdf`**: `workspace_owner` 5, `ai_administrator` 4, `compliance_auditor` 3, `agent_operator` 2, `business_user` 1, resolved by `userPower >= requiredPower`.

- **Escalation used to park a run permanently.** `resolveGate` set the gate to `escalated`; `getPendingGates` filtered `status = 'pending'`, so it vanished from the queue; and `hitl_resolve`'s `USING` required `status = 'pending'`, so **nobody could ever act on it again** — owner included. Never observed only because nobody had pressed the button: 11 approved, 3 rejected, 3 pending, **0 escalated**. The spec never treated escalation as terminal — it "updates the `required_role` on the **active** record", so `escalated` is now an **open** state alongside `pending`, everywhere.
- **The old check was five unrelated keys, not a hierarchy.** `MANAGER_ROLES.includes(role) || role === requiredRole` gave the right answer for owner and administrator by accident — they sit above everything — while a `compliance_auditor` could not clear an `agent_operator` gate. The role whose entire job is auditing policy violations could not act on the ordinary ones.
- **`USING` and `WITH CHECK` carry different questions, and `WITH CHECK` must not repeat the power test.** Escalation is the act of handing a gate to someone more senior, so the operator doing it never has power over the value they are writing — an `agent_operator` raising a gate to `ai_administrator` would fail its own update. `USING` asks "may you act on this gate as it stands"; `WITH CHECK` only keeps the row in a workspace the caller belongs to.
- **`required_role` ratchets upward, enforced by trigger.** Lowering it is the one move that turns resolution into privilege escalation: drop an `ai_administrator` gate to `business_user`, then approve your own $14,500 payout. No policy can express it — the rule compares OLD to NEW, which `WITH CHECK` cannot see — so `private.enforce_gate_role_ratchet` does it.
- **An escalation is not a resolution.** No `resolved_at` (the ledger would show a reviewer settling something they explicitly declined to settle) and **no resume job** — the gate is still open, so a queued resume would claim the graph, find the gate undecided, and return `waiting_hitl` having done nothing but occupy the one active-job slot the graph gets. `resolved_by` *is* stamped: the reviewer who passed it upward is exactly who an auditor asks about.
- The escalate control offers only tiers strictly above **both** the viewer and the current bar, so an owner sees no control at all. Offering a choice the policy will reject is worse than not offering it.
- Verified with `set role authenticated` across six cases: auditor(3) clears an `agent_operator`(2) gate (0 rows under the old policy), `business_user`(1) cannot, auditor escalates 2→4, that same auditor is then locked out of the gate they escalated, owner(5) resolves the escalated gate — **the dead end** — and lowering `required_role` raises the ratchet exception.

**Membership has never had a writer.** `workspace_members` has carried INSERT/UPDATE/DELETE policies for owners and administrators since migration `…01`, plus the grants, and nothing in the app has ever called them — the same shape as `retry_count` and `sla_breach_events`. Every workspace has exactly one member, its creator, as `workspace_owner`, so the hierarchy above is real but currently unexercised in the app: there is no way to appoint a `compliance_auditor`. Wiring it needs an `auth.users` lookup that `authenticated` cannot do — a narrowly-scoped `SECURITY DEFINER` RPC or a real invite flow — which is an authz decision, not a wiring task.

## Membership and invitations

`supabase/migrations/…23`, `src/lib/data/members.ts`, `src/app/dashboard/member-actions.ts`, `AccessControlPanel`. This is the writer `workspace_members` never had.

- **The email lookup was rejected on purpose.** `authenticated` cannot read `auth.users`, so "invite by email" would need a `SECURITY DEFINER` RPC — and that RPC is an email-existence oracle: anyone administering any workspace could test addresses to learn who has an account. In an enterprise tenant that leaks corporate relationships, permanently, and it still cannot invite someone who has not registered. An invitation asks nothing; it records an intent against an address, and the address proves itself later.
- **There is no token column.** A random token earns its place only if it is what redemption checks. Redemption here is "this account has confirmed this address", which is strictly stronger than holding a link — a token in an inbox is a bearer credential that forwarding, logging, or a shared mailbox all leak.
- **Redemption is gated on `email_confirmed_at`, not on insertion.** An `AFTER INSERT ON auth.users` trigger keyed on email alone hands membership to whoever signs up claiming the address first, turning an invitation into an unauthenticated grant. The trigger fires on `insert or update of email_confirmed_at ... when (new.email_confirmed_at is not null)` — both, because a row can arrive already confirmed or be confirmed later. **`enable_confirmations` is currently `false` in `config.toml`, so GoTrue stamps the column at signup and the check passes vacuously. Turn it on before a real tenant.**
- **Two redemption paths, and the second is the one a signup-only design forgets.** `private.redeem_invitations()` is shared by the trigger and by `redeem_my_invitations()`, called from `getUserWorkspaces()`. Without the second, inviting someone who registered months ago changes no row in `auth.users`, nothing fires, and the invitation sits forever — a design that only redeems at signup quietly only works for people who had not signed up. Verified: invite-only left the membership count at 0 until the RPC ran.
- **`on conflict do nothing`, never an upsert of the role.** An invitation must not change an existing member's role, or re-inviting an administrator as `business_user` becomes a way to quietly strip their access.
- **Only redeemed rows are deleted; expired ones are kept.** The administrator's next question is "did I ever invite them?", and a table that forgets cannot answer it. Re-inviting upserts on `(workspace_id, email)` and refreshes the expiry.
- **A grant may not exceed the granter.** `workspace_invitations_insert` carries `has_role_power(workspace_id, invited_role)` as well as the `ai_administrator` floor, so an admin cannot mint an owner and be outranked by their own invitation. `setMemberRole` re-checks both directions — you may not grant above your rank, nor change someone who outranks you — because the `workspace_members` UPDATE policy predates the power matrix and still only tests owner-or-admin. It also refuses to demote the last owner: there is no self-service path back.
- Emails are stored lowercased under a CHECK constraint, so an unnormalized insert fails loudly rather than creating an invitation redemption would never match.
- Verified live end to end in the browser: `New.Auditor@Example.Test` normalized, invited as `compliance_auditor`, signed up, and appeared as a member with that role. Plus 11 SQL cases as `authenticated` covering the privilege-escalation refusals, unconfirmed signup, expiry, and the no-demotion rule.
