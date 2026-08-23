"use server";

import { revalidatePath } from "next/cache";

import { ingestDocument } from "@/lib/rag/ingest";
import { createClient } from "@/lib/supabase/server";

export type KnowledgeState = { error: string | null; message: string | null };

/** Roles allowed to change what the agents treat as ground truth. */
const CURATOR_ROLES = ["workspace_owner", "ai_administrator"];

/** Refuses a document large enough to outlive the request that ingests it. */
const MAX_DOCUMENT_CHARS = 200_000;

/**
 * Verifies the caller may curate this workspace's knowledge.
 *
 * Ingestion writes with the service role and has no RLS backstop, so this must
 * run first — same contract as `launchRun`. The membership query filters by
 * user_id explicitly: the workspace_members SELECT policy admits the whole
 * roster, so RLS alone would return a row per member rather than per caller.
 */
async function assertCurator(workspaceId: string): Promise<string | null> {
  if (!workspaceId) return "No workspace selected.";

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "Not signed in.";

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return "You are not a member of this workspace.";
  if (!CURATOR_ROLES.includes(membership.role as string)) {
    return "Your role cannot change the knowledge base.";
  }

  return null;
}

export async function createKnowledgeBase(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { error: "Name the knowledge base.", message: null };
  if (name.length > 120) {
    return { error: "Name is too long (120 char max).", message: null };
  }

  const denied = await assertCurator(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_bases").insert({
    workspace_id: workspaceId,
    name,
    description: description || null,
  });

  if (error) {
    // The (workspace_id, name) unique constraint is the likely cause, and
    // "duplicate key value violates..." is not a useful thing to show someone.
    return {
      error: error.code === "23505"
        ? `A knowledge base named "${name}" already exists.`
        : error.message,
      message: null,
    };
  }

  revalidatePath("/dashboard");
  return { error: null, message: `Created "${name}".` };
}

export async function addDocument(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const knowledgeBaseId = String(formData.get("knowledgeBaseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const sourceUri = String(formData.get("sourceUri") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!knowledgeBaseId) return { error: "Pick a knowledge base.", message: null };
  if (!title) return { error: "Give the document a title.", message: null };
  if (!content) return { error: "The document is empty.", message: null };
  if (content.length > MAX_DOCUMENT_CHARS) {
    return {
      error: `Document is too large (${content.length.toLocaleString()} chars; limit ${MAX_DOCUMENT_CHARS.toLocaleString()}). Split it, or ingest it from a background job.`,
      message: null,
    };
  }

  const denied = await assertCurator(workspaceId);
  if (denied) return { error: denied, message: null };

  try {
    const result = await ingestDocument({
      workspaceId,
      knowledgeBaseId,
      title,
      content,
      sourceUri: sourceUri || null,
    });

    revalidatePath("/dashboard");
    return {
      error: null,
      message:
        `Ingested "${title}" as ${result.chunkCount} chunk${result.chunkCount === 1 ? "" : "s"}.` +
        // Surfaced rather than silent: the curator should know the retrievable
        // copy differs from the document they pasted.
        (result.piiMasked > 0
          ? ` ${result.piiMasked} PII value${result.piiMasked === 1 ? "" : "s"} masked before embedding.`
          : ""),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Ingestion failed.",
      message: null,
    };
  }
}

export async function deleteDocument(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  if (!documentId) return { error: "No document selected.", message: null };

  const denied = await assertCurator(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  // Chunks cascade from the parent, so the embeddings go with it.
  const { error } = await supabase
    .from("document_parents")
    .delete()
    .eq("id", documentId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: "Document removed." };
}
