import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

/**
 * Request-scoped Supabase client for Server Components, Server Functions, and
 * Route Handlers. Acts as the signed-in user, so RLS applies.
 *
 * `cookies()` is async in Next 16, so this function is async too — always
 * `await createClient()`, and create a fresh one per request rather than
 * hoisting it to a module-level constant.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies. Session refresh happens in
            // proxy.ts, so this is safe to swallow here.
          }
        },
      },
    },
  );
}
