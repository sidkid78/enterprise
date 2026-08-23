import "server-only";

import { createClient } from "@/lib/supabase/server";

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  createdAt: string;
};

export type KnowledgeDocument = {
  id: string;
  knowledgeBaseId: string;
  title: string;
  sourceUri: string | null;
  chunkCount: number;
  characterCount: number;
  createdAt: string;
};

/**
 * Knowledge bases in a workspace, each with the number of documents filed in
 * it. The count comes back through the FK embed rather than a query per base.
 */
export async function getKnowledgeBases(
  workspaceId: string,
): Promise<KnowledgeBase[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("id, name, description, created_at, document_parents(count)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load knowledge bases: ${error.message}`);
  }

  type Row = {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    document_parents: { count: number }[] | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    documentCount: row.document_parents?.[0]?.count ?? 0,
    createdAt: row.created_at,
  }));
}

/**
 * Documents in a workspace, newest first.
 *
 * `full_content` is deliberately not selected — the list only needs its length,
 * and pulling every document's whole body to render a table of titles would
 * grow the payload without bound as a knowledge base fills up.
 */
export async function getKnowledgeDocuments(
  workspaceId: string,
  limit = 50,
): Promise<KnowledgeDocument[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("document_parents")
    .select(
      "id, knowledge_base_id, document_title, source_uri, created_at, metadata, document_chunks(count)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load documents: ${error.message}`);
  }

  type Row = {
    id: string;
    knowledge_base_id: string;
    document_title: string;
    source_uri: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
    document_chunks: { count: number }[] | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.document_title,
    sourceUri: row.source_uri,
    chunkCount: row.document_chunks?.[0]?.count ?? 0,
    characterCount:
      typeof row.metadata?.character_count === "number"
        ? row.metadata.character_count
        : 0,
    createdAt: row.created_at,
  }));
}
