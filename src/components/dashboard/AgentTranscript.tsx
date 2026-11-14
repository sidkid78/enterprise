"use client";

import { useState } from "react";

import type { AgentMessage } from "@/lib/data/messages";

/**
 * How a turn is labelled and coloured.
 *
 * Assignments and results are visually distinct because the question a reader
 * arrives with is directional — "what was it told" versus "what did it say" —
 * and a uniform list makes them scan every row to work out which is which.
 */
const KIND: Record<string, { label: string; accent: string }> = {
  plan_request: { label: "PLAN REQUEST", accent: "text-violet-300" },
  plan_result: { label: "PLAN", accent: "text-violet-300" },
  task_assignment: { label: "TOLD", accent: "text-cyan-400" },
  task_result: { label: "SAID", accent: "text-emerald-400" },
  task_result_cached: { label: "SAID (CACHED)", accent: "text-slate-400" },
};

function metaLine(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];

  const conf = meta.confidence;
  if (typeof conf === "number") parts.push(`confidence ${(conf * 100).toFixed(0)}%`);

  const chunks = meta.retrieved_chunks;
  if (typeof chunks === "number" && chunks > 0) parts.push(`${chunks} chunks retrieved`);

  const tools = meta.tool_calls;
  if (typeof tools === "number" && tools > 0) parts.push(`${tools} tool call${tools === 1 ? "" : "s"}`);

  const pii = meta.pii_masked;
  if (typeof pii === "number" && pii > 0) parts.push(`${pii} value${pii === 1 ? "" : "s"} masked`);

  const money = meta.monetary_value_usd;
  if (typeof money === "number") parts.push(`declared $${money.toLocaleString("en-US")}`);

  return parts.length ? parts.join(" · ") : null;
}

function Turn({ message }: { message: AgentMessage }) {
  const [open, setOpen] = useState(false);
  const kind = KIND[message.type] ?? {
    label: message.type.toUpperCase(),
    accent: "text-slate-400",
  };

  const text = message.text ?? "";
  const isLong = text.length > 280;
  const shown = open || !isLong ? text : `${text.slice(0, 280)}…`;
  const meta = metaLine(message.meta);

  return (
    <div className="border-t border-slate-800 px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`font-mono text-[10px] font-bold ${kind.accent}`}>
          {kind.label}
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          {message.from} → {message.to}
        </span>
        {typeof message.meta.node_id === "string" && (
          <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            {message.meta.node_id}
          </span>
        )}
      </div>

      {text && (
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
          {shown}
        </pre>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {isLong && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
          >
            {open ? "show less" : `show all ${text.length.toLocaleString()} chars`}
          </button>
        )}
        {meta && <span className="text-[10px] text-slate-500">{meta}</span>}
        {message.truncated && (
          /*
            Clipping is stated, not hidden. An audit record that quietly drops
            the end of what an agent was told is worse than one that admits it,
            because a reader would otherwise treat the stored text as complete.
          */
          <span className="text-[10px] text-amber-400">
            clipped from {message.chars?.toLocaleString()} chars
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * What each agent was actually told, and what it said back.
 *
 * The text here is the masked wire text — exactly the string that crossed the
 * boundary to the model. It is not the raw prompt: the agent reasoned over
 * `[EMAIL_1]`, so showing the real address would misrepresent the input to the
 * very question this panel exists to answer. `root_prompt` on the run header is
 * where the unmasked request stays visible.
 */
export default function AgentTranscript({
  messages,
}: {
  messages: AgentMessage[];
}) {
  const [open, setOpen] = useState(false);

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-500">
          No transcript for this run. Runs from before the transcript existed
          have none — it is not reconstructed, because a rebuilt record of what
          an agent was told would be a guess presented as evidence.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-white">
          Agent transcript{" "}
          <span className="ml-1 font-mono text-[11px] font-normal text-slate-500">
            {messages.length} turn{messages.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="font-mono text-[11px] text-cyan-400">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-800">
          <p className="px-4 py-2 text-[10px] text-slate-500">
            Masked wire text — exactly what crossed the boundary to the model.
            Redacted values appear as placeholders because that is what the agent
            reasoned over.
          </p>
          {messages.map((m) => (
            <Turn key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  );
}
