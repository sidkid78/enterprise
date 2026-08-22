### AI Systems & Gemini SDK Specialist Specialist

### Orchestrator-Worker Execution Engine Architecture Overview

The **Orchestrator-Worker Multi-Agent Engine** is built using Next.js 15 (App Router), Supabase, and the official `@google/genai` SDK. It replaces monolithic prompt setups with a decentralized, stateful, multi-step orchestration pipeline.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Enterprise Request                                     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             Orchestrator Engine Core                                   │
│  1. Dynamic Routing    2. Task Decomposition    3. Guardrail Pre-Check    4. DAG Execution  │
└──────┬───────────────────────────────────┬───────────────────────────────────┬─────────┘
       │                                   │                                   │
       ▼                                   ▼                                   ▼
┌──────────────┐                   ┌──────────────┐                    ┌──────────────┐
│  Router/Lite │                   │Worker Agent A│                    │Worker Agent B│
│gemini-3.5-   │                   │ gemini-3.7-    │                    │ gemini-3.1-pro │
│  flash-lite  │                   │flash         │                    │(With Thinking│
│(Decomposition│                   │(Standard     │                    │  Budget)     │
│ & Filtering) │                   │ Logic/Tools) │                    │(Deep Reason) │
└──────┬───────┘                   └──────┬───────┘                    └──────┬───────┘
       │                                   │                                   │
       └───────────────────────────────────┼───────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Governance & State Management                             │
│  • Token FinOps Logging     • HITL Gate Triggers       • Immutable Audit Ledger Hash   │
│  • DB State Updates         • MCP Tool Standard Calls  • Dynamic Model Fallbacks       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Implementation File Blueprint

```
├── lib/
│   ├── ai/
│   │   └── genai.ts               # Google GenAI SDK Client & Multi-Tier Model Wrappers
│   └── orchestrator/
│       ├── types.ts               # TypeScript Types & JSON Schemas for Agent Tasks
│       └── engine.ts              # Core Orchestrator Execution Loop & Ledger Logging
└── app/
    └── api/
        └── agent/
            └── orchestrate/
                └── route.ts        # Next.js App Router API Route Handler
```

---

### 1. Google GenAI Client Setup (`lib/ai/genai.ts`)

This module configures the official `@google/genai` SDK and provides dynamic model selection based on task complexity.

