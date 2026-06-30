import { createClient } from "@supabase/supabase-js";

// Server-only client. Uses the service role key, so never import this in client code.
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clips";
