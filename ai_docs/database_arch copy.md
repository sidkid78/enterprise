### Database Architect & Supabase Expert Specialist

### Comprehensive Database Architecture Overview

This production-grade PostgreSQL DDL schema powers the 2026 AI Consultant Software Platform on Supabase. It directly translates all 7 enterprise pillars into a unified, multi-tenant database engine with strict Row Level Security (RLS), dynamic model routing data stores, parent-child hybrid search capabilities (combining `pgvector` dense search with BM25 sparse text search), immutable cryptographic audit ledgers, and real-world commercialization metrics (BIO model).

```
                             +-----------------------------------+
                             |     Workspaces & Access Control   |
                             +-----------------+-----------------+
                                               |
         +-------------------------------------+-------------------------------------+
         |                                     |                                     |
+--------v-------+                    +--------v-------+                    +--------v-------+
|  Multi-Agent   |                    | Triple-Gate    |                    | Advanced Hybrid|
| Executions &   |                    | Governance &   |                    | Vector Knowledge|
| MCP Tools      |                    | Immutable Ledger|                   | RAG (pgvector) |
+--------+-------+                    +--------+-------+                    +--------+-------+
         |                                     |                                     |
+--------v-------+                    +--------v-------+                    +--------v-------+
| Stateful HITL  |                    | Enterprise AI  |                    | Change Mgmt &  |
| Approval Gates |                    | FinOps Controls|                    | Commercial BIO |
+----------------+                    +----------------+                    +----------------+
```

---

### Production SQL Schema Implementation

```sql
-- ============================================================================
-- 0. EXTENSIONS & SETUP
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector extension for dense embeddings
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- Trigram index for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- Cryptographic functions for SHA-256 ledgering

-- Setup custom schema if necessary, default to public
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

-- Helper security function for tenant context
CREATE OR REPLACE FUNCTION current_user_has_workspace_role(
    p_workspace_id UUID, 
    p_required_roles user_role_enum[]
) 
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM workspace_members 
        WHERE workspace_id = p_workspace_id 
          AND user_id = auth.uid() 
          AND role = ANY(p_required_roles)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 2. PILLAR 1: MULTI-AGENT SYSTEMS (MAS) & MCP INTEGRATIONS
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

CREATE TABLE mcp_tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    description TEXT,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(mcp_server_id, tool_name)
);

CREATE TABLE agent_graph_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    orchestrator_name TEXT NOT NULL,
    framework_type TEXT NOT NULL DEFAULT 'langgraph', -- e.g., 'langgraph', 'crewai', 'ag2'
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
    model_routing_used TEXT NOT NULL, -- e.g., 'gemini-3.7-flash', 'gemini-3.1-pro-preview'
    input_payload JSONB NOT NULL,
    output_payload JSONB,
    node_status TEXT NOT NULL DEFAULT 'running',
    latency_ms INT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    graph_execution_id UUID NOT NULL REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    sender_agent TEXT NOT NULL,
    recipient_agent TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'agent_to_agent', -- e.g., 'agent_to_agent', 'mcp_request', 'mcp_response'
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. PILLAR 2: GOVERNANCE CONTROL PLANE & IMMUTABLE LEDGER
-- ============================================================================

-- Immutable Agent Ledger: Hash-chained to ensure tamper-evident execution tracing
CREATE TABLE agent_audit_ledger (
    sequence_id BIGSERIAL PRIMARY KEY,
    ledger_uuid UUID UNIQUE DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    node_execution_id UUID REFERENCES agent_node_executions(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL, -- e.g., 'tool_invocation', 'data_write', 'delegation'
    payload JSONB NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL, -- SHA-256 of (previous_hash + sequence_id + payload)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guardrail_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    gate_layer TEXT NOT NULL, -- 'input_jailbreak', 'pii_leakage', 'output_hallucination', 'structural_json'
    verdict TEXT NOT NULL,    -- 'passed', 'flagged', 'blocked', 'redacted'
    risk_score NUMERIC(5,4),
    raw_payload_snippet TEXT,
    sanitized_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. PILLAR 3: STATEFUL HUMAN-IN-THE-LOOP (HITL) GATES
-- ============================================================================

CREATE TYPE hitl_status_enum AS ENUM ('pending', 'approved', 'rejected', 'escalated', 'timed_out');

CREATE TABLE hitl_approval_gates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    graph_execution_id UUID NOT NULL REFERENCES agent_graph_executions(id) ON DELETE CASCADE,
    node_execution_id UUID REFERENCES agent_node_executions(id) ON DELETE CASCADE,
    trigger_reason TEXT NOT NULL, -- 'low_confidence', 'policy_violation', 'financial_threshold', 'negative_sentiment'
    confidence_score NUMERIC(5,4),
    required_role user_role_enum NOT NULL DEFAULT 'agent_operator',
    assigned_user_id UUID REFERENCES auth.users(id),
    status hitl_status_enum NOT NULL DEFAULT 'pending',
    reasoning_log_summary JSONB NOT NULL, -- Explains WHY the agent requested human sign-off
    human_feedback TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. PILLAR 4: ENTERPRISE AI FINOPS & COMPUTE OPTIMIZATION
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
    model_name TEXT NOT NULL, -- e.g., 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.7-flash'
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0.000000,
    routing_tier TEXT NOT NULL DEFAULT 'model_cascade_cheap', -- 'model_cascade_cheap', 'frontier_model', 'semantic_cache_hit'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE semantic_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    query_embedding vector(768) NOT NULL, -- Google Gemini gemini-embedding-001 dimension
    response_payload JSONB NOT NULL,
    hit_count INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for Fast Semantic Cache Vector Search
CREATE INDEX idx_semantic_cache_vector ON semantic_cache 
USING hnsw (query_embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- 6. PILLAR 5: ADVANCED HYBRID RAG & DOMAIN-SPECIFIC KNOWLEDGE
-- ============================================================================

CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parent Documents (Stores complete global context, markdown, or tables)
CREATE TABLE document_parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_title TEXT NOT NULL,
    source_uri TEXT,
    full_content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Child Chunks (Stores granular chunks mapped back to parents with HNSW vector + TSVECTOR BM25)
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES document_parents(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    chunk_content TEXT NOT NULL,
    embedding vector(768) NOT NULL, -- Google Gemini gemini-embedding-001 dimension
    fts_tokens TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', chunk_content)) STORED,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector HNSW Index for Dense Search
CREATE INDEX idx_document_chunks_vector ON document_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Full-Text GIN Index for Sparse Search (BM25 Equivalent in PostgreSQL)
CREATE INDEX idx_document_chunks_fts ON document_chunks USING GIN (fts_tokens);

-- Composite Index for Tenant Isolation Routing
CREATE INDEX idx_document_chunks_tenant ON document_chunks(workspace_id, knowledge_base_id);

-- ============================================================================
-- 7. PILLAR 6: CHANGE MANAGEMENT & WORKFORCE UPSKILLING
-- ============================================================================

CREATE TABLE workforce_sop_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    workflow_domain TEXT NOT NULL,
    generated_from_graph_id UUID REFERENCES agent_graph_executions(id),
    sop_content JSONB NOT NULL, -- Step-by-step interactive instructions for human operators
    version INT NOT NULL DEFAULT 1,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_upskilling_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sop_id UUID NOT NULL REFERENCES workforce_sop_templates(id) ON DELETE CASCADE,
    completed_modules INT NOT NULL DEFAULT 0,
    total_modules INT NOT NULL DEFAULT 10,
    assessment_score NUMERIC(5,2),
    interactive_prompts_executed INT DEFAULT 0,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, sop_id)
);

-- ============================================================================
-- 8. PILLAR 7: SERVICE-AS-A-SOFTWARE & BIO ROI COMMERCIALIZATION
-- ============================================================================

CREATE TABLE client_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    monthly_recurring_fee NUMERIC(10,2) NOT NULL DEFAULT 3500.00,
    sla_uptime_target NUMERIC(5,2) NOT NULL DEFAULT 99.90,
    status TEXT NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL
);

-- Baseline, Instrument, Outcome (BIO) ROI Engine Tables
CREATE TABLE bio_baseline_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    metric_key TEXT NOT NULL, -- e.g., 'avg_insurance_claim_processing_minutes', 'po_manual_error_rate'
    baseline_value NUMERIC(12,4) NOT NULL,
    unit TEXT NOT NULL, -- e.g., 'minutes', 'usd', 'percentage'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, metric_key)
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

CREATE TABLE sla_breach_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    breach_type TEXT NOT NULL, -- 'latency_threshold_exceeded', 'model_drift', 'uptime_drop'
    severity TEXT NOT NULL DEFAULT 'warning',
    details JSONB NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### Advanced Stored Procedures & Triggers

#### 1. Hybrid Search RPC (Dense Vector + Sparse BM25 via Reciprocal Rank Fusion - RRF)
This function merges dense semantic vectors (`pgvector`) with sparse full-text search (`tsvector`), returning the parent context alongside child chunks.

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

#### 2. Immutable Ledger Anti-Tamper Trigger & Dynamic Hash Chaining
Ensures agent execution logs cannot be altered or deleted, and dynamically appends a cryptographic hash chain.

```sql
CREATE OR REPLACE FUNCTION enforce_immutable_agent_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_last_hash TEXT;
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Agent Audit Ledger records are immutable!';
    END IF;

    -- Fetch latest hash for the chain
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