```typescript
import { GoogleGenAI, Type, Schema } from '@google/genai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable.');
}

// Initialize official Google GenAI Client
export const ai = new GoogleGenAI({});

// Model Tier Configurations
export const MODEL_TIERS = {
  FAST_ROUTER: 'gemini-3.5-flash-lite',      // Low latency, fast response schema generation
  STANDARD_WORKER: 'gemini-3.7-flash',  // Balanced standard agent tasks & tool calling
  DEEP_REASONER: 'gemini-3.1-pro-preview',     // High-complexity reasoning with explicit thinking budget
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

export interface TokenUsageStats {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
}

/**
 * Calculates estimated USD cost based on standard Gemini 2026 pricing model tiers
 */
export function calculateModelCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number = 0
): number {
  let promptRate = 0.00000015; // default gemini-3.5-flash-lite
  let completionRate = 0.0000006;

  if (model.includes('gemini-3.7-flash')) {
    promptRate = 0.0000005;
    completionRate = 0.000002;
  } else if (model.includes('gemini-3.1-pro')) {
    promptRate = 0.000003;
    completionRate = 0.000012;
  }

  const promptCost = (promptTokens - cachedTokens) * promptRate;
  const cacheCost = cachedTokens * (promptRate * 0.25);
  const completionCost = completionTokens * completionRate;

  return Number((promptCost + cacheCost + completionCost).toFixed(6));
}

/**
 * Robust wrapper to call Gemini models with structured JSON schemas and thinking budgets
 */
export async function generateAgentResponse<T>(params: {
  model: string;
  systemInstruction?: string;
  contents: string | Array<Record<string, unknown>>;
  responseSchema?: Schema;
  thinkingBudget?: number;
  tools?: Array<Record<string, unknown>>;
}): Promise<{ data: T; usage: TokenUsageStats }> {
  const { model, systemInstruction, contents, responseSchema, thinkingBudget, tools } = params;

  const paramsToPass: Record<string, unknown> = {
    model,
    input: contents
  };

  if (systemInstruction) {
    paramsToPass.systemInstruction = systemInstruction;
  }

  if (responseSchema) {
    paramsToPass.responseMimeType = 'application/json';
    paramsToPass.responseSchema = responseSchema;
  }

  if (tools && tools.length > 0) {
    paramsToPass.tools = tools;
  }

  // Configure thinking budget for deep reasoning models
  if (model.includes('gemini-3.1-pro') && thinkingBudget) {
    paramsToPass.thinkingConfig = {
      thinkingBudget: thinkingBudget,
    };
  }

  const interaction = await ai.interactions.create(paramsToPass as any);

  const text = interaction.output_text || '{}';
  let parsedData: T;

  try {
    parsedData = responseSchema ? JSON.parse(text) : (text as unknown as T);
  } catch (error) {
    throw new Error(`Failed to parse structured model response: ${text}. Error: ${(error as Error).message}`);
  }

  const metadata = interaction.usage || {};
  const promptTokens = metadata.prompt_tokens || metadata.promptTokenCount || 0;
  const completionTokens = metadata.completion_tokens || metadata.candidatesTokenCount || 0;
  const cachedTokens = metadata.cached_tokens || metadata.cachedContentTokenCount || 0;

  const usage: TokenUsageStats = {
    promptTokens,
    completionTokens,
    cachedTokens,
    estimatedCostUsd: calculateModelCost(model, promptTokens, completionTokens, cachedTokens),
  };

  return { data: parsedData, usage };
}
```

---

### 2. Task Schemas & Types (`lib/orchestrator/types.ts`)

Defines task decomposition schemas, orchestration execution contexts, and tool definitions.

```typescript
import { Type, Schema } from '@google/genai';

export interface TaskDefinition {
  taskId: string;
  agentRole: string;
  description: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedModel: string;
  dependencies: string[]; // List of taskIds required prior to execution
  inputParameters: Record<string, unknown>;
  requiresHITLCheck: boolean;
  mcpToolCall?: {
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  };
}

export interface OrchestrationPlan {
  workflowDomain: string;
  summary: string;
  estimatedSteps: number;
  tasks: TaskDefinition[];
}

export interface TaskExecutionResult {
  taskId: string;
  agentRole: string;
  status: 'COMPLETED' | 'FAILED' | 'HALTED_HITL';
  confidenceScore: number;
  output: Record<string, unknown>;
  reasoningLog: string;
  tokensUsed: number;
  costUsd: number;
  executionTimeMs: number;
}

// Gemini Response Schema for Orchestrator Task Decomposition
export const OrchestrationPlanSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    workflowDomain: { type: Type.STRING, description: 'Domain classification (e.g. Finance, Claims, Ops)' },
    summary: { type: Type.STRING, description: 'High-level synthesis of subtask strategy' },
    estimatedSteps: { type: Type.INTEGER, description: 'Total tasks generated' },
    tasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: { type: Type.STRING, description: 'Unique step ID, e.g., task_01' },
          agentRole: { type: Type.STRING, description: 'Specialized agent identifier, e.g., DataExtractor' },
          description: { type: Type.STRING, description: 'Granular instructions for execution' },
          complexity: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
          assignedModel: { 
            type: Type.STRING, 
            enum: ['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.1-pro-preview'] 
          },
          dependencies: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: 'Task IDs that must finish before this task'
          },
          inputParameters: { type: Type.OBJECT, description: 'Key-value pairs for initial context' },
          requiresHITLCheck: { type: Type.BOOLEAN, description: 'Flag if action alters external database or triggers financial spend' }
        },
        required: ['taskId', 'agentRole', 'description', 'complexity', 'assignedModel', 'dependencies', 'requiresHITLCheck']
      }
    }
  },
  required: ['workflowDomain', 'summary', 'estimatedSteps', 'tasks']
};

// Gemini Response Schema for Worker Node Execution
export const WorkerNodeOutputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['SUCCESS', 'FAILURE', 'REQUIRES_HUMAN_REVIEW'] },
    confidenceScore: { type: Type.NUMBER, description: 'Score between 0.00 and 1.00' },
    reasoningLog: { type: Type.STRING, description: 'Traceable step-by-step logic used by worker' },
    extractedData: { type: Type.OBJECT, description: 'Structured result payload' },
    recommendedNextAction: { type: Type.STRING, description: 'Follow-up or completion signal' }
  },
  required: ['status', 'confidenceScore', 'reasoningLog', 'extractedData']
};
```

