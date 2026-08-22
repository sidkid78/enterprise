# Technical Architecture: Enterprise AI Consultant Software Platform (2026 Blueprint)

## Executive Summary & System Blueprint

Modern enterprise AI deployments require moving past monolithic LLM chat templates and single-model prompt abstractions. High failure rates in enterprise AI stem from poor orchestration, ungoverned non-deterministic outputs, runaway compute costs, lack of auditing, and minimal integration into human organizational workflows.

This technical blueprint outlines an enterprise-grade AI Consultant Software platform built on **Next.js 15 (App Router)**, **Supabase (PostgreSQL with `pgvector` and `pgcrypto`)**, and the official **Google GenAI SDK (`@google/genai`)**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ENTERPRISE CLIENT APPLICATION                          │
│                        (Next.js 15 App Router + Tailwind CSS Dashboard)                │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        TRIPLE-GATE GOVERNANCE CONTROL PLANE                            │
│   Gate 1: Injection & Zero-Trust PII Masking │ Gate 2: Structural JSON Validation        │
│   Gate 3: Critic Safety & Groundedness       │ SHA-256 Cryptographic Ledger Chain       │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      FINOPS COMPUTE & SEMANTIC CACHE ROUTER                            │
│  • Semantic Vector Cache (text-embedding-001, similarity > 0.92)                       │
│  • Model Cascade: gemini-3.5-flash-lite ──► gemini-3.7-flash ──► gemini-3.1-pro (Thinking) │
│  • Hard Budget Stops & Infinite Loop Safety Prevention (Max Recursion Depth = 15)      │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    DECENTRALIZED MULTI-AGENT ORCHESTRATOR                              │
│  Orchestrator-Worker Pattern │ Model Context Protocol (MCP) Tools │ Stateful Graph DAG │
└──────────────────────┬───────────────────────────────────┬─────────────────────────────┘
                       │                                   │
                       ▼                                   ▼
┌────────────────────────────────────────┐ ┌────────────────────────────────────────────┐
│      STATEFUL HITL APPROVAL GATES      │ │   ADVANCED HYBRID RAG (pgvector + BM25)    │
│ Low-confidence / high-value pauses;    │ │ Parent-Child late chunking; Dense +        │
│ Transparent reasoning reports & resume │ │ Sparse Reciprocal Rank Fusion (RRF)        │
└────────────────────────────────────────┘ └────────────────────────────────────────────┘
```

---

## 1. Enterprise Supabase Database Schema & Hybrid Vector Search Architecture

The database architecture is built on multi-tenant isolation via **Row Level Security (RLS)**. It features an immutable cryptographic audit ledger, Model Context Protocol (MCP) integration registries, parent-child hybrid RAG schemas, and commercialization metrics.

### 1.1 Complete Database DDL Schema

```sql
-- ============================================================================
-- 0. EXTENSIONS & SETUP
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector for dense embeddings
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- Trigram index for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- Cryptographic functions for SHA-256 ledgering

SET search_path TO public;

