import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";
import RecirculateApp from "./recirculate-app";

export const dynamic = "force-dynamic";

// Server-side auth gate. Middleware already redirects unauthenticated visitors,
// but we re-check here so the page never renders for anyone but the owner.
export default async function Home() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    redirect("/login");
  }

  return <RecirculateApp email={user.email ?? ""} />;
}
