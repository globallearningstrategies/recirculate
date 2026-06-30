"use server";

import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase-server";

function originFromHeaders(h: Headers): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

// Sends a magic link — but only ever to the owner. Any other address is refused
// before a link is sent, so the app stays single-user.
export async function sendMagicLink(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();

  if (!email) return { ok: false, message: "Enter your email." };
  if (owner && email !== owner) {
    return { ok: false, message: "This app is private. That email isn't on the list." };
  }

  const h = await headers();
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${originFromHeaders(h)}/auth/confirm`,
    },
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Check your email for a sign-in link." };
}