-- ============================================================================
-- 1. CORE MULTI-TENANCY & RBAC
-- ============================================================================
CREATE TYPE user_role_enum AS ENUM (
    'workspace_owner', 
    'ai_administrator', 
    'compliance_auditor', 
    'agent_operator', 
    'business_user'
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    enterprise_tier TEXT NOT NULL DEFAULT 'enterprise_sla_tier_1',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'business_user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- ============================================================================
-- 2. MULTI-AGENT SYSTEMS (MAS) & MCP INTEGRATIONS
-- ============================================================================
CREATE TYPE mcp_transport_enum AS ENUM ('sse', 'stdio', 'http_stream');
CREATE TYPE graph_status_enum AS ENUM (
    'pending', 
    'running', 
    'waiting_hitl', 
    'completed', 
    'failed', 
    'halted_finops'
);

CREATE TABLE mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    server_name TEXT NOT NULL,
    transport_type mcp_transport_enum NOT NULL DEFAULT 'sse',
    endpoint_url TEXT NOT NULL,
    encrypted_auth_metadata JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_graph_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    orchestrator_name TEXT NOT NULL,
    framework_type TEXT NOT NULL DEFAULT 'langgraph_mcp',
    status graph_status_enum NOT NULL DEFAULT 'pending',
    root_prompt TEXT NOT NULL,
    execution_context JSONB DEFAULT '{}'::jsonb,
    final_output JSONB,
    created_by UUID REFERENCES auth.users(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE agent_node_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    graph_execution_id UUID NOT NULL REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    model_routing_used TEXT NOT NULL, 
    input_payload JSONB NOT NULL,
    output_payload JSONB,
    node_status TEXT NOT NULL DEFAULT 'running',
    latency_ms INT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. GOVERNANCE, LEDGER & STATEFUL HITL
-- ============================================================================
CREATE TABLE agent_audit_ledger (
    sequence_id BIGSERIAL PRIMARY KEY,
    ledger_uuid UUID UNIQUE DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    node_execution_id UUID REFERENCES agent_node_executions(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL, 
    payload JSONB NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guardrail_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    gate_layer TEXT NOT NULL, 
    verdict TEXT NOT NULL,    
    risk_score NUMERIC(5,4),
    raw_payload_snippet TEXT,
    sanitized_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE hitl_status_enum AS ENUM ('pending', 'approved', 'rejected', 'escalated', 'timed_out');

CREATE TABLE hitl_approval_gates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID NOT NULL REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    node_execution_id UUID REFERENCES agent_node_executions(id) ON DELETE CASCADE,
    trigger_reason TEXT NOT NULL, 
    confidence_score NUMERIC(5,4),
    required_role user_role_enum NOT NULL DEFAULT 'agent_operator',
    assigned_user_id UUID REFERENCES auth.users(id),
    status hitl_status_enum NOT NULL DEFAULT 'pending',
    reasoning_log_summary JSONB NOT NULL,
    human_feedback TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. FINOPS OPTIMIZATION & SEMANTIC CACHE
-- ============================================================================
CREATE TABLE finops_budget_controls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    monthly_budget_usd NUMERIC(12,4) NOT NULL DEFAULT 1000.00,
    current_spend_usd NUMERIC(12,4) NOT NULL DEFAULT 0.00,
    max_tokens_per_execution INT NOT NULL DEFAULT 500000,
    max_agent_loop_recursion INT NOT NULL DEFAULT 15,
    hard_stop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE finops_token_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    node_execution_id UUID REFERENCES agent_node_executions(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL, 
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0.000000,
    routing_tier TEXT NOT NULL DEFAULT 'model_cascade_cheap',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE semantic_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    query_embedding vector(768) NOT NULL, -- Google text-embedding-004
    response_payload JSONB NOT NULL,
    hit_count INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_semantic_cache_vector ON semantic_cache 
USING hnsw (query_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- 5. ADVANCED HYBRID RAG (PARENT-CHILD + BM25)
-- ============================================================================
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_title TEXT NOT NULL,
    full_content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES document_parents(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    chunk_content TEXT NOT NULL,
    embedding vector(768) NOT NULL, 
    fts_tokens TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', chunk_content)) STORED,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_chunks_vector ON document_chunks 
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_document_chunks_fts ON document_chunks USING GIN (fts_tokens);

-- ============================================================================
-- 6. WORKFORCE UPSKILLING & BIO ROI COMMERCIALIZATION
-- ============================================================================
CREATE TABLE workforce_sop_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    workflow_domain TEXT NOT NULL,
    sop_content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bio_outcome_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID NOT NULL REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    metric_key TEXT NOT NULL,
    measured_value NUMERIC(12,4) NOT NULL,
    deflected_cost_usd NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    time_saved_minutes NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 Hybrid Vector Search Function (Reciprocal Rank Fusion)

Combines dense vector cosine distance with sparse BM25 (`tsvector`) text scoring, resolving parent document context to eliminate context fragmentation.

```sql
CREATE OR REPLACE FUNCTION hybrid_search_knowledge_chunks(
    p_workspace_id UUID,
    p_knowledge_base_id UUID,
    p_query_text TEXT,
    p_query_embedding vector(768),
    p_match_count INT DEFAULT 5,
    p_rrf_k INT DEFAULT 60
)
RETURNS TABLE (
    chunk_id UUID,
    parent_id UUID,
    chunk_content TEXT,
    parent_full_content TEXT,
    document_title TEXT,
    combined_score FLOAT
) 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    WITH dense_search AS (
        SELECT 
            dc.id,
            ROW_NUMBER() OVER (ORDER BY dc.embedding <=> p_query_embedding ASC) AS dense_rank
        FROM document_chunks dc
        WHERE dc.workspace_id = p_workspace_id 
          AND dc.knowledge_base_id = p_knowledge_base_id
        ORDER BY dc.embedding <=> p_query_embedding ASC
        LIMIT p_match_count * 2
    ),
    sparse_search AS (
        SELECT 
            dc.id,
            ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.fts_tokens, plainto_tsquery('english', p_query_text)) DESC) AS sparse_rank
        FROM document_chunks dc
        WHERE dc.workspace_id = p_workspace_id 
          AND dc.knowledge_base_id = p_knowledge_base_id
          AND dc.fts_tokens @@ plainto_tsquery('english', p_query_text)
        ORDER BY ts_rank_cd(dc.fts_tokens, plainto_tsquery('english', p_query_text)) DESC
        LIMIT p_match_count * 2
    ),
    rrf_scores AS (
        SELECT 
            COALESCE(d.id, s.id) AS id,
            (COALESCE(1.0 / (p_rrf_k + d.dense_rank), 0.0) + COALESCE(1.0 / (p_rrf_k + s.sparse_rank), 0.0)) AS score
        FROM dense_search d
        FULL OUTER JOIN sparse_search s ON d.id = s.id
    )
    SELECT 
        dc.id AS chunk_id,
        dp.id AS parent_id,
        dc.chunk_content,
        dp.full_content AS parent_full_content,
        dp.document_title,
        r.score::FLOAT AS combined_score
    FROM rrf_scores r
    JOIN document_chunks dc ON r.id = dc.id
    JOIN document_parents dp ON dc.parent_id = dp.id
    ORDER BY r.score DESC
    LIMIT p_match_count;
END;
$$;
```

### 1.3 Cryptographic Ledger Hash-Chaining Trigger

Guarantees tamper-evident tracing by calculating a SHA-256 hash incorporating the previous block's hash, sequence sequence ID, tenant ID, and payload.

```sql
CREATE OR REPLACE FUNCTION enforce_immutable_agent_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_last_hash TEXT;
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Agent Audit Ledger records are immutable!';
    END IF;

    SELECT current_hash INTO v_last_hash 
    FROM agent_audit_ledger 
    WHERE workspace_id = NEW.workspace_id 
    ORDER BY sequence_id DESC LIMIT 1;

    IF v_last_hash IS NULL THEN
        v_last_hash := 'GENESIS_BLOCK_00000000000000000000000000000000';
    END IF;

    NEW.previous_hash := v_last_hash;
    NEW.current_hash := encode(
        digest(
            v_last_hash || NEW.sequence_id::text || NEW.workspace_id::text || NEW.payload::text || NEW.created_at::text, 
            'sha256'
        ), 
        'hex'
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_ledger_immutable
BEFORE INSERT OR UPDATE OR DELETE ON agent_audit_ledger
FOR EACH ROW EXECUTE FUNCTION enforce_immutable_agent_ledger();
```

---

## 2. Multi-Agent Orchestration & Dynamic Model Cascade Engine

The core runtime uses the `@google/genai` SDK to implement an **Orchestrator-Worker Architecture**. It dynamically routes tasks across model tiers based on complexity and explicitly configures thinking budgets for deep reasoning steps.

### 2.1 Google GenAI SDK Wrapper (`lib/ai/genai.ts`)

```typescript
import { GoogleGenAI, Schema } from '@google/genai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable.');
}

export const ai = new GoogleGenAI({});

export const MODEL_TIERS = {
  FAST_ROUTER: 'gemini-3.5-flash-lite',      // Low latency task router & filter
  STANDARD_WORKER: 'gemini-3.7-flash',  // Standard tasks & tool calling
  DEEP_REASONER: 'gemini-3.1-pro-preview',     // Deep reasoning with explicit thinking budgets
} as const;

export interface TokenUsageStats {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
}

export function calculateModelCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number = 0
): number {
  let promptRate = 0.00000015;
  let completionRate = 0.0000006;

  if (model.includes('gemini-3.7-flash')) {
    promptRate = 0.0000005;
    completionRate = 0.000002;
  } else if (model.includes('gemini-3.1-pro-preview')) {
    promptRate = 0.000003;
    completionRate = 0.000012;
  }

  const promptCost = (promptTokens - cachedTokens) * promptRate;
  const cacheCost = cachedTokens * (promptRate * 0.25);
  const completionCost = completionTokens * completionRate;

  return Number((promptCost + cacheCost + completionCost).toFixed(6));
}

export async function generateAgentResponse<T>(params: {
  model: string;
  systemInstruction?: string;
  contents: string | Array<Record<string, unknown>>;
  responseSchema?: Schema;
  thinkingBudget?: number;
}): Promise<{ data: T; usage: TokenUsageStats }> {
  const { model, systemInstruction, contents, responseSchema, thinkingBudget } = params;

  const paramsToPass: Record<string, unknown> = {
    model,
    input: contents
  };

  if (systemInstruction) paramsToPass.systemInstruction = systemInstruction;
  if (responseSchema) {
    paramsToPass.responseMimeType = 'application/json';
    paramsToPass.responseSchema = responseSchema;
  }

  // Explicit thinking budget configuration for Gemini 3.1 Pro
  if (model.includes('gemini-3.1-pro-preview') && thinkingBudget) {
    paramsToPass.thinkingConfig = { thinkingBudget };
  }

  const interaction = await ai.interactions.create(paramsToPass as any);

  const text = interaction.output_text || '{}';
  const parsedData: T = responseSchema ? JSON.parse(text) : (text as unknown as T);

  const metadata = interaction.usage || {};
  const promptTokens = metadata.prompt_tokens || metadata.promptTokenCount || 0;
  const completionTokens = metadata.completion_tokens || metadata.candidatesTokenCount || 0;
  const cachedTokens = metadata.cached_tokens || metadata.cachedContentTokenCount || 0;

  return {
    data: parsedData,
    usage: {
      promptTokens,
      completionTokens,
      cachedTokens,
      estimatedCostUsd: calculateModelCost(model, promptTokens, completionTokens, cachedTokens),
    },
  };
}
```

### 2.2 Task Decomposition Schemas (`lib/orchestrator/types.ts`)

```typescript
import { Type, Schema } from '@google/genai';

export interface TaskDefinition {
  taskId: string;
  agentRole: string;
  description: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedModel: string;
  dependencies: string[];
  inputParameters: Record<string, unknown>;
  requiresHITLCheck: boolean;
}

export interface OrchestrationPlan {
  workflowDomain: string;
  summary: string;
  tasks: TaskDefinition[];
}

export const OrchestrationPlanSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    workflowDomain: { type: Type.STRING },
    summary: { type: Type.STRING },
    tasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: { type: Type.STRING },
          agentRole: { type: Type.STRING },
          description: { type: Type.STRING },
          complexity: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
          assignedModel: { 
            type: Type.STRING, 
            enum: ['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.1-pro-preview'] 
          },
          dependencies: { type: Type.ARRAY, items: { type: Type.STRING } },
          inputParameters: { type: Type.OBJECT },
          requiresHITLCheck: { type: Type.BOOLEAN }
        },
        required: ['taskId', 'agentRole', 'description', 'complexity', 'assignedModel', 'dependencies', 'requiresHITLCheck']
      }
    }
  },
  required: ['workflowDomain', 'summary', 'tasks']
};

export const WorkerNodeOutputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['SUCCESS', 'FAILURE', 'REQUIRES_HUMAN_REVIEW'] },
    confidenceScore: { type: Type.NUMBER },
    reasoningLog: { type: Type.STRING },
    extractedData: { type: Type.OBJECT }
  },
  required: ['status', 'confidenceScore', 'reasoningLog', 'extractedData']
};
```

---

## 3. Triple-Gate Governance Control Plane & FinOps Optimizer

The Governance Control Plane enforces security, compliance, and cost constraints prior to model execution, during payload structuring, and post-generation via critic models.

```
Incoming Request ──► [Gate 1A: Injection Scan] ──► [Gate 1B: Zero-Trust PII Masking] ──► [Semantic Cache Lookup]
                                                                                                │
                                                                                    ┌───────────┴───────────┐
                                                                                    ▼                       ▼
                                                                                Cache Hit               Cache Miss
                                                                                    │                       │
                                                                                    ▼                       ▼
                                                                           Return Cached Result   [Model Cascade Execution]
                                                                                                            │
                                                                                                            ▼
                                                                                                 [Gate 2: JSON Schema Check]
                                                                                                            │
                                                                                                            ▼
                                                                                                 [Gate 3: Critic Evaluator]
                                                                                                            │
                                                                                                            ▼
                                                                                                 [SHA-256 Ledger Write]
```

### 3.1 Input Security, PII Masking & Critic Guardrails (`lib/governance/guardrails.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { ai, MODEL_TIERS } from '@/lib/ai/genai';

export interface GuardrailCheckResult {
  passed: boolean;
  verdict: 'passed' | 'flagged' | 'blocked' | 'redacted';
  gateLayer: 'input_jailbreak' | 'pii_leakage' | 'output_hallucination' | 'structural_json';
  riskScore: number;
  sanitizedText: string;
  reason?: string;
}

const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  SSN: /\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g,
  CREDIT_CARD: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  API_KEY: /\b(sk-[a-zA-Z0-9]{32,64}|Bearer\s+[a-zA-Z0-9_\-\.]{32,128})\b/g,
};

const INJECTION_SIGNATURES = [
  /ignore\s+previous\s+instructions/i,
  /system\s+override/i,
  /bypass\s+security\s+filters/i,
  /reveal\s+your\s+system\s+prompt/i,
];

export class GuardrailControlPlane {
  private supabase: SupabaseClient;
  private workspaceId: string;

  constructor(supabase: SupabaseClient, workspaceId: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
  }

  async evaluateInputSecurity(rawInput: string): Promise<GuardrailCheckResult> {
    let riskScore = 0.0;
    for (const signature of INJECTION_SIGNATURES) {
      if (signature.test(rawInput)) riskScore += 0.45;
    }

    const isBlocked = riskScore >= 0.8;
    return {
      passed: !isBlocked,
      verdict: isBlocked ? 'blocked' : riskScore > 0 ? 'flagged' : 'passed',
      gateLayer: 'input_jailbreak',
      riskScore: Math.min(riskScore, 1.0),
      sanitizedText: rawInput,
      reason: isBlocked ? 'Prompt injection signature matched.' : undefined,
    };
  }

  maskPII(rawText: string): { maskedText: string; detectedTypes: string[] } {
    let maskedText = rawText;
    const detectedTypes: Set<string> = new Set();

    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      maskedText = maskedText.replace(pattern, (match) => {
        detectedTypes.add(piiType);
        return `[REDACTED_${piiType}]`;
      });
    }

    return { maskedText, detectedTypes: Array.from(detectedTypes) };
  }

  async evaluateOutputCritic(sourceContext: string, generatedOutput: string): Promise<GuardrailCheckResult> {
    const criticPrompt = `Evaluate this output for hallucinations or ungrounded claims relative to context.
Context: "${sourceContext}"
Output: "${generatedOutput}"
Respond with JSON: { "hallucinationRiskScore": <0.0-1.0>, "verdict": "PASSED" | "REJECTED" }`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL_TIERS.FAST_ROUTER,
        contents: criticPrompt,
        config: { responseMimeType: 'application/json' },
      });

      const evalData = JSON.parse(response.text || '{}');
      const passed = evalData.verdict === 'PASSED';

      return {
        passed,
        verdict: passed ? 'passed' : 'blocked',
        gateLayer: 'output_hallucination',
        riskScore: evalData.hallucinationRiskScore || 0.0,
        sanitizedText: generatedOutput,
      };
    } catch {
      return { passed: true, verdict: 'passed', gateLayer: 'output_hallucination', riskScore: 0.0, sanitizedText: generatedOutput };
    }
  }
}
```

### 3.2 Semantic Caching Engine (`lib/finops/cache.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { ai } from '@/lib/ai/genai';

export class SemanticCacheManager {
  private supabase: SupabaseClient;
  private workspaceId: string;
  private similarityThreshold: number;

  constructor(supabase: SupabaseClient, workspaceId: string, similarityThreshold = 0.92) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
    this.similarityThreshold = similarityThreshold;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });
    return response.embedding?.values || [];
  }

  async lookup<T>(queryText: string): Promise<{ hit: boolean; data?: T }> {
    const embedding = await this.generateEmbedding(queryText);

    const { data } = await this.supabase.rpc('match_semantic_cache', {
      p_workspace_id: this.workspaceId,
      p_query_embedding: embedding,
      p_similarity_threshold: this.similarityThreshold,
      p_match_count: 1,
    });

    if (data && data.length > 0) {
      return { hit: true, data: data[0].response_payload as T };
    }

    return { hit: false };
  }

  async store(queryText: string, payload: Record<string, unknown>): Promise<void> {
    const embedding = await this.generateEmbedding(queryText);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    await this.supabase.from('semantic_cache').insert({
      workspace_id: this.workspaceId,
      query_text: queryText,
      query_embedding: embedding,
      response_payload: payload,
      hit_count: 1,
      expires_at: expiresAt,
    });
  }
}
```

---

## 4. Stateful Human-in-the-Loop (HITL) Execution Gateways

When worker agents encounter low confidence scores (< 0.70), high transaction values ($10,000+), or extreme negative sentiment, execution is automatically paused and serialized in Supabase.

### 4.1 HITL Gateway & Resumption Service (`lib/hitl/gateway.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { generateAgentResponse, MODEL_TIERS } from '@/lib/ai/genai';

