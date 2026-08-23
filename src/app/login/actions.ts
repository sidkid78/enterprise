"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null };

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

/**
 * `next` comes from a query param, so it is attacker-controllable. Only allow
 * same-origin absolute paths — never a full URL, which would make this an open
 * redirect.
 */
function safeNext(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  // Whether a confirmation email is required depends on the project's
  // `enable_confirmations` setting, which differs between the local stack
  // (off by default) and a hosted project (on). Branch on what the response
  // actually contains rather than assuming — telling someone to check mail
  // that was never sent is worse than no message at all.
  if (data.session) {
    redirect(safeNext(formData.get("next")));
  }

  return { error: "Check your email to confirm your account, then sign in." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
