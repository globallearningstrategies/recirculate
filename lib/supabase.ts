import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client. Uses the service role key, so never import this in client code.
//
// Created lazily: the service-role key is only present from Phase 3 on, so we
// defer construction until the first actual call. That keeps Phase 1/2 builds
// (where the key is intentionally absent) from throwing at import time, while
// keeping the `db.from(...)` API unchanged for callers.
let _client: SupabaseClient | null = null;

function getDb(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the service-role client."
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clips";
