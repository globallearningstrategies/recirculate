import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";
import RecirculateApp from "./recirculate-app";

export const dynamic = "force-dynamic";

// Server-side auth gate. Middleware already redirects unauthenticated visitors,
// but we re-check here so the page never renders for anyone but the owner.
export default async function Home({
  searchParams,
}: {
  searchParams?: { connected?: string; connect_error?: string; review?: string };
}) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    redirect("/login");
  }

  // Result banner from an OAuth connect round-trip (/api/callback/*).
  const notice = searchParams?.connected
    ? { ok: true, text: `${searchParams.connected} connected. ✓` }
    : searchParams?.connect_error
      ? { ok: false, text: searchParams.connect_error }
      : null;

  return <RecirculateApp email={user.email ?? ""} notice={notice} review={searchParams?.review ?? null} />;
}