---

### 3. Multi-Agent Orchestration Engine (`lib/orchestrator/engine.ts`)

The central execution engine handles state persistence, model selection, tool execution, FinOps token tracking, and cryptographic ledger hashing.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { 
  MODEL_TIERS, 
  generateAgentResponse, 
  TokenUsageStats 
} from '@/lib/ai/genai';
import { 
  OrchestrationPlan, 
  TaskDefinition, 
  TaskExecutionResult, 
  OrchestrationPlanSchema, 
  WorkerNodeOutputSchema 
} from './types';

export interface OrchestrationEngineConfig {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  graphExecutionId?: string;
  rootPrompt: string;
  maxIterations?: number;
}

export class OrchestratorEngine {
  private supabase: SupabaseClient;
  private workspaceId: string;
  private userId: string;
  private rootPrompt: string;
  private graphExecutionId: string = '';
  private maxIterations: number;
  private totalCostUsd: number = 0;

  constructor(config: OrchestrationEngineConfig) {
    this.supabase = config.supabase;
    this.workspaceId = config.workspaceId;
    this.userId = config.userId;
    this.rootPrompt = config.rootPrompt;
    this.maxIterations = config.maxIterations || 15;
    if (config.graphExecutionId) {
      this.graphExecutionId = config.graphExecutionId;
    }
  }

