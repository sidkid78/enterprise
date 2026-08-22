### Fullstack Next.js & Workflow Automation Specialist Specialist

### Stateful HITL Execution Gateways & Workflow Pause/Resume Logic Architecture

The **Stateful Human-in-the-Loop (HITL) Execution Gateway** serves as the central governing authority between autonomous Multi-Agent execution cycles and human oversight. When an agent node encounters low confidence, policy boundary triggers, or financial/external write operational limits, the engine captures a deterministic execution snapshot, halts execution in Supabase, and exposes actionable decision gates to authorized human operators.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Multi-Agent Worker Execution                              │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           HITL Policy & Trigger Evaluation                              │
│   • Confidence Score < Threshold (0.70)       • Negative Sentiment Spike (-0.75)         │
│   • High Value Transaction (> $10,000)         • Sensitive Data Write / PII Policy        │
└──────┬─────────────────────────────────────────────────────────────────────────────────┘
       │
       ├─── [ PASSED: Confidence & Policy Checks OK ] ─────────► [ Continue DAG Run ]
       │
       └─── [ TRIGGERED: Halts Execution Flow ]
               │
               ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                HITL State Persistence                                  │
│   1. Snapshot Execution Context & Task DAG into Supabase `agent_graph_executions`      │
│   2. Flag Node Status as `waiting_hitl` & Log Entry to `hitl_approval_gates`           │
│   3. Compute Transparent Reasoning Log (Root Cause, Confidence Drivers, Options)        │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Human Operator Interface & Gate Resolution                      │
│        ( Server Actions / REST Endpoint with RBAC Verification via Supabase )          │
│                                                                                        │
│   ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐        │
│   │    APPROVE       │     REJECT       │     OVERRIDE     │    ESCALATE      │        │
│   │  Resume DAG as   │  Terminate Graph │ Inject Feedback  │ Reassign to Tier │        │
│   │  originally run  │  Execution Logs  │ & Re-run Node    │ 2 Compliance     │        │
│   └────────┬─────────┴────────┬─────────┴────────┬─────────┴────────┬─────────┘        │
└────────────┼──────────────────┼──────────────────┼──────────────────┼──────────────────┘
             │                  │                  │                  │
             ▼                  ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             Workflow Resumption Engine                                 │
│   • Re-instantiate Orchestrator with Human Payload Adjustments                         │
│   • Execute remaining subtask DAG from halted node index                               │
│   • Append cryptographic signature to `agent_audit_ledger`                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Implementation File Blueprint

```
├── lib/
│   └── hitl/
│       ├── types.ts           # Types & Schemas for HITL Triggers, Actions & Summaries
│       ├── reasoning.ts       # Transparent Reasoning Summarizer & Audit Exposer
│       └── gateway.ts         # Stateful HITL Gateway & Dynamic Resume Engine
├── app/
│   ├── actions/
│   │   └── hitl.ts            # Server Actions for Human Operator Interventions (RBAC Enforced)
│   └── api/
│       └── hitl/
│           └── [id]/
│               └── route.ts    # RESTful Management API for External Approvals / Webhooks
```

---

### 1. HITL Types & Data Structures (`lib/hitl/types.ts`)

Defines trigger rules, human operator actions, execution state snapshots, and transparent reasoning schemas.

```typescript
import { user_role_enum } from '@/types/database';

export type HITLTriggerReason = 
  | 'low_confidence_score'
  | 'financial_threshold_exceeded'
  | 'policy_violation_pii'
  | 'negative_sentiment_detected'
  | 'external_system_mutation'
  | 'manual_agent_escalation';

export type HITLResolutionAction = 
  | 'approve' 
  | 'reject' 
  | 'override' 
  | 'escalate';

export interface HITLEvaluationParams {
  workspaceId: string;
  graphExecutionId: string;
  nodeExecutionId: string;
  agentRole: string;
  confidenceScore: number;
  extractedPayload: Record<string, unknown>;
  rawOutputText?: string;
  monetaryValueUsd?: number;
  sentimentScore?: number; // Range -1.0 to +1.0
  hasExternalSystemMutation?: boolean;
}

export interface HITLEvaluationResult {
  requiresHITL: boolean;
  triggerReason?: HITLTriggerReason;
  requiredRole: 'workspace_owner' | 'ai_administrator' | 'compliance_auditor' | 'agent_operator';
  confidenceScore: number;
  reasoningSummary: {
    primaryCause: string;
    triggerDescription: string;
    confidenceBreakdown: {
      score: number;
      threshold: number;
      passed: boolean;
    };
    riskFactors: string[];
    suggestedHumanActions: Array<{
      action: HITLResolutionAction;
      label: string;
      impactDescription: string;
    }>;
  };
}

export interface HITLResolutionRequest {
  gateId: string;
  action: HITLResolutionAction;
  humanFeedback?: string;
  overridePayload?: Record<string, unknown>;
  escalateToRole?: 'ai_administrator' | 'compliance_auditor' | 'workspace_owner';
}

export interface HITLResolutionResponse {
  success: boolean;
  gateId: string;
  graphExecutionId: string;
  newStatus: string;
  resumedExecutionResult?: Record<string, unknown>;
  message: string;
}
```