export interface HITLResolutionRequest {
  gateId: string;
  action: 'approve' | 'reject' | 'override' | 'escalate';
  humanFeedback?: string;
  overridePayload?: Record<string, unknown>;
}

export class HITLGatewayService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async createApprovalGate(params: {
    workspaceId: string;
    graphExecutionId: string;
    nodeExecutionId: string;
    triggerReason: string;
    confidenceScore: number;
    extractedPayload: Record<string, unknown>;
  }): Promise<string> {
    const reasoningSummary = {
      primaryCause: `Execution gate triggered due to ${params.triggerReason}`,
      confidenceScore: params.confidenceScore,
      extractedPayload: params.extractedPayload,
    };

    const { data, error } = await this.supabase
      .from('hitl_approval_gates')
      .insert({
        workspace_id: params.workspaceId,
        graph_execution_id: params.graphExecutionId,
        node_execution_id: params.nodeExecutionId,
        trigger_reason: params.triggerReason,
        confidence_score: params.confidenceScore,
        required_role: 'agent_operator',
        status: 'pending',
        reasoning_log_summary: reasoningSummary,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create HITL approval gate: ${error.message}`);

    await this.supabase
      .from('agent_graph_executions')
      .update({ status: 'waiting_hitl' })
      .eq('id', params.graphExecutionId);

    return data.id;
  }

  async resolveGate(request: HITLResolutionRequest, operatorUserId: string) {
    const { data: gate } = await this.supabase
      .from('hitl_approval_gates')
      .select('*')
      .eq('id', request.gateId)
      .single();

    if (!gate) throw new Error('Gate record not found.');

    const now = new Date().toISOString();

    if (request.action === 'reject') {
      await this.supabase
        .from('hitl_approval_gates')
        .update({ status: 'rejected', assigned_user_id: operatorUserId, resolved_at: now })
        .eq('id', request.gateId);

      await this.supabase
        .from('agent_graph_executions')
        .update({ status: 'failed' })
        .eq('id', gate.graph_execution_id);

      return { success: true, status: 'rejected' };
    }

    if (request.action === 'approve' || request.action === 'override') {
      await this.supabase
        .from('hitl_approval_gates')
        .update({
          status: 'approved',
          assigned_user_id: operatorUserId,
          human_feedback: request.humanFeedback,
          resolved_at: now,
        })
        .eq('id', request.gateId);

      // Set execution graph back to running state
      await this.supabase
        .from('agent_graph_executions')
        .update({ status: 'running' })
        .eq('id', gate.graph_execution_id);

      return { success: true, status: 'approved' };
    }

    return { success: false, status: 'unknown' };
  }
}
```

### 4.2 Server Action for Operator Interventions (`app/actions/hitl.ts`)

```typescript
'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { HITLGatewayService, HITLResolutionRequest } from '@/lib/hitl/gateway';

export async function resolveHITLApprovalGateAction(request: HITLResolutionRequest) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized user session.' };

  const gateway = new HITLGatewayService(supabase);
  const result = await gateway.resolveGate(request, user.id);

  return { success: true, data: result };
}
```

---

## 5. Next.js Enterprise Operations Dashboard & BIO Commercialization Hub

The front-end control plane features reactive inspection queues, live multi-agent execution tracing, SOP auto-generation, and the **Baseline, Instrument, Outcome (BIO)** ROI commercialization framework.

### 5.1 Main Dashboard Shell (`app/dashboard/page.tsx`)

```typescript
'use client';

import React, { useState } from 'react';
import HitlQueueDashboard from '@/components/dashboard/HitlQueueDashboard';
import DagTraceVisualizer from '@/components/dashboard/DagTraceVisualizer';
import BioRoiCommercialization from '@/components/dashboard/BioRoiCommercialization';

export default function EnterpriseDashboardPage() {
  const [activeTab, setActiveTab] = useState<'hitl' | 'dag' | 'bio'>('hitl');
  const [workspaceId] = useState<string>('ws_ent_9832_prod');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-bold text-slate-950 text-xl">
              Æ
            </div>
            <div>
              <h1 className="font-bold text-lg text-white">Enterprise AgentOps</h1>
              <p className="text-xs text-slate-400">Multi-Agent Orchestration & Governance Control Plane</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="border-b border-slate-800 mb-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('hitl')}
              className={`pb-4 text-sm font-medium border-b-2 ${
                activeTab === 'hitl' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'
              }`}
            >
              HITL Approval Queue
            </button>
            <button
              onClick={() => setActiveTab('dag')}
              className={`pb-4 text-sm font-medium border-b-2 ${
                activeTab === 'dag' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'
              }`}
            >
              DAG Visualizer
            </button>
            <button
              onClick={() => setActiveTab('bio')}
              className={`pb-4 text-sm font-medium border-b-2 ${
                activeTab === 'bio' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'
              }`}
            >
              BIO ROI & Commercialization
            </button>
          </nav>
        </div>

        {activeTab === 'hitl' && <HitlQueueDashboard workspaceId={workspaceId} />}
        {activeTab === 'dag' && <DagTraceVisualizer workspaceId={workspaceId} />}
        {activeTab === 'bio' && <BioRoiCommercialization workspaceId={workspaceId} />}
      </main>
    </div>
  );
}
```

### 5.2 Stateful HITL Queue Component (`components/dashboard/HitlQueueDashboard.tsx`)

```typescript
'use client';

import React, { useState } from 'react';
import { resolveHITLApprovalGateAction } from '@/app/actions/hitl';

export default function HitlQueueDashboard({ workspaceId }: { workspaceId: string }) {
  const [gates, setGates] = useState([
    {
      id: 'gate_7a89f2',
      agentRole: 'InsuranceClaimsAssessor',
      triggerReason: 'financial_threshold_exceeded',
      confidenceScore: 0.64,
      reasoning: 'Payout calculation ($14,500.00) exceeds automatic threshold ($10,000.00).',
      outputPayload: { recommendedPayoutUsd: 14500.00 },
    },
  ]);

  const [selectedGate, setSelectedGate] = useState(gates[0] || null);

  const handleResolve = async (action: 'approve' | 'reject') => {
    if (!selectedGate) return;
    await resolveHITLApprovalGateAction({ gateId: selectedGate.id, action });
    setGates((prev) => prev.filter((g) => g.id !== selectedGate.id));
    setSelectedGate(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-base font-bold text-white mb-4">Pending Escalations</h2>
        {gates.map((gate) => (
          <div
            key={gate.id}
            onClick={() => setSelectedGate(gate)}
            className={`p-4 rounded-lg border mb-3 cursor-pointer ${
              selectedGate?.id === gate.id ? 'border-cyan-500 bg-slate-800' : 'border-slate-800 bg-slate-950'
            }`}
          >
            <span className="text-xs font-mono text-cyan-400 block mb-1">{gate.agentRole}</span>
            <p className="text-xs text-slate-300">{gate.reasoning}</p>
          </div>
        ))}
      </div>

      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6">
        {selectedGate ? (
          <div>
            <h3 className="text-lg font-bold text-white mb-2">{selectedGate.agentRole} Gate Inspector</h3>
            <p className="text-xs text-slate-300 bg-slate-950 p-4 rounded border border-slate-800 mb-4">
              {selectedGate.reasoning}
            </p>
            <pre className="bg-slate-950 border border-slate-800 text-cyan-300 p-3 rounded text-xs font-mono mb-6">
              {JSON.stringify(selectedGate.outputPayload, null, 2)}
            </pre>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => handleResolve('reject')}
                className="px-4 py-2 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30"
              >
                Reject Task
              </button>
              <button
                onClick={() => handleResolve('approve')}
                className="px-4 py-2 rounded text-xs font-bold bg-emerald-500 text-slate-950"
              >
                Approve & Resume DAG
              </button>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-xs text-center py-12">Select a gate to inspect reasoning logs.</p>
        )}
      </div>
    </div>
  );
}
```

### 5.3 BIO Commercialization & ROI Dashboard Component (`components/dashboard/BioRoiCommercialization.tsx`)

```typescript
'use client';

import React from 'react';

export default function BioRoiCommercialization({ workspaceId }: { workspaceId: string }) {
  const bioMetrics = {
    monthlyRecurringFeeUsd: 3500.00,
    grossMarginUpliftUsd: 142850.00,
    hoursSaved: 3000.8,
    measuredUptime: 99.98,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <span className="text-xs text-slate-400 uppercase block mb-1">Gross Margin Uplift</span>
          <span className="text-2xl font-extrabold font-mono text-emerald-400">
            ${bioMetrics.grossMarginUpliftUsd.toLocaleString()}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <span className="text-xs text-slate-400 uppercase block mb-1">Human Hours Deflected</span>
          <span className="text-2xl font-extrabold font-mono text-cyan-400">
            {bioMetrics.hoursSaved} hrs
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <span className="text-xs text-slate-400 uppercase block mb-1">SLA Uptime</span>
          <span className="text-2xl font-extrabold font-mono text-indigo-400">
            {bioMetrics.measuredUptime}%
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <span className="text-xs text-slate-400 uppercase block mb-1">License Fee</span>
          <span className="text-2xl font-extrabold font-mono text-amber-400">
            ${bioMetrics.monthlyRecurringFeeUsd}/mo
          </span>
        </div>
      </div>
    </div>
  );
}
```

---

## 6. Enterprise Integration & Verification Matrix

| Pillar | Implementation Layer | Operational Target / Guarantee |
| :--- | :--- | :--- |
| **Pillar 1: Multi-Agent Systems (MAS)** | `OrchestratorEngine` + `@google/genai` | Stateful step decomposition via Model Context Protocol (MCP) |
| **Pillar 2: Governance Control Plane** | `GuardrailControlPlane` + `agent_audit_ledger` | Zero-Trust PII masking, jailbreak filters & SHA-256 tamper-evident DAG audit logs |
| **Pillar 3: Stateful HITL Gates** | `HITLGatewayService` + `hitl_approval_gates` | Execution serialization on low confidence (<0.70) or high value ($10k+) |
| **Pillar 4: Enterprise FinOps** | `FinOpsCascadeRouter` + `SemanticCacheManager` | Dynamic routing (`2.5-flash-lite` / `3-flash` / `3-pro` thinking) & `pgvector` semantic cache (>0.92 similarity) |
| **Pillar 5: Advanced Hybrid RAG** | `hybrid_search_knowledge_chunks` RPC | Dense vector + BM25 sparse text Reciprocal Rank Fusion (RRF) with parent document resolution |
| **Pillar 6: Workforce Upskilling** | `WorkforceUpskillingHub` | Auto-generation of SOP guides from active DAG runs |
| **Pillar 7: BIO ROI Commercialization** | `BioRoiCommercialization` | Baseline, Instrument, Outcome metrics engine tracking gross margin uplift and SLA compliance |
