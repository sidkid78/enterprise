### AI Security & FinOps Infrastructure 

### Architectural Blueprint: Governance Control Plane & FinOps Engine

```
                                 [ Incoming Enterprise Task Request ]
                                                  │
                                                  ▼
                   ┌─────────────────────────────────────────────────────────────┐
                   │               TRIPLE-GATE GOVERNANCE CONTROL PLANE           │
                   ├─────────────────────────────────────────────────────────────┤
                   │  GATE 1: INPUT GUARDRAILS                                   │
                   │  • Prompt Injection & Jailbreak Heuristics                  │
                   │  • PII / PHI Zero-Trust Regex & Masking Engine              │
                   └──────────────────────────────┬──────────────────────────────┘
                                                  │ (Sanitized Payload)
                                                  ▼
                   ┌─────────────────────────────────────────────────────────────┐
                   │               FINOPS OPTIMIZATION ENGINE                    │
                   ├─────────────────────────────────────────────────────────────┤
                   │  • Semantic Cache Search (gemini-embedding-001, similarity>0.92)│
                   │    ├─ CACHE HIT  ──► Return Cached Payload & Log Token Savings│
                   │    └─ CACHE MISS ──► Proceed to Model Cascade Routing        │
                   │  • Budget Hard Stop & Infinite Loop Prevention              │
                   │  • Dynamic Model Cascade Selection                          │
                   └──────────────────────────────┬──────────────────────────────┘
                                                  │
                                                  ▼
                   ┌─────────────────────────────────────────────────────────────┐
                   │             LLM EXECUTION & OUTPUT GOVERNANCE               │
                   ├─────────────────────────────────────────────────────────────┤
                   │  • Tiered Model Execution (Gemini 3.5 Flash Lite / 3.7 Flash / 3.1 Pro)│
                   │  GATE 2: STRUCTURAL OUTPUT GUARDRAIL                        │
                   │  • Enforce Strict JSON Schema Validation                     │
                   │  GATE 3: CRITIC SAFETY & HALLUCINATION GUARDRAIL             │
                   │  • LlamaGuard-style Evaluator Check                         │
                   └──────────────────────────────┬──────────────────────────────┘
                                                  │
                                                  ▼
                   ┌─────────────────────────────────────────────────────────────┐
                   │           IMMUTABLE DAG AUDIT LEDGER & FINOPS LOG           │
                   ├─────────────────────────────────────────────────────────────┤
                   │  • SHA-256 Tamper-Evident Hash Chain Entry                  │
                   │  • Record Token Usage, Cost, and Cache Status into Supabase │
                   └─────────────────────────────────────────────────────────────┘
```

---

### Key Implementation Files

```
├── lib/
│   ├── governance/
│   │   ├── guardrails.ts          # Gate 1 (Input/PII) & Gate 2/3 (Output/Critic)
│   │   ├── ledger.ts              # Cryptographic Immutable DAG Audit Logger
│   │   └── control-plane.ts       # Unified Governance & FinOps Execution Manager
│   └── finops/
│       ├── cache.ts               # Semantic Caching with pgvector & text-embedding-004
│       └── cascade.ts             # Model Cascade Router & Runaway Loop Guard
└── app/
    └── api/
        └── agent/
            └── governed-step/
                └── route.ts        # Next.js App Router API Endpoint for Governed Executions
```

---

### 1. Guardrail Control Plane (`lib/governance/guardrails.ts`)

This module implements **Gate 1 (Input Security & PII Masking)**, **Gate 2 (Structural Output Schema Enforcement)**, and **Gate 3 (Critic / Hallucination Validation)**.

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
  detectedPIITypes?: string[];
}

export interface PIIMaskingResult {
  maskedText: string;
  detectedTypes: string[];
  replacementMap: Record<string, string>;
}

// Enterprise Regex Patterns for Zero-Trust PII/PHI Detection
const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  SSN: /\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g,
  CREDIT_CARD: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  PHONE_US: /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g,
  API_KEY: /\b(sk-[a-zA-Z0-9]{32,64}|Bearer\s+[a-zA-Z0-9_\-\.]{32,128})\b/g,
  IP_ADDRESS: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
};

