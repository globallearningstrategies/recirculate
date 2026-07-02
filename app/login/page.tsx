import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

// Server-side: if the owner is already signed in, skip the form and go home.
// (This replaces the redirect the Edge middleware used to do.)
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (user && (!owner || user.email?.toLowerCase() === owner)) {
    redirect("/");
  }

  const initialError =
    searchParams?.error === "link_invalid"
      ? "That sign-in link didn't work — it may have expired or been opened in a different browser. Send a fresh one, or use the 6-digit code."
      : undefined;

  return <LoginForm initialError={initialError} />;
}