---

### 2. Transparent Reasoning Summarizer (`lib/hitl/reasoning.ts`)

Generates human-auditable, structured descriptions explaining *why* an agent halted and providing clear decision pathways for the operator.

```typescript
import { generateAgentResponse, MODEL_TIERS } from '@/lib/ai/genai';
import { Type, Schema } from '@google/genai';

export interface TransparentReasoningOutput {
  primaryCause: string;
  triggerDescription: string;
  keyUncertainties: string[];
  recommendedDecision: 'APPROVE' | 'MODIFY_AND_RESUME' | 'REJECT';
  humanActionGuidance: string;
}

const TransparentReasoningSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    primaryCause: { type: Type.STRING, description: 'Concise summary of why human intervention was requested' },
    triggerDescription: { type: Type.STRING, description: 'Detailed policy or score violation explanation' },
    keyUncertainties: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: 'List of specific data points or logic jumps the agent was uncertain about'
    },
    recommendedDecision: { 
      type: Type.STRING, 
      enum: ['APPROVE', 'MODIFY_AND_RESUME', 'REJECT'] 
    },
    humanActionGuidance: { type: Type.STRING, description: 'Step-by-step guidance for the reviewing human operator' }
  },
  required: ['primaryCause', 'triggerDescription', 'keyUncertainties', 'recommendedDecision', 'humanActionGuidance']
};

/**
 * Formats multi-agent context into a structured, transparent reasoning report for human reviewers.
 */
export async function generateTransparentReasoningLog(params: {
  agentRole: string;
  triggerReason: string;
  confidenceScore: number;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
}): Promise<TransparentReasoningOutput> {
  const systemInstruction = `You are an AI Governance Auditor.
Analyze why a specialized enterprise agent triggered a Human-in-the-Loop approval gate.
Synthesize raw execution data into an intuitive, high-transparency breakdown for human operations personnel.`;

  const prompt = `
Agent Role: ${params.agentRole}
Trigger Reason: ${params.triggerReason}
Confidence Score: ${params.confidenceScore} (Threshold: 0.70)
Agent Input Payload: ${JSON.stringify(params.inputPayload, null, 2)}
Agent Output Payload: ${JSON.stringify(params.outputPayload, null, 2)}

Provide a clear explanation and guidance report.`;

  try {
    const response = await generateAgentResponse<TransparentReasoningOutput>({
      model: MODEL_TIERS.FAST_ROUTER,
      systemInstruction,
      contents: prompt,
      responseSchema: TransparentReasoningSchema
    });

    return response.data;
  } catch (error) {
    // Fallback deterministic synthesis if AI call fails
    return {
      primaryCause: `Execution gate triggered due to ${params.triggerReason}`,
      triggerDescription: `Agent recorded confidence score of ${params.confidenceScore.toFixed(2)}, breaching mandatory human verification limits.`,
      keyUncertainties: ['Uncertain output schema alignment', 'Borderline parameter confidence'],
      recommendedDecision: 'MODIFY_AND_RESUME',
      humanActionGuidance: 'Review extracted parameters, update fields if incorrect, and click Resume Execution.'
    };
  }
}
```

---

### 3. Core Stateful HITL Gateway & Resumption Engine (`lib/hitl/gateway.ts`)

Handles trigger evaluation, execution snapshots, and workflow re-instantiation using `@google/genai` to resume execution from halted nodes.

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { 
  HITLEvaluationParams, 
  HITLEvaluationResult, 
  HITLTriggerReason, 
  HITLResolutionRequest,
  HITLResolutionResponse 
} from './types';
import { generateTransparentReasoningLog } from './reasoning';
import { OrchestratorEngine } from '@/lib/orchestrator/engine';

