import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

// Drafts a personalized playlist pitch for one curator. The owner edits and
// sends — nothing goes out automatically.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Add ANTHROPIC_API_KEY in Vercel to enable pitch drafts." }, { status: 500 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const { curatorId, songId } = body;
  if (!curatorId) return NextResponse.json({ error: "Missing curator." }, { status: 400 });

  const [{ data: curator }, { data: song }] = await Promise.all([
    db.from("curators").select("*").eq("id", curatorId).eq("user_id", user.id).maybeSingle(),
    songId
      ? db.from("songs").select("title, slug, spotify_url").eq("id", songId).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  if (!curator) return NextResponse.json({ error: "Curator not found." }, { status: 404 });

  const base = cred("APP_BASE_URL") || "https://recirculate-globallearningstrategies-projects.vercel.app";
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 700,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You draft playlist pitch emails for Jordan Cohen, an independent musician (soulful covers and " +
        "originals in Hebrew and English). Write a SHORT pitch — subject line plus a 4–6 sentence body. " +
        "Personal and specific to the curator's playlist (use the notes given), humble, zero hype-speak, " +
        "no attachments mentioned. Include the Spotify link once. Close with a simple thanks — no pressure " +
        "tactics, no follow-up threats. " +
        'Return ONLY JSON: {"subject":"...","body":"..."} with real line breaks in the body.',
      messages: [
        {
          role: "user",
          content:
            `Curator: ${curator.name}\nPlaylist: ${curator.playlist_url || "(link not saved)"}\n` +
            `Notes about this playlist/curator: ${curator.note || "(none)"}\n\n` +
            (song
              ? `Song to pitch: "${song.title}" — Spotify: ${song.spotify_url || `${base}/listen/${song.slug}`}`
              : `No specific song chosen — pitch the artist generally, link: ${base}/listen`),
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined — write this one by hand." }, { status: 502 });
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Couldn't parse the draft — try again." }, { status: 502 });
    const parsed = JSON.parse(m[0]);
    if (!parsed.subject || !parsed.body) {
      return NextResponse.json({ error: "Incomplete draft — try again." }, { status: 502 });
    }
    return NextResponse.json({ subject: String(parsed.subject).slice(0, 150), body: String(parsed.body).slice(0, 4000) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error: ${e.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Draft failed — try again." }, { status: 502 });
  }
}
