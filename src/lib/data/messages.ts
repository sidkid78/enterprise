import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * One turn of the conversation between agents.
 *
 * `agent_messages` had no writer from migration `…02` until `…25`, so nothing
 * recorded what an agent was actually told. The ledger said a node completed,
 * `input_payload` held its one-line objective and `output_payload` the result,
 * but the composed text that crossed the boundary to the model — objective plus
 * retrieved context plus prior summaries plus the grounding instructions —
 * existed nowhere. It is the answer to "why did it conclude that", and the
 * honest reply used to be that we had not kept it.
 */
export type AgentMessage = {
  id: string;
  sequenceId: number;
  nodeExecutionId: string | null;
  from: string;
  to: string;
  type: string;
  /** Wire text, always post-masking. Never contains unmasked PII. */
  text: string | null;
  /** True when the stored text was clipped at the transcript's size limit. */
  truncated: boolean;
  /** Full length before any clipping, so a reader knows what they are missing. */
  chars: number | null;
  /** Everything on the row that is not prose — confidence, tool counts, ids. */
  meta: Record<string, unknown>;
  createdAt: string;
};

/**
 * The transcript for one run, in the order it happened.
 *
 * Ordered by `sequence_id`, not `created_at`: the plan's rows can share a
 * timestamp to the microsecond, and a transcript whose whole value is sequence
 * cannot be ordered by a field that ties.
 */
export async function getAgentMessages(
  graphExecutionId: string,
): Promise<AgentMessage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_messages")
    .select(
      "id, sequence_id, node_execution_id, sender_agent, recipient_agent, message_type, content, created_at",
    )
    .eq("graph_execution_id", graphExecutionId)
    .order("sequence_id", { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load transcript: ${error.message}`);
  }

  type Row = {
    id: string;
    sequence_id: number;
    node_execution_id: string | null;
    sender_agent: string;
    recipient_agent: string;
    message_type: string;
    content: Record<string, unknown> | null;
    created_at: string;
  };

  return ((data ?? []) as Row[]).map((row) => {
    const { text, chars, truncated, ...meta } = row.content ?? {};
    return {
      id: row.id,
      sequenceId: Number(row.sequence_id),
      nodeExecutionId: row.node_execution_id,
      from: row.sender_agent,
      to: row.recipient_agent,
      type: row.message_type,
      text: typeof text === "string" ? text : null,
      truncated: truncated === true,
      chars: typeof chars === "number" ? chars : null,
      meta: meta as Record<string, unknown>,
      createdAt: row.created_at,
    };
  });
}
