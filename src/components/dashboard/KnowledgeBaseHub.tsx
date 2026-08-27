"use client";

import { useActionState, useState } from "react";

import {
  addDocument,
  createKnowledgeBase,
  deleteDocument,
  type KnowledgeState,
} from "@/app/dashboard/knowledge-actions";
import { chunkDocument } from "@/lib/rag/chunk";
import type { KnowledgeBase, KnowledgeDocument } from "@/lib/data/knowledge";

const initialState: KnowledgeState = { error: null, message: null };

function Feedback({ state }: { state: KnowledgeState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-3 rounded-md border px-3 py-2 text-xs ${
        state.error
          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {state.error ?? state.message}
    </p>
  );
}

function CreateBaseForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(
    createKnowledgeBase,
    initialState,
  );

  return (
    <form action={formAction} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="mb-1 text-sm font-bold text-slate-100">New knowledge base</h3>
      <p className="mb-4 text-xs text-slate-500">
        A separate corpus of ground truth. Agents search all of a workspace&apos;s
        bases unless a run scopes to one.
      </p>

      <div className="flex flex-col gap-3">
        <input
          name="name"
          required
          maxLength={120}
          disabled={pending}
          placeholder="RevOps standards"
          aria-label="Knowledge base name"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />
        <input
          name="description"
          maxLength={300}
          disabled={pending}
          placeholder="Optional description"
          aria-label="Knowledge base description"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function AddDocumentForm({
  workspaceId,
  bases,
}: {
  workspaceId: string;
  bases: KnowledgeBase[];
}) {
  const [state, formAction, pending] = useActionState(addDocument, initialState);
  const [content, setContent] = useState("");

  // Derived, not stored in an effect: the same pure function ingestion uses, so
  // the preview is the real split rather than an estimate of it.
  const chunkPreview = content.trim() ? chunkDocument(content).length : 0;

  if (bases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-400">
          Create a knowledge base before adding documents.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="mb-1 text-sm font-bold text-slate-100">Add a document</h3>
      <p className="mb-4 text-xs text-slate-500">
        Paste the source text. It is split into overlapping chunks, PII-masked,
        and embedded — the masked copy is what agents retrieve.
      </p>

      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            name="knowledgeBaseId"
            required
            disabled={pending}
            aria-label="Knowledge base"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
          >
            {bases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.name}
              </option>
            ))}
          </select>
          <input
            name="sourceUri"
            maxLength={500}
            disabled={pending}
            placeholder="Source URI (optional)"
            aria-label="Source URI"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
          />
        </div>

        <input
          name="title"
          required
          maxLength={300}
          disabled={pending}
          placeholder="Document title"
          aria-label="Document title"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />

        <textarea
          name="content"
          required
          rows={10}
          disabled={pending}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Paste the document text…"
          aria-label="Document text"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-slate-500">
            {content.length.toLocaleString()} chars ·{" "}
            {chunkPreview} chunk{chunkPreview === 1 ? "" : "s"}
          </span>
          <button
            type="submit"
            disabled={pending || !content.trim()}
            className="rounded-md bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Embedding…" : "Ingest"}
          </button>
        </div>
      </div>

      {pending && (
        <p className="mt-2 text-xs text-slate-500">
          Embedding runs inline — a long document takes a few seconds.
        </p>
      )}
      <Feedback state={state} />
    </form>
  );
}

function DocumentRow({
  workspaceId,
  document,
  baseName,
}: {
  workspaceId: string;
  document: KnowledgeDocument;
  baseName: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteDocument,
    initialState,
  );

  return (
    <tr className="border-b border-slate-800/80 last:border-0">
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-slate-100">{document.title}</div>
        {document.sourceUri && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
            {document.sourceUri}
          </div>
        )}
        {state.error && (
          <div role="alert" className="mt-1 text-[10px] text-rose-400">
            {state.error}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">{baseName}</td>
      <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
        {document.chunkCount}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
        {document.characterCount > 0
          ? document.characterCount.toLocaleString()
          : "--"}
      </td>
      <td className="px-4 py-3 text-right">
        <form action={formAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="documentId" value={document.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
          >
            {pending ? "Removing…" : "Remove"}
          </button>
        </form>
      </td>
    </tr>
  );
}

export default function KnowledgeBaseHub({
  workspaceId,
  bases,
  documents,
}: {
  workspaceId: string;
  bases: KnowledgeBase[];
  documents: KnowledgeDocument[];
}) {
  const baseNames = new Map(bases.map((base) => [base.id, base.name]));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Domain Knowledge & Grounding
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              What agents treat as ground truth. Retrieved per step by hybrid
              search — dense vectors fused with keyword ranking.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>
              <span className="text-slate-400">Bases: </span>
              <span className="font-bold text-slate-200">{bases.length}</span>
            </span>
            <span>
              <span className="text-slate-400">Documents: </span>
              <span className="font-bold text-cyan-400">{documents.length}</span>
            </span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
          <CreateBaseForm workspaceId={workspaceId} />
          <AddDocumentForm workspaceId={workspaceId} bases={bases} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
          Indexed Documents
        </h3>

        {documents.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No documents indexed yet. Agents will answer from general knowledge
            alone until one is added.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Knowledge Base</th>
                  <th className="px-4 py-3 text-right">Chunks</th>
                  <th className="px-4 py-3 text-right">Chars</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    workspaceId={workspaceId}
                    document={document}
                    baseName={
                      baseNames.get(document.knowledgeBaseId) ?? "(removed)"
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
