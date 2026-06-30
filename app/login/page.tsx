import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

// Server-side: if the owner is already signed in, skip the form and go home.
// (This replaces the redirect the Edge middleware used to do.)
export default async function LoginPage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (user && (!owner || user.email?.toLowerCase() === owner)) {
    redirect("/");
  }

  return <LoginForm />;
}
