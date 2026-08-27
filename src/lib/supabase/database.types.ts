/**
 * PLACEHOLDER — generated types are not available yet.
 *
 * `supabase gen types typescript --local` currently fails against this stack
 * with `LegacyPgDeltaSslProbeError` (SSL probe to 127.0.0.1:54322 closes before
 * the server responds) on CLI 2.115.0. Tried: --local, --db-url with
 * sslmode=disable, -s public, and with experimental.pgdelta both on and off.
 * The database itself is healthy — psql and PostgREST both work.
 *
 * Retry after a CLI upgrade:
 *   npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
 *
 * Until then every query in `src/lib/data/*` declares its own explicit row type,
 * so results are typed at the boundary — but column names are NOT checked
 * against the schema. Treat a typo in a .select() as a runtime error, not a
 * compile-time one.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