### Row Level Security (RLS) Policies Matrix

To guarantee absolute enterprise tenant isolation, RLS is enabled across every single table. Below is the automated RLS policy application script.

```sql
-- Enable RLS across all tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_graph_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_approval_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE finops_budget_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE finops_token_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_sop_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_upskilling_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bio_baseline_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE bio_outcome_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_breach_events ENABLE ROW LEVEL SECURITY;

-- Dynamic Policy Generator for Tenant Isolation by Workspace
DO $$ 
DECLARE 
    tbl_name TEXT;
    target_tables TEXT[] := ARRAY[
        'mcp_servers', 'mcp_tools', 'agent_graph_executions', 'agent_node_executions',
        'agent_messages', 'agent_audit_ledger', 'guardrail_events', 'hitl_approval_gates',
        'finops_budget_controls', 'finops_token_logs', 'semantic_cache', 'knowledge_bases',
        'document_parents', 'document_chunks', 'workforce_sop_templates', 'user_upskilling_progress',
        'client_subscriptions', 'bio_baseline_metrics', 'bio_outcome_logs', 'sla_breach_events'
    ];
BEGIN
    FOREACH tbl_name IN ARRAY target_tables LOOP
        EXECUTE format('
            CREATE POLICY tenant_isolation_%I ON %I
            FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
                )
            )
            WITH CHECK (
                workspace_id IN (
                    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
                )
            );
        ', tbl_name, tbl_name);
    END LOOP;
END $$;

-- Workspaces Table Self-Access Policy
CREATE POLICY workspace_member_access ON workspaces
FOR SELECT USING (
    id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
```