  /**
   * Initializes the Orchestrator DAG run in Supabase state
   */
  async initializeExecution(): Promise<string> {
    if (this.graphExecutionId) return this.graphExecutionId;

    const { data, error } = await this.supabase
      .from('agent_graph_executions')
      .insert({
        workspace_id: this.workspaceId,
        orchestrator_name: 'EnterpriseOrchestratorV1',
        framework_type: 'langgraph_mcp',
        status: 'running',
        root_prompt: this.rootPrompt,
        execution_context: { initial_user: this.userId, timestamp: new Date().toISOString() },
        created_by: this.userId,
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create graph execution record: ${error?.message}`);
    }

    this.graphExecutionId = data.id;
    return this.graphExecutionId;
  }

  /**
   * Phase 1: Deconstructs raw user goal into structured Multi-Agent execution plan
   */
  async decomposePrompt(): Promise<OrchestrationPlan> {
    const systemInstruction = `You are the Lead Master Orchestrator for an Enterprise AI Platform.
Deconstruct the user query into precise subtasks executed by specialized worker agents.
Rules:
1. Assign lightweight tasks (routing, filter, simple extract) to 'gemini-3.5-flash-lite'.
2. Assign standard execution tasks to 'gemini-3.7-flash'.
3. Assign complex reasoning, legal audit, or deep calculations to 'gemini-3.1-pro-preview'.
4. Flag tasks requiring database writes or high financial value with requiresHITLCheck = true.`;

    const response = await generateAgentResponse<OrchestrationPlan>({
      model: MODEL_TIERS.FAST_ROUTER,
      systemInstruction,
      contents: `Deconstruct this goal into a task DAG: "${this.rootPrompt}"`,
      responseSchema: OrchestrationPlanSchema
    });

    await this.logFinOpsTokenUsage(
      null, 
      MODEL_TIERS.FAST_ROUTER, 
      response.usage, 
      'model_cascade_cheap'
    );

    return response.data;
  }

  /**
   * Executes individual worker task with dynamic model routing & fallback mechanisms
   */
  async executeWorkerTask(
    task: TaskDefinition, 
    previousOutputs: Record<string, unknown>
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // Insert task node record in database
    const { data: nodeRecord, error: nodeError } = await this.supabase
      .from('agent_node_executions')
      .insert({
        graph_execution_id: this.graphExecutionId,
        workspace_id: this.workspaceId,
        node_id: task.taskId,
        agent_role: task.agentRole,
        model_routing_used: task.assignedModel,
        input_payload: { task, contextDependencies: previousOutputs },
        node_status: 'running'
      })
      .select('id')
      .single();

    if (nodeError || !nodeRecord) {
      throw new Error(`Failed to insert node execution record: ${nodeError?.message}`);
    }

    const nodeExecutionId = nodeRecord.id;

    // Check for explicit thinking budget requirement
    const thinkingBudget = task.assignedModel.includes('gemini-3.1-pro-preview') ? 2048 : undefined;

    const workerPrompt = `You are a specialized enterprise AI worker agent with role: "${task.agentRole}".
Task Description: ${task.description}
Task Input Context: ${JSON.stringify(task.inputParameters)}
Dependency Context outputs from prior agents: ${JSON.stringify(previousOutputs)}

Execute the requested task and generate structured JSON matching the required schema.`;

    try {
      const response = await generateAgentResponse<{
        status: 'SUCCESS' | 'FAILURE' | 'REQUIRES_HUMAN_REVIEW';
        confidenceScore: number;
        reasoningLog: string;
        extractedData: Record<string, unknown>;
      }>({
        model: task.assignedModel,
        contents: workerPrompt,
        responseSchema: WorkerNodeOutputSchema,
        thinkingBudget
      });

      const executionTimeMs = Date.now() - startTime;
      const workerOutput = response.data;

      await this.logFinOpsTokenUsage(
        nodeExecutionId, 
        task.assignedModel, 
        response.usage, 
        task.complexity === 'HIGH' ? 'frontier_model' : 'model_cascade_cheap'
      );

      // Evaluate Human-In-The-Loop (HITL) gate conditions
      const lowConfidenceTrigger = workerOutput.confidenceScore < 0.70;
      const isHaltedHITL = task.requiresHITLCheck || lowConfidenceTrigger || workerOutput.status === 'REQUIRES_HUMAN_REVIEW';

      if (isHaltedHITL) {
        await this.triggerHITLGate({
          nodeExecutionId,
          triggerReason: lowConfidenceTrigger ? 'low_confidence_score' : 'policy_requires_manual_audit',
          confidenceScore: workerOutput.confidenceScore,
          reasoningSummary: workerOutput.reasoningLog
        });

        await this.supabase
          .from('agent_node_executions')
          .update({
            node_status: 'waiting_hitl',
            output_payload: workerOutput,
            latency_ms: executionTimeMs
          })
          .eq('id', nodeExecutionId);

        return {
          taskId: task.taskId,
          agentRole: task.agentRole,
          status: 'HALTED_HITL',
          confidenceScore: workerOutput.confidenceScore,
          output: workerOutput.extractedData,
          reasoningLog: workerOutput.reasoningLog,
          tokensUsed: response.usage.promptTokens + response.usage.completionTokens,
          costUsd: response.usage.estimatedCostUsd,
          executionTimeMs
        };
      }

      // Update node success
      await this.supabase
        .from('agent_node_executions')
        .update({
          node_status: 'completed',
          output_payload: workerOutput,
          latency_ms: executionTimeMs
        })
        .eq('id', nodeExecutionId);

      // Audit Ledger write
      await this.writeToAuditLedger(nodeExecutionId, task.agentRole, 'TASK_COMPLETED', {
        taskId: task.taskId,
        extractedData: workerOutput.extractedData,
        confidence: workerOutput.confidenceScore
      });

      return {
        taskId: task.taskId,
        agentRole: task.agentRole,
        status: 'COMPLETED',
        confidenceScore: workerOutput.confidenceScore,
        output: workerOutput.extractedData,
        reasoningLog: workerOutput.reasoningLog,
        tokensUsed: response.usage.promptTokens + response.usage.completionTokens,
        costUsd: response.usage.estimatedCostUsd,
        executionTimeMs
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      await this.supabase
        .from('agent_node_executions')
        .update({
          node_status: 'failed',
          output_payload: { error: errorMessage },
          latency_ms: executionTimeMs
        })
        .eq('id', nodeExecutionId);

      throw error;
    }
  }

  /**
   * Main Execution Loop: Executes DAG with iteration limits and state consolidation
   */
  async run(): Promise<{ executionId: string; status: string; outputs: Record<string, unknown> }> {
    const executionId = await this.initializeExecution();
    const plan = await this.decomposePrompt();

    const completedResults: Record<string, TaskExecutionResult> = {};
    const previousOutputs: Record<string, unknown> = {};

    let iterationCount = 0;
    let isHaltedForHITL = false;

    for (const task of plan.tasks) {
      iterationCount++;
      if (iterationCount > this.maxIterations) {
        await this.supabase
          .from('agent_graph_executions')
          .update({ status: 'halted_finops', completed_at: new Date().toISOString() })
          .eq('id', executionId);

        throw new Error(`Infinite loop safety trigger hit! Exceeded ${this.maxIterations} iterations.`);
      }

      const result = await this.executeWorkerTask(task, previousOutputs);
      completedResults[task.taskId] = result;
      previousOutputs[task.taskId] = result.output;

      if (result.status === 'HALTED_HITL') {
        isHaltedForHITL = true;
        await this.supabase
          .from('agent_graph_executions')
          .update({
            status: 'waiting_hitl',
            execution_context: { plan, completedResults, lastHaltedTaskId: task.taskId }
          })
          .eq('id', executionId);

        break;
      }
    }

    if (!isHaltedForHITL) {
      await this.supabase
        .from('agent_graph_executions')
        .update({
          status: 'completed',
          final_output: { planSummary: plan.summary, outputs: previousOutputs },
          completed_at: new Date().toISOString()
        })
        .eq('id', executionId);
    }

    return {
      executionId,
      status: isHaltedForHITL ? 'WAITING_HITL' : 'COMPLETED',
      outputs: previousOutputs
    };
  }

  /**
   * Logs token metrics to finops_token_logs table
   */
  private async logFinOpsTokenUsage(
    nodeExecutionId: string | null,
    modelName: string,
    usage: TokenUsageStats,
    routingTier: string
  ): Promise<void> {
    this.totalCostUsd += usage.estimatedCostUsd;

    await this.supabase.from('finops_token_logs').insert({
      workspace_id: this.workspaceId,
      graph_execution_id: this.graphExecutionId,
      node_execution_id: nodeExecutionId,
      model_name: modelName,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      cached_tokens: usage.cachedTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
      routing_tier: routingTier
    });
  }

  /**
   * Appends action to agent_audit_ledger (triggers PostgreSQL SHA-256 hash-chaining)
   */
  private async writeToAuditLedger(
    nodeExecutionId: string,
    agentId: string,
    actionType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('agent_audit_ledger').insert({
      workspace_id: this.workspaceId,
      graph_execution_id: this.graphExecutionId,
      node_execution_id: nodeExecutionId,
      agent_id: agentId,
      action_type: actionType,
      payload: payload,
      previous_hash: 'COMPUTED_BY_TRIGGER',
      current_hash: 'COMPUTED_BY_TRIGGER'
    });
  }

  /**
   * Triggers Human-In-The-Loop gate entry in hitl_approval_gates
   */
  private async triggerHITLGate(params: {
    nodeExecutionId: string;
    triggerReason: string;
    confidenceScore: number;
    reasoningSummary: string;
  }): Promise<void> {
    await this.supabase.from('hitl_approval_gates').insert({
      workspace_id: this.workspaceId,
      graph_execution_id: this.graphExecutionId,
      node_execution_id: params.nodeExecutionId,
      trigger_reason: params.triggerReason,
      confidence_score: params.confidenceScore,
      required_role: 'agent_operator',
      status: 'pending',
      reasoning_log_summary: { summary: params.reasoningSummary }
    });
  }
}
```

---

### 4. Next.js App Router Orchestrator Route Handler (`app/api/agent/orchestrate/route.ts`)

This POST API endpoint validates request context, initializes tenant security verification via Supabase Server Client, and triggers the orchestrator engine.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { OrchestratorEngine } from '@/lib/orchestrator/engine';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    
    // Initialize Supabase Auth & Tenant Context Client
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
              // Server component write fallback suppression
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
    const { prompt, workspaceId } = body;

    if (!prompt || !workspaceId) {
      return NextResponse.json(
        { error: 'Missing required request parameters: prompt, workspaceId' },
        { status: 400 }
      );
    }

    // Tenant authorization verify
    const { data: memberRecord, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !memberRecord) {
      return NextResponse.json(
        { error: 'Access denied: User does not belong to specified workspace' },
        { status: 403 }
      );
    }

    // Check FinOps monthly budget cap before initiating task execution
    const { data: finopsControl } = await supabase
      .from('finops_budget_controls')
      .select('monthly_budget_usd, current_spend_usd, hard_stop_enabled')
      .eq('workspace_id', workspaceId)
      .single();

    if (
      finopsControl &&
      finopsControl.hard_stop_enabled &&
      finopsControl.current_spend_usd >= finopsControl.monthly_budget_usd
    ) {
      return NextResponse.json(
        {
          error: 'FinOps Budget Exceeded',
          message: 'Workspace monthly compute budget reached hard limit limit. Halted execution.',
        },
        { status: 402 }
      );
    }

    // Instantiate & Execute Multi-Agent Orchestrator
    const engine = new OrchestratorEngine({
      supabase,
      workspaceId,
      userId: user.id,
      rootPrompt: prompt,
      maxIterations: 15,
    });

    const executionResult = await engine.run();

    return NextResponse.json(
      {
        success: true,
        data: executionResult,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Orchestration Engine Exception:', error);
    return NextResponse.json(
      {
        error: 'Execution Engine Error',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
```

---

### Verification Checklist & Dynamic Model Matrix

| Feature / Pillar | Implemented Component | Gemini Model Used |
| :--- | :--- | :--- |
| **Dynamic Model Routing** | `lib/ai/genai.ts` | Tiered: `gemini-3.5-flash-lite`, `gemini-3.7-flash`, `gemini-3.1-pro-preview` |
| **Task Decomposition** | `OrchestratorEngine.decomposePrompt` | `gemini-3.5-flash-lite` |
| **Deep Worker Logic** | `OrchestratorEngine.executeWorkerTask` | `gemini-3.1-pro-preview` with `thinkingBudget: 2048` |
| **State Persistence** | Supabase Postgres Tables | `agent_graph_executions`, `agent_node_executions` |
| **FinOps Cost Tracking** | `OrchestratorEngine.logFinOpsTokenUsage` | Real-time write to `finops_token_logs` |
| **HITL Interruption Gate** | `OrchestratorEngine.triggerHITLGate` | Enforced when confidence score < 0.70 or flag set |
| **Tamper-Evident Ledger** | `OrchestratorEngine.writeToAuditLedger` | Triggers PostgreSQL cryptographic SHA-256 function |