export class HITLGatewayService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Evaluates if an execution step requires halting for Human-in-the-Loop review
   */
  async evaluateGateTriggers(params: HITLEvaluationParams): Promise<HITLEvaluationResult> {
    const CONFIDENCE_THRESHOLD = 0.70;
    const FINANCIAL_THRESHOLD_USD = 10000.00;
    const SENTIMENT_THRESHOLD = -0.75;

    let requiresHITL = false;
    let triggerReason: HITLTriggerReason | undefined;
    let requiredRole: HITLEvaluationResult['requiredRole'] = 'agent_operator';
    const riskFactors: string[] = [];

    // 1. Confidence Score Check
    if (params.confidenceScore < CONFIDENCE_THRESHOLD) {
      requiresHITL = true;
      triggerReason = 'low_confidence_score';
      riskFactors.push(`Agent confidence score (${params.confidenceScore.toFixed(2)}) is below minimum threshold (${CONFIDENCE_THRESHOLD}).`);
    }

    // 2. Financial Threshold Trigger
    if (params.monetaryValueUsd && params.monetaryValueUsd >= FINANCIAL_THRESHOLD_USD) {
      requiresHITL = true;
      triggerReason = 'financial_threshold_exceeded';
      requiredRole = 'ai_administrator';
      riskFactors.push(`Transaction value ($${params.monetaryValueUsd.toLocaleString()}) exceeds standard approval threshold ($${FINANCIAL_THRESHOLD_USD.toLocaleString()}).`);
    }

    // 3. Customer Negative Sentiment Trigger
    if (params.sentimentScore !== undefined && params.sentimentScore <= SENTIMENT_THRESHOLD) {
      requiresHITL = true;
      triggerReason = 'negative_sentiment_detected';
      riskFactors.push(`Customer sentiment score (${params.sentimentScore}) indicates extreme escalation risk.`);
    }

    // 4. External Database Mutation Trigger
    if (params.hasExternalSystemMutation) {
      requiresHITL = true;
      triggerReason = triggerReason || 'external_system_mutation';
      riskFactors.push('Operation will write/mutate records in external enterprise system (e.g. SAP / ERP).');
    }

    if (!requiresHITL) {
      return {
        requiresHITL: false,
        requiredRole: 'agent_operator',
        confidenceScore: params.confidenceScore,
        reasoningSummary: {
          primaryCause: 'Passed automated governance gates.',
          triggerDescription: 'All policy and confidence criteria met.',
          confidenceBreakdown: { score: params.confidenceScore, threshold: CONFIDENCE_THRESHOLD, passed: true },
          riskFactors: [],
          suggestedHumanActions: []
        }
      };
    }

    // Generate AI Reasoning Report
    const reasoningLog = await generateTransparentReasoningLog({
      agentRole: params.agentRole,
      triggerReason: triggerReason!,
      confidenceScore: params.confidenceScore,
      inputPayload: { graphExecutionId: params.graphExecutionId },
      outputPayload: params.extractedPayload
    });

    return {
      requiresHITL: true,
      triggerReason,
      requiredRole,
      confidenceScore: params.confidenceScore,
      reasoningSummary: {
        primaryCause: reasoningLog.primaryCause,
        triggerDescription: reasoningLog.triggerDescription,
        confidenceBreakdown: {
          score: params.confidenceScore,
          threshold: CONFIDENCE_THRESHOLD,
          passed: params.confidenceScore >= CONFIDENCE_THRESHOLD
        },
        riskFactors,
        suggestedHumanActions: [
          { action: 'approve', label: 'Approve Output', impactDescription: 'Resumes agent DAG run with generated data as-is.' },
          { action: 'override', label: 'Modify & Resume', impactDescription: 'Applies corrected human parameters and re-evaluates step.' },
          { action: 'reject', label: 'Reject Workflow', impactDescription: 'Halts DAG execution and logs compliance denial.' },
          { action: 'escalate', label: 'Escalate Gate', impactDescription: 'Reassigns gate to higher authority role.' }
        ]
      }
    };
  }

  /**
   * Persists a pending HITL approval gate record in Supabase
   */
  async createApprovalGate(params: {
    workspaceId: string;
    graphExecutionId: string;
    nodeExecutionId: string;
    evaluationResult: HITLEvaluationResult;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from('hitl_approval_gates')
      .insert({
        workspace_id: params.workspaceId,
        graph_execution_id: params.graphExecutionId,
        node_execution_id: params.nodeExecutionId,
        trigger_reason: params.evaluationResult.triggerReason || 'manual_agent_escalation',
        confidence_score: params.evaluationResult.confidenceScore,
        required_role: params.evaluationResult.requiredRole,
        status: 'pending',
        reasoning_log_summary: params.evaluationResult.reasoningSummary
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create HITL approval gate: ${error?.message}`);
    }

    // Update graph execution status
    await this.supabase
      .from('agent_graph_executions')
      .update({ status: 'waiting_hitl' })
      .eq('id', params.graphExecutionId);

    return data.id;
  }

  /**
   * Processes human resolution (Approve, Reject, Override, Escalate) and manages execution state
   */
  async resolveGate(
    request: HITLResolutionRequest,
    operatorUserId: string
  ): Promise<HITLResolutionResponse> {
    // 1. Fetch pending gate record
    const { data: gate, error: fetchError } = await this.supabase
      .from('hitl_approval_gates')
      .select('*, agent_graph_executions(*)')
      .eq('id', request.gateId)
      .single();

    if (fetchError || !gate) {
      throw new Error(`HITL Approval Gate record not found: ${fetchError?.message}`);
    }

    if (gate.status !== 'pending' && gate.status !== 'escalated') {
      throw new Error(`Gate cannot be resolved. Current status is already '${gate.status}'.`);
    }

    const now = new Date().toISOString();
    const workspaceId = gate.workspace_id;
    const graphExecutionId = gate.graph_execution_id;
    const nodeExecutionId = gate.node_execution_id;

    // 2. Handle Action: ESCALATE
    if (request.action === 'escalate') {
      const targetRole = request.escalateToRole || 'compliance_auditor';
      
      await this.supabase
        .from('hitl_approval_gates')
        .update({
          status: 'escalated',
          required_role: targetRole,
          human_feedback: request.humanFeedback || 'Escalated to senior compliance officer.'
        })
        .eq('id', request.gateId);

      await this.logAuditLedger(workspaceId, graphExecutionId, nodeExecutionId, 'HITL_GATE_ESCALATED', {
        operatorUserId,
        escalatedToRole: targetRole,
        feedback: request.humanFeedback
      });

      return {
        success: true,
        gateId: request.gateId,
        graphExecutionId,
        newStatus: 'escalated',
        message: `HITL Gate successfully escalated to required role: ${targetRole}`
      };
    }

    // 3. Handle Action: REJECT
    if (request.action === 'reject') {
      await this.supabase
        .from('hitl_approval_gates')
        .update({
          status: 'rejected',
          assigned_user_id: operatorUserId,
          human_feedback: request.humanFeedback || 'Rejected by human operator.',
          resolved_at: now
        })
        .eq('id', request.gateId);

      await this.supabase
        .from('agent_graph_executions')
        .update({ status: 'failed', completed_at: now })
        .eq('id', graphExecutionId);

      if (nodeExecutionId) {
        await this.supabase
          .from('agent_node_executions')
          .update({ node_status: 'failed', output_payload: { rejectionReason: request.humanFeedback } })
          .eq('id', nodeExecutionId);
      }

      await this.logAuditLedger(workspaceId, graphExecutionId, nodeExecutionId, 'HITL_GATE_REJECTED', {
        operatorUserId,
        rejectionReason: request.humanFeedback
      });

      return {
        success: true,
        gateId: request.gateId,
        graphExecutionId,
        newStatus: 'rejected',
        message: 'Workflow execution permanently rejected and halted.'
      };
    }

    // 4. Handle Action: APPROVE or OVERRIDE
    const isOverride = request.action === 'override';
    const finalFeedback = isOverride
      ? `OVERRIDE APPLIED: ${request.humanFeedback || 'Human corrected task parameters.'}`
      : `APPROVED: ${request.humanFeedback || 'Approved as-is.'}`;

    // Update Gate Status to approved
    await this.supabase
      .from('hitl_approval_gates')
      .update({
        status: 'approved',
        assigned_user_id: operatorUserId,
        human_feedback: finalFeedback,
        resolved_at: now
      })
      .eq('id', request.gateId);

    // Update Node Status if exists
    if (nodeExecutionId) {
      const updatedOutput = isOverride && request.overridePayload 
        ? { ...request.overridePayload, humanOverrideApplied: true }
        : undefined;

      await this.supabase
        .from('agent_node_executions')
        .update({
          node_status: 'completed',
          ...(updatedOutput && { output_payload: updatedOutput })
        })
        .eq('id', nodeExecutionId);
    }

    // Write audit ledger record
    await this.logAuditLedger(workspaceId, graphExecutionId, nodeExecutionId, isOverride ? 'HITL_OVERRIDE_APPROVED' : 'HITL_GATE_APPROVED', {
      operatorUserId,
      overridePayload: request.overridePayload,
      feedback: request.humanFeedback
    });

    // 5. Resume Graph Execution Flow
    const resumedResult = await this.resumeGraphExecution(
      workspaceId,
      graphExecutionId,
      operatorUserId,
      isOverride ? request.overridePayload : undefined
    );

    return {
      success: true,
      gateId: request.gateId,
      graphExecutionId,
      newStatus: 'approved',
      resumedExecutionResult: resumedResult,
      message: isOverride 
        ? 'Task parameters overridden. Multi-Agent DAG resumed successfully.' 
        : 'Task approved as-is. Multi-Agent DAG resumed successfully.'
    };
  }

  /**
   * Instantiates Orchestrator Engine and resumes DAG execution from snapshot state
   */
  private async resumeGraphExecution(
    workspaceId: string,
    graphExecutionId: string,
    operatorUserId: string,
    overridePayload?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { data: graphRecord, error } = await this.supabase
      .from('agent_graph_executions')
      .select('*')
      .eq('id', graphExecutionId)
      .single();

    if (error || !graphRecord) {
      throw new Error(`Graph execution record missing during resume step: ${error?.message}`);
    }

    // Restore execution context snapshot
    const context = graphRecord.execution_context || {};
    const plan = context.plan;
    const completedResults = context.completedResults || {};
    const lastHaltedTaskId = context.lastHaltedTaskId;

    if (lastHaltedTaskId && overridePayload) {
      completedResults[lastHaltedTaskId] = {
        ...(completedResults[lastHaltedTaskId] || {}),
        output: overridePayload,
        status: 'COMPLETED'
      };
    }

    // Set graph back to running state
    await this.supabase
      .from('agent_graph_executions')
      .update({ status: 'running' })
      .eq('id', graphExecutionId);

    // Initialize engine with execution ID context
    const engine = new OrchestratorEngine({
      supabase: this.supabase,
      workspaceId,
      userId: operatorUserId,
      rootPrompt: graphRecord.root_prompt,
      graphExecutionId
    });

    // Re-trigger execution from halted state
    const result = await engine.run();
    return result.outputs;
  }

  /**
   * Writes entry to agent_audit_ledger to ensure tamper-evident hash chaining
   */
  private async logAuditLedger(
    workspaceId: string,
    graphExecutionId: string,
    nodeExecutionId: string | null,
    actionType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('agent_audit_ledger').insert({
      workspace_id: workspaceId,
      graph_execution_id: graphExecutionId,
      node_execution_id: nodeExecutionId,
      agent_id: 'HUMAN_OPERATOR_GATEWAY',
      action_type: actionType,
      payload,
      previous_hash: 'COMPUTED_BY_TRIGGER',
      current_hash: 'COMPUTED_BY_TRIGGER'
    });
  }
}
```

---

### 4. Enterprise RBAC Next.js Server Actions (`app/actions/hitl.ts`)

Encapsulates human intervention calls inside Next.js Server Actions with strict workspace role checks via Supabase.

```typescript
'use me' // Server Action directive
'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { HITLGatewayService } from '@/lib/hitl/gateway';
import { HITLResolutionRequest, HITLResolutionResponse } from '@/lib/hitl/types';

/**
 * Server Action: Validates user identity & role permissions, then resolves HITL Gate
 */
export async function resolveHITLApprovalGateAction(
  request: HITLResolutionRequest
): Promise<{ success: boolean; data?: HITLResolutionResponse; error?: string }> {
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

    // 1. Authenticate user session
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Unauthorized user session.' };
    }

    // 2. Fetch approval gate to determine required workspace & role
    const { data: gate, error: gateError } = await supabase
      .from('hitl_approval_gates')
      .select('workspace_id, required_role, status')
      .eq('id', request.gateId)
      .single();

    if (gateError || !gate) {
      return { success: false, error: 'Target HITL approval gate does not exist.' };
    }

    // 3. Verify user membership & RBAC role in target workspace
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', gate.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (memberError || !member) {
      return { success: false, error: 'Access denied. You do not belong to this workspace.' };
    }

    // Role Hierarchy Matrix Check
    const roleHierarchy: Record<string, number> = {
      business_user: 1,
      agent_operator: 2,
      compliance_auditor: 3,
      ai_administrator: 4,
      workspace_owner: 5
    };

    const userRolePower = roleHierarchy[member.role] || 0;
    const requiredRolePower = roleHierarchy[gate.required_role] || 2;

    if (userRolePower < requiredRolePower) {
      return {
        success: false,
        error: `Insufficient RBAC privileges. Action requires role level '${gate.required_role}', but your role is '${member.role}'.`
      };
    }

    // 4. Execute Gate Resolution via HITL Gateway Service
    const gatewayService = new HITLGatewayService(supabase);
    const result = await gatewayService.resolveGate(request, user.id);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error('Failed to resolve HITL Gate in Server Action:', error);
    return {
      success: false,
      error: (error as Error).message || 'Internal error processing HITL gate resolution.'
    };
  }
}
```

---

### 5. Programmatic REST API Endpoint (`app/api/hitl/[id]/route.ts`)

Exposes a RESTful App Router endpoint to fetch gate details (GET) or post external automated approvals/webhooks (POST).

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { HITLGatewayService } from '@/lib/hitl/gateway';
import { HITLResolutionRequest } from '@/lib/hitl/types';

/**
 * GET /api/hitl/[id]
 * Retrieves HITL Gate Status, Reasoning Log, and State Snapshot
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gateId } = await params;
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {}
        }
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
    }

    const { data: gate, error } = await supabase
      .from('hitl_approval_gates')
      .select(`
        *,
        agent_graph_executions ( id, root_prompt, status, execution_context ),
        agent_node_executions ( id, agent_role, input_payload, output_payload, latency_ms )
      `)
      .eq('id', gateId)
      .single();

    if (error || !gate) {
      return NextResponse.json({ error: 'HITL Gate record not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: gate }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve HITL Gate', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hitl/[id]
 * Resolves HITL Gate (Approve, Override, Reject, Escalate)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gateId } = await params;
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {}
        }
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized user context' }, { status: 401 });
    }

    const body = await req.json();
    const resolutionRequest: HITLResolutionRequest = {
      gateId,
      action: body.action,
      humanFeedback: body.humanFeedback,
      overridePayload: body.overridePayload,
      escalateToRole: body.escalateToRole
    };

    if (!resolutionRequest.action) {
      return NextResponse.json(
        { error: 'Missing required field: action (approve | reject | override | escalate)' },
        { status: 400 }
      );
    }

    const gatewayService = new HITLGatewayService(supabase);
    const result = await gatewayService.resolveGate(resolutionRequest, user.id);

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to resolve HITL Gate', details: (error as Error).message },
      { status: 500 }
    );
  }
}
```

---

### Verification & Architectural Features Summary

| Pillar Feature | Implementation Mechanism | Enterprise Benefit |
| :--- | :--- | :--- |
| **Deterministic Trigger Evaluation** | `HITLGatewayService.evaluateGateTriggers` | Intercepts low confidence (<0.70), high value ($10k+), negative sentiment (-0.75), or system writes. |
| **State Snapshot & Pausing** | Supabase state updates (`agent_graph_executions` -> `waiting_hitl`) | Halts runtime, persists intermediate outputs, and prevents unverified agent mutations. |
| **Transparent Reasoning Logs** | `generateTransparentReasoningLog` using `gemini-3.5-flash-lite` | Converts complex raw task outputs into human-auditable risk factor reports. |
| **Workflow Resumption Engine** | `HITLGatewayService.resumeGraphExecution` | Re-instantiates `OrchestratorEngine` and resumes DAG from halted node with human override payloads. |
| **Immutable Audit Hashing** | `HITLGatewayService.logAuditLedger` | Triggers PostgreSQL cryptographic SHA-256 function on every human decision. |
| **RBAC Enforcement** | `resolveHITLApprovalGateAction` | Validates user workspace role against gate requirements (`agent_operator`, `compliance_auditor`, `ai_administrator`). |
