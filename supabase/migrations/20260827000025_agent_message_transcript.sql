-- Gives `agent_messages` a writer, so an auditor can see what each agent was
-- actually told.
--
-- The table has existed since migration ...02 with no writer and no reader.
-- Meanwhile the ledger records that a node completed, `input_payload` holds its
-- one-line objective, and `output_payload` holds the result — but the text that
-- actually crossed the boundary to the model is nowhere. That text is the
-- objective PLUS whatever retrieval returned, plus the summaries of prior
-- steps, plus the grounding and honesty instructions. When an auditor asks why
-- an agent concluded something, the composed input is the answer, and until now
-- the honest reply was "we did not keep it".
--
-- WHAT IS STORED IS THE WIRE TEXT — the masked, composed string as sent — and
-- never the pre-mask draft. Two reasons, and the second is the important one:
--
--   1. It is what the model actually saw. The agent reasoned over
--      "[EMAIL_1]", so a transcript showing the real address would
--      misrepresent the input to the very question the transcript exists to
--      answer.
--   2. `agent_messages` is readable by EVERY workspace member
--      (`is_workspace_member`), unlike `agent_audit_ledger`, which is
--      restricted to three roles. Putting raw prompts here would widen access
--      to unmasked PII from three roles to everyone — a privacy regression
--      dressed as an audit improvement.
--
-- `agent_graph_executions.root_prompt` remains raw and that stays correct: it
-- is one column, on a table a reviewer needs in order to see what was asked.
-- This is a per-turn transcript that would multiply that exposure by every node.

-- Messages belong to a node, not merely to a graph. Without this, a transcript
-- can be ordered but not attributed, and the Node Inspector cannot ask "what
-- was THIS step told?" — which is the question people actually have.
alter table public.agent_messages
    add column if not exists node_execution_id uuid
        references public.agent_node_executions(id) on delete cascade;

-- A total order that does not depend on the clock.
--
-- `created_at` is not sufficient: a plan is inserted in one statement and its
-- rows share a timestamp to the microsecond — the same defect that made
-- buildRunReport order sections arbitrarily until it switched to depends_on.
-- Messages are written one at a time, so collisions are unlikely rather than
-- guaranteed, and "unlikely" is not an ordering guarantee for a transcript
-- whose whole value is sequence.
alter table public.agent_messages
    add column if not exists sequence_id bigint generated always as identity;

create index if not exists idx_agent_messages_node
    on public.agent_messages(node_execution_id, sequence_id);
create index if not exists idx_agent_messages_graph_seq
    on public.agent_messages(graph_execution_id, sequence_id);

comment on column public.agent_messages.content is
    'Wire text as sent or received, always post-masking. { text, chars, truncated } for prose; structured payloads keep their own shape.';

comment on table public.agent_messages is
    'Per-turn transcript of what each agent was told and what it said back. Readable by every workspace member, so it must never contain unmasked PII.';
