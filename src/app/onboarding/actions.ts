"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error: string | null };

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Workspace name is required." };
  }

  const slug = slugify(name);
  if (!slug) {
    return { error: "Name must contain at least one letter or number." };
  }

  const supabase = await createClient();

  // Workspace + owner membership + budget row are created together in the RPC,
  // so a failure cannot leave a workspace nobody can administer.
  const { error } = await supabase.rpc("create_workspace", {
    p_name: name,
    p_slug: slug,
  });

  if (error) {
    // 23505 is unique_violation on workspaces.slug.
    if (error.code === "23505") {
      return { error: "That workspace name is already taken." };
    }
    return { error: error.message };
  }

  redirect("/dashboard");
}