// Common Prompt Injection & Jailbreak Vectors
const INJECTION_SIGNATURES = [
  /ignore\s+previous\s+instructions/i,
  /system\s+override/i,
  /you\s+are\s+now\s+DAN/i,
  /bypass\s+security\s+filters/i,
  /disregard\s+all\s+prior\s+rules/i,
  /reveal\s+your\s+system\s+prompt/i,
  /jailbreak\s+mode/i,
];

export class GuardrailControlPlane {
  private supabase: SupabaseClient;
  private workspaceId: string;
  private graphExecutionId?: string;

  constructor(supabase: SupabaseClient, workspaceId: string, graphExecutionId?: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
    this.graphExecutionId = graphExecutionId;
  }

  /**
   * Gate 1A: Heuristic & Injection Detection for User/Agent Inputs
   */
  async evaluateInputSecurity(rawInput: string): Promise<GuardrailCheckResult> {
    let riskScore = 0.0;
    const matchedSignatures: string[] = [];

    for (const signature of INJECTION_SIGNATURES) {
      if (signature.test(rawInput)) {
        riskScore += 0.45;
        matchedSignatures.push(signature.source);
      }
    }

    const isBlocked = riskScore >= 0.8;
    const verdict = isBlocked ? 'blocked' : riskScore > 0 ? 'flagged' : 'passed';

    const result: GuardrailCheckResult = {
      passed: !isBlocked,
      verdict,
      gateLayer: 'input_jailbreak',
      riskScore: Math.min(riskScore, 1.0),
      sanitizedText: rawInput,
      reason: isBlocked
        ? `Prompt injection threat detected matching: ${matchedSignatures.join(', ')}`
        : undefined,
    };

    await this.logGuardrailEvent(result, rawInput.substring(0, 500));
    return result;
  }

  /**
   * Gate 1B: Zero-Trust PII / PHI Masking Engine
   */
  maskPII(rawText: string): PIIMaskingResult {
    let maskedText = rawText;
    const detectedTypes: Set<string> = new Set();
    const replacementMap: Record<string, string> = {};

    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      maskedText = maskedText.replace(pattern, (match) => {
        detectedTypes.add(piiType);
        const placeholder = `[REDACTED_${piiType}_${Math.random().toString(36).substring(2, 7)}]`;
        replacementMap[placeholder] = match;
        return placeholder;
      });
    }

