import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sends the (owner-approved) pitch to a curator via Brevo, from the owner's
// verified sender address, with reply-to set so answers land in his inbox.
// Marks the curator pitched with a timestamp for follow-up nudges.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const apiKey = cred("BREVO_API_KEY");
  const from = cred("NOTIFY_FROM_EMAIL") || cred("OWNER_EMAIL");
  if (!apiKey || !from) {
    return NextResponse.json({ error: "Brevo isn't configured (BREVO_API_KEY / OWNER_EMAIL)." }, { status: 500 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const { curatorId } = body;
  const subject = String(body?.subject ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!curatorId || !subject || !text) {
    return NextResponse.json({ error: "Missing curator, subject, or body." }, { status: 400 });
  }

  const { data: curator } = await db
    .from("curators")
    .select("id, name, contact_email")
    .eq("id", curatorId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!curator) return NextResponse.json({ error: "Curator not found." }, { status: 404 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(curator.contact_email ?? "")) {
    return NextResponse.json({ error: "This curator has no valid email — edit the entry first." }, { status: 400 });
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Jordan Cohen", email: from },
      replyTo: { email: cred("OWNER_EMAIL") },
      to: [{ email: curator.contact_email, name: curator.name }],
      subject,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return NextResponse.json({ error: `Send failed: Brevo ${res.status} ${err.slice(0, 200)}` }, { status: 502 });
  }

  await db
    .from("curators")
    .update({ status: "pitched", last_contact: new Date().toISOString() })
    .eq("id", curator.id);

  return NextResponse.json({ ok: true });
}
