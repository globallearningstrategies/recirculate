import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { cred } from "@/lib/env";

export const runtime = "nodejs";

// Public fan signup from the /listen pages → the owner's Brevo contact list.
// Set BREVO_LIST_ID (Brevo → Contacts → Lists, the numeric id) to file
// contacts into a specific list; without it they land in All Contacts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  // Honeypot: bots fill every field. Real form leaves "name2" empty. Pretend
  // success so scripts don't learn anything.
  if (body?.name2) return NextResponse.json({ ok: true });

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const apiKey = cred("BREVO_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "Signups aren't configured yet." }, { status: 500 });
  }
  const listId = Number(cred("BREVO_LIST_ID"));

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      updateEnabled: true, // repeat signups are a no-op, not an error
      ...(Number.isFinite(listId) && listId > 0 ? { listIds: [listId] } : {}),
    }),
  });

  if (res.ok || res.status === 204) return NextResponse.json({ ok: true, ...(await magnet()) });
  const err = await res.json().catch(() => ({} as any));
  if (err?.code === "duplicate_parameter") return NextResponse.json({ ok: true, ...(await magnet()) });
  return NextResponse.json({ error: "Couldn't sign you up — try again in a minute." }, { status: 502 });
}

// The reward for signing up, when one is configured (Songs tab → Lead magnet).
async function magnet(): Promise<{ download?: string; downloadTitle?: string }> {
  try {
    const { data } = await db.from("lead_magnet").select("title, file_path").limit(1).maybeSingle();
    if (!data) return {};
    return {
      download: db.storage.from(BUCKET).getPublicUrl(data.file_path).data.publicUrl,
      downloadTitle: data.title,
    };
  } catch {
    return {};
  }
}
