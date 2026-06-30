import { createBrowserClient } from "@supabase/ssr";

// Browser client. Carries the signed-in owner's session, so every query runs
// under RLS as that user. Safe to use in client components.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