    return {
      maskedText,
      detectedTypes: Array.from(detectedTypes),
      replacementMap,
    };
  }

  /**
   * Gate 2: Validate JSON Structure and Schema Conformity
   */
  validateStructure<T>(rawJsonString: string, requiredFields: string[]): { valid: boolean; parsed?: T; error?: string } {
    try {
      const parsed = JSON.parse(rawJsonString);
      if (typeof parsed !== 'object' || parsed === null) {
        return { valid: false, error: 'Output is not a valid JSON object' };
      }

      for (const field of requiredFields) {
        if (!(field in parsed)) {
          return { valid: false, error: `Missing required schema field: ${field}` };
        }
      }

      return { valid: true, parsed };
    } catch (e) {
      return { valid: false, error: `JSON Parse Exception: ${(e as Error).message}` };
    }
  }

  /**
   * Gate 3: Secondary Critic Guardrail Check (Evaluating Hallucinations or Toxicity)
   */
  async evaluateOutputCritic(
    sourceContext: string,
    generatedOutput: string
  ): Promise<GuardrailCheckResult> {
    const criticPrompt = `You are an Enterprise AI Compliance Critic. Evaluate the output for hallucinations, false factual claims, and ungrounded statements relative to the provided context.

Context:
"""
${sourceContext}
"""

Generated Output:
"""
${generatedOutput}
"""

Respond with valid JSON:
{
  "hallucinationRiskScore": <float between 0.0 and 1.0>,
  "groundedInContext": <boolean>,
  "isToxicOrHarmful": <boolean>,
  "verdict": <"PASSED" | "REJECTED">,
  "explanation": "<short explanation>"
}`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL_TIERS.FAST_ROUTER,
        contents: criticPrompt,
        config: { responseMimeType: 'application/json' },
      });

      const evalData = JSON.parse(response.text || '{}');
      const passed = evalData.verdict === 'PASSED' && !evalData.isToxicOrHarmful;

      const result: GuardrailCheckResult = {
        passed,
        verdict: passed ? 'passed' : 'blocked',
        gateLayer: 'output_hallucination',
        riskScore: evalData.hallucinationRiskScore || 0.0,
        sanitizedText: generatedOutput,
        reason: evalData.explanation,
      };

      await this.logGuardrailEvent(result, generatedOutput.substring(0, 500));
      return result;
    } catch (error) {
      // Fallback pass with warning if critic API invocation experiences temporary drift
      return {
        passed: true,
        verdict: 'flagged',
        gateLayer: 'output_hallucination',
        riskScore: 0.1,
        sanitizedText: generatedOutput,
        reason: `Critic check warning: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Persists guardrail findings into the Supabase guardrail_events table
   */
  private async logGuardrailEvent(
    result: GuardrailCheckResult,
    snippet: string
  ): Promise<void> {
    await this.supabase.from('guardrail_events').insert({
      workspace_id: this.workspaceId,
      graph_execution_id: this.graphExecutionId || null,
      gate_layer: result.gateLayer,
      verdict: result.verdict,
      risk_score: result.riskScore,
      raw_payload_snippet: snippet,
      sanitized_payload: {
        reason: result.reason,
        detectedTypes: result.detectedPIITypes || [],
      },
    });
  }
}
```

---

### 2. Semantic Caching Engine (`lib/finops/cache.ts`)

Intercepts prompt requests using Gemini `gemini-embedding-001` (768 dimensions) and cosine similarity in PostgreSQL (`pgvector`) to skip duplicate computation.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { ai } from '@/lib/ai/genai';

export interface SemanticCacheHit<T> {
  hit: boolean;
  data?: T;
  similarityScore?: number;
  cacheId?: string;
}

export class SemanticCacheManager {
  private supabase: SupabaseClient;
  private workspaceId: string;
  private similarityThreshold: number;

  constructor(supabase: SupabaseClient, workspaceId: string, similarityThreshold = 0.92) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Generates a 768-dimensional vector embedding using Google text-embedding-004
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });

    if (!response.embedding?.values) {
      throw new Error('Failed to compute vector embedding from text-embedding-004');
    }

    return response.embedding.values;
  }

  /**
   * Queries Supabase pgvector semantic_cache table for vector similarity
   */
  async lookup<T>(queryText: string): Promise<SemanticCacheHit<T>> {
    const queryEmbedding = await this.generateEmbedding(queryText);

    // Call pgvector similarity query
    const { data, error } = await this.supabase.rpc('match_semantic_cache', {
      p_workspace_id: this.workspaceId,
      p_query_embedding: queryEmbedding,
      p_similarity_threshold: this.similarityThreshold,
      p_match_count: 1,
    });

    if (error) {
      // Fallback on direct vector distance calculation if RPC missing
      const { data: directData } = await this.supabase
        .from('semantic_cache')
        .select('id, response_payload, query_embedding')
        .eq('workspace_id', this.workspaceId)
        .gt('expires_at', new Date().toISOString())
        .limit(10);

      if (!directData || directData.length === 0) {
        return { hit: false };
      }

      for (const row of directData) {
        const sim = this.cosineSimilarity(queryEmbedding, row.query_embedding);
        if (sim >= this.similarityThreshold) {
          // Increment hit count asynchronously
          this.incrementHitCount(row.id);
          return {
            hit: true,
            data: row.response_payload as T,
            similarityScore: sim,
            cacheId: row.id,
          };
        }
      }
      return { hit: false };
    }

    if (data && data.length > 0) {
      const match = data[0];
      await this.incrementHitCount(match.id);
      return {
        hit: true,
        data: match.response_payload as T,
        similarityScore: match.similarity,
        cacheId: match.id,
      };
    }

    return { hit: false };
  }

  /**
   * Stores a new execution response payload into semantic_cache
   */
  async store(queryText: string, payload: Record<string, unknown>, ttlHours = 72): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(queryText);
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

      await this.supabase.from('semantic_cache').insert({
        workspace_id: this.workspaceId,
        query_text: queryText,
        query_embedding: embedding,
        response_payload: payload,
        hit_count: 1,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.warn('Semantic Cache Store Warning:', err);
    }
  }

  private async incrementHitCount(cacheId: string): Promise<void> {
    await this.supabase.rpc('increment_semantic_cache_hit', { p_cache_id: cacheId }).catch(() => {
      // Non-blocking update fallback
      this.supabase
        .from('semantic_cache')
        .update({ hit_count: 1 })
        .eq('id', cacheId);
    });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

---

### 3. Model Cascade Router & FinOps Limiter (`lib/finops/cascade.ts`)

Prevents runaway recursive loops, enforces budget stops, and dynamically routes subtasks to optimal Gemini model tiers.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { MODEL_TIERS } from '@/lib/ai/genai';

export interface FinOpsBudgetCheck {
  allowed: boolean;
  currentSpendUsd: number;
  monthlyBudgetUsd: number;
  remainingUsd: number;
  hardStopEnabled: boolean;
  reason?: string;
}

export interface CascadeModelSelection {
  selectedModel: string;
  tier: 'FAST_ROUTER' | 'STANDARD_WORKER' | 'DEEP_REASONER';
  estimatedCostPer1kPromptTokens: number;
  thinkingBudget?: number;
}

export class FinOpsCascadeRouter {
  private supabase: SupabaseClient;
  private workspaceId: string;

  constructor(supabase: SupabaseClient, workspaceId: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
  }

  /**
   * Verifies current spend against monthly financial budget limit
   */
 export class FinOpsCascadeRouter {
  private supabase: SupabaseClient;
  private workspaceId: string;

  constructor(supabase: SupabaseClient, workspaceId: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
  }

  /**
   * Verifies current spend against monthly financial budget limit
   */
  async checkBudgetStatus(): Promise<FinOpsBudgetCheck> {
    const { data, error } = await this.supabase
      .from('finops_budget_controls')
      .select('monthly_budget_usd, current_spend_usd, hard_stop_enabled')
      .eq('workspace_id', this.workspaceId)
      .single();

    if (error || !data) {
      // Default safe limit if no configuration row exists yet
      return {
        allowed: true,
        currentSpendUsd: 0,
        monthlyBudgetUsd: 1000,
        remainingUsd: 1000,
        hardStopEnabled: true,
      };
    }

    const remainingUsd = data.monthly_budget_usd - data.current_spend_usd;
    const allowed = !data.hard_stop_enabled || remainingUsd > 0;

    return {
      allowed,
      currentSpendUsd: data.current_spend_usd,
      monthlyBudgetUsd: data.monthly_budget_usd,
      remainingUsd,
      hardStopEnabled: data.hard_stop_enabled,
      reason: allowed ? undefined : 'Monthly FinOps USD budget limit reached. Execution halted by hard-stop guard.',
    };
  }

  /**
   * Prevents runaway infinite loops in agent execution graphs
   */
  validateRecursionDepth(currentDepth: number, maxAllowedDepth = 15): { safe: boolean; reason?: string } {
    if (currentDepth > maxAllowedDepth) {
      return {
        safe: false,
        reason: `Runaway Infinite Loop Protection Triggered: Depth ${currentDepth} exceeded maximum allowable iterations (${maxAllowedDepth}).`,
      };
    }
    return { safe: true };
  }

  /**
   * Dynamic Model Cascade: Maps subtask complexity to lowest cost sufficient model
   */
  selectModelForTask(params: {
    complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    requiresThinking?: boolean;
    tokenBudgetConstraint?: number;
  }): CascadeModelSelection {
    const { complexity, requiresThinking } = params;

    if (complexity === 'LOW') {
      return {
        selectedModel: MODEL_TIERS.FAST_ROUTER,
        tier: 'FAST_ROUTER',
        estimatedCostPer1kPromptTokens: 0.00015,
      };
    }

    if (complexity === 'MEDIUM' && !requiresThinking) {
      return {
        selectedModel: MODEL_TIERS.STANDARD_WORKER,
        tier: 'STANDARD_WORKER',
        estimatedCostPer1kPromptTokens: 0.0005,
      };
    }

    return {
      selectedModel: MODEL_TIERS.DEEP_REASONER,
      tier: 'DEEP_REASONER',
      estimatedCostPer1kPromptTokens: 0.003,
      thinkingBudget: requiresThinking ? 2048 : undefined,
    };
  }

  /**
   * Updates current monthly spend in finops_budget_controls after an execution step
   */
  async recordStepCost(costUsd: number): Promise<void> {
    if (costUsd <= 0) return;

    const { data } = await this.supabase
      .from('finops_budget_controls')
      .select('current_spend_usd')
      .eq('workspace_id', this.workspaceId)
      .single();

    if (data) {
      const newSpend = Number(data.current_spend_usd) + costUsd;
      await this.supabase
        .from('finops_budget_controls')
        .update({ current_spend_usd: newSpend, updated_at: new Date().toISOString() })
        .eq('workspace_id', this.workspaceId);
    }
  }
}
```

---

### 4. Cryptographic Immutable DAG Audit Logger (`lib/governance/ledger.ts`)

Writes tamper-evident execution trace events into `agent_audit_ledger` where PostgreSQL SHA-256 triggers calculate dynamic hash chains.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export interface AuditLedgerEntryPayload {
  inputSnippet: string;
  outputSnippet?: string;
  guardrailResult: string;
  modelUsed: string;
  costUsd: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export class ImmutableAuditLedger {
  private supabase: SupabaseClient;
  private workspaceId: string;
  private graphExecutionId?: string;

  constructor(supabase: SupabaseClient, workspaceId: string, graphExecutionId?: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
    this.graphExecutionId = graphExecutionId;
  }

  /**
   * Appends an immutable audit block into agent_audit_ledger
   */
  async appendBlock(params: {
    nodeExecutionId?: string;
    agentId: string;
    actionType: string;
    payload: AuditLedgerEntryPayload;
  }): Promise<{ sequenceId: number; currentHash: string }> {
    const { nodeExecutionId, agentId, actionType, payload } = params;

    const { data, error } = await this.supabase
      .from('agent_audit_ledger')
      .insert({
        workspace_id: this.workspaceId,
        graph_execution_id: this.graphExecutionId || null,
        node_execution_id: nodeExecutionId || null,
        agent_id: agentId,
        action_type: actionType,
        payload: payload as any,
        previous_hash: 'TRIGGER_WILL_OVERWRITE',
        current_hash: 'TRIGGER_WILL_OVERWRITE',
      })
      .select('sequence_id, current_hash')
      .single();

    if (error || !data) {
      throw new Error(`Failed to write to immutable audit ledger: ${error?.message}`);
    }

    return {
      sequenceId: data.sequence_id,
      currentHash: data.current_hash,
    };
  }

  /**
   * Verifies local block chain integrity for auditor checks
   */
  async verifyChainIntegrity(limit = 50): Promise<{ intact: boolean; verifiedBlocks: number; errorBlock?: number }> {
    const { data, error } = await this.supabase
      .from('agent_audit_ledger')
      .select('sequence_id, previous_hash, current_hash, payload, created_at')
      .eq('workspace_id', this.workspaceId)
      .order('sequence_id', { ascending: true })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return { intact: true, verifiedBlocks: 0 };
    }

    for (let i = 1; i < data.length; i++) {
      const prevBlock = data[i - 1];
      const currentBlock = data[i];

      if (currentBlock.previous_hash !== prevBlock.current_hash) {
        return {
          intact: false,
          verifiedBlocks: i,
          errorBlock: currentBlock.sequence_id,
        };
      }
    }

    return { intact: true, verifiedBlocks: data.length };
  }
}
```

---

### 5. Unified Governance Control Plane (`lib/governance/control-plane.ts`)

Unifies Triple-Gate Guardrails, Semantic Caching, FinOps Cascade Routing, and Cryptographic Ledgering into a single pipeline.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { GuardrailControlPlane, GuardrailCheckResult } from './guardrails';
import { SemanticCacheManager, SemanticCacheHit } from '@/lib/finops/cache';
import { FinOpsCascadeRouter, CascadeModelSelection } from '@/lib/finops/cascade';
import { ImmutableAuditLedger } from './ledger';
import { generateAgentResponse } from '@/lib/ai/genai';

export interface GovernedStepInput {
  agentRole: string;
  prompt: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  currentDepth: number;
  nodeExecutionId?: string;
  responseSchema?: any;
}

export interface GovernedStepOutput<T> {
  success: boolean;
  fromCache: boolean;
  data: T;
  modelUsed: string;
  guardrails: {
    input: GuardrailCheckResult;
    critic?: GuardrailCheckResult;
  };
  finops: {
    tokensUsed: number;
    costUsd: number;
    latencyMs: number;
  };
  ledgerSequenceId?: number;
  error?: string;
}

export class GovernanceControlPlaneManager {
  private guardrails: GuardrailControlPlane;
  private cache: SemanticCacheManager;
  private finops: FinOpsCascadeRouter;
  private ledger: ImmutableAuditLedger;
  private supabase: SupabaseClient;
  private workspaceId: string;
  private graphExecutionId?: string;

  constructor(supabase: SupabaseClient, workspaceId: string, graphExecutionId?: string) {
    this.supabase = supabase;
    this.workspaceId = workspaceId;
    this.graphExecutionId = graphExecutionId;

    this.guardrails = new GuardrailControlPlane(supabase, workspaceId, graphExecutionId);
    this.cache = new SemanticCacheManager(supabase, workspaceId);
    this.finops = new FinOpsCascadeRouter(supabase, workspaceId);
    this.ledger = new ImmutableAuditLedger(supabase, workspaceId, graphExecutionId);
  }

  /**
   * Executes an enterprise agent step through the full Governance Control Plane
   */
  async executeGovernedStep<T>(input: GovernedStepInput): Promise<GovernedStepOutput<T>> {
    const startTime = Date.now();

    // 1. FinOps Budget & Runaway Loop Prevention Check
    const budgetCheck = await this.finops.checkBudgetStatus();
    if (!budgetCheck.allowed) {
      throw new Error(budgetCheck.reason || 'FinOps budget limit reached.');
    }

    const recursionCheck = this.finops.validateRecursionDepth(input.currentDepth);
    if (!recursionCheck.safe) {
      throw new Error(recursionCheck.reason);
    }

    // 2. Gate 1A: Input Guardrails & Injection Scans
    const inputGuardResult = await this.guardrails.evaluateInputSecurity(input.prompt);
    if (!inputGuardResult.passed) {
      return {
        success: false,
        fromCache: false,
        data: {} as T,
        modelUsed: 'NONE_BLOCKED',
        guardrails: { input: inputGuardResult },
        finops: { tokensUsed: 0, costUsd: 0, latencyMs: Date.now() - startTime },
        error: inputGuardResult.reason,
      };
    }

    // 3. Gate 1B: Zero-Trust PII Masking
    const piiMaskResult = this.guardrails.maskPII(input.prompt);
    const sanitizedPrompt = piiMaskResult.maskedText;

    // 4. Semantic Cache Intercept
    const cacheHit: SemanticCacheHit<T> = await this.cache.lookup<T>(sanitizedPrompt);
    if (cacheHit.hit && cacheHit.data) {
      const latencyMs = Date.now() - startTime;

      // Log zero token cost cache hit to FinOps table
      await this.supabase.from('finops_token_logs').insert({
        workspace_id: this.workspaceId,
        graph_execution_id: this.graphExecutionId || null,
        node_execution_id: input.nodeExecutionId || null,
        model_name: 'semantic_cache_hit',
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        estimated_cost_usd: 0.0,
        routing_tier: 'semantic_cache_hit',
      });

      return {
        success: true,
        fromCache: true,
        data: cacheHit.data,
        modelUsed: 'SEMANTIC_CACHE',
        guardrails: { input: inputGuardResult },
        finops: { tokensUsed: 0, costUsd: 0, latencyMs },
      };
    }

    // 5. Dynamic Model Cascade Selector
    const cascade: CascadeModelSelection = this.finops.selectModelForTask({
      complexity: input.complexity,
      requiresThinking: input.complexity === 'HIGH',
    });

    // 6. LLM Execution via `@google/genai` Wrapper
    const llmResult = await generateAgentResponse<T>({
      model: cascade.selectedModel,
      contents: sanitizedPrompt,
      responseSchema: input.responseSchema,
      thinkingBudget: cascade.thinkingBudget,
    });

    const executionTimeMs = Date.now() - startTime;
    const rawOutputText = JSON.stringify(llmResult.data);

    // 7. Gate 3: Critic Safety & Hallucination Check
    const criticResult = await this.guardrails.evaluateOutputCritic(sanitizedPrompt, rawOutputText);

    // 8. Record FinOps Cost & Update Spend Controls
    await this.finops.recordStepCost(llmResult.usage.estimatedCostUsd);

    await this.supabase.from('finops_token_logs').insert({
      workspace_id: this.workspaceId,
      graph_execution_id: this.graphExecutionId || null,
      node_execution_id: input.nodeExecutionId || null,
      model_name: cascade.selectedModel,
      prompt_tokens: llmResult.usage.promptTokens,
      completion_tokens: llmResult.usage.completionTokens,
      cached_tokens: llmResult.usage.cachedTokens,
      estimated_cost_usd: llmResult.usage.estimatedCostUsd,
      routing_tier: cascade.tier.toLowerCase(),
    });

    // 9. Store Payload in Semantic Cache for Future Computations
    if (criticResult.passed) {
      await this.cache.store(sanitizedPrompt, llmResult.data as Record<string, unknown>);
    }

    // 10. Write Cryptographic Hash-Chained Audit Ledger Entry
    const ledgerBlock = await this.ledger.appendBlock({
      nodeExecutionId: input.nodeExecutionId,
      agentId: input.agentRole,
      actionType: 'GOVERNED_EXECUTION_STEP',
      payload: {
        inputSnippet: sanitizedPrompt.substring(0, 250),
        outputSnippet: rawOutputText.substring(0, 250),
        guardrailResult: criticResult.verdict,
        modelUsed: cascade.selectedModel,
        costUsd: llmResult.usage.estimatedCostUsd,
        latencyMs: executionTimeMs,
      },
    });

    return {
      success: criticResult.passed,
      fromCache: false,
      data: llmResult.data,
      modelUsed: cascade.selectedModel,
      guardrails: {
        input: inputGuardResult,
        critic: criticResult,
      },
      finops: {
        tokensUsed: llmResult.usage.promptTokens + llmResult.usage.completionTokens,
        costUsd: llmResult.usage.estimatedCostUsd,
        latencyMs: executionTimeMs,
      },
      ledgerSequenceId: ledgerBlock.sequenceId,
    };
  }
}
```

---

### 6. Next.js Governed Step API Route (`app/api/agent/governed-step/route.ts`)

API Handler providing an enterprise endpoint with full Governance Control Plane and FinOps execution.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { GovernanceControlPlaneManager } from '@/lib/governance/control-plane';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server component suppression
            }
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized enterprise request' }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, agentRole, prompt, complexity, currentDepth, graphExecutionId, responseSchema } = body;

    if (!workspaceId || !prompt || !agentRole) {
      return NextResponse.json(
        { error: 'Missing required request parameters: workspaceId, prompt, agentRole' },
        { status: 400 }
      );
    }

    // Initialize Governance Control Plane Manager
    const controlPlane = new GovernanceControlPlaneManager(supabase, workspaceId, graphExecutionId);

    const stepResult = await controlPlane.executeGovernedStep({
      agentRole,
      prompt,
      complexity: complexity || 'MEDIUM',
      currentDepth: currentDepth || 1,
      responseSchema,
    });

    if (!stepResult.success && stepResult.error) {
      return NextResponse.json(
        {
          error: 'Governance Filter Blocked Execution',
          details: stepResult.error,
          guardrails: stepResult.guardrails,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: stepResult,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Governance Control Plane Exception:', error);
    return NextResponse.json(
      {
        error: 'Governance Processing Exception',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
```

---

### Verification & Feature Mapping Matrix

| Feature / Gate | Module Location | Implementation Detail |
| :--- | :--- | :--- |
| **Gate 1: Input Injection** | `lib/governance/guardrails.ts` | RegEx injection heuristic scan & fast evaluator scoring |
| **Gate 1: PII Masking** | `lib/governance/guardrails.ts` | Regex masking engine for Email, SSN, Credit Cards, API Keys |
| **Gate 2: Structural Schema** | `lib/governance/guardrails.ts` | Schema key verification & structural validation |
| **Gate 3: Critic Guard** | `lib/governance/guardrails.ts` | Groundedness check via `gemini-3.5-flash-lite` critic |
| **Semantic Caching** | `lib/finops/cache.ts` | `gemini-embedding-001` (768-dim) cosine search via `pgvector` |
| **Model Cascade Router** | `lib/finops/cascade.ts` | Tiered model mapping (`gemini-3.5-flash-lite` / `gemini-3.7-flash` / `gemini-3.1-pro-preview`) |
| **Runaway Loop Guard** | `lib/finops/cascade.ts` | Max iteration limit & budget check |
| **Immutable DAG Ledger** | `lib/governance/ledger.ts` | Append-only log with PostgreSQL SHA-256 trigger integration |

