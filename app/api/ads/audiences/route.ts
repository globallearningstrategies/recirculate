import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { adsConfigured, listSavedAudiences } from "@/lib/meta-ads";

export const runtime = "nodejs";

// Owner-only: the saved audiences from the owner's ad account, for the
// Promote panel's dropdown.
export async function GET() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  if (!adsConfigured()) {
    return NextResponse.json({ configured: false, audiences: [] });
  }
  try {
    const audiences = await listSavedAudiences();
    return NextResponse.json({ configured: true, audiences });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't load audiences." }, { status: 502 });
  }
}
