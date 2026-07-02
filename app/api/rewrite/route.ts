import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Rewrites a clip's caption with Claude so a recirculated post reads fresh
// instead of copy-pasted. Returns the rewritten caption only — hashtags are a
// separate field and are left alone.
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
    return NextResponse.json(
      { error: "Server not configured: add ANTHROPIC_API_KEY in Vercel to enable caption rewriting." },
      { status: 500 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const caption = String(body?.caption ?? "").trim();
  const title = String(body?.title ?? "").trim();
  if (!caption && !title) {
    return NextResponse.json({ error: "Nothing to rewrite — the clip has no caption." }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You rewrite short-form video captions for a musician who recirculates his own clips across " +
        "Instagram, TikTok, and YouTube. Rewrite the caption so it reads fresh — different wording and " +
        "angle — while keeping the meaning, the artist's voice, any @mentions, song titles, and factual " +
        "claims intact. Match the original's language and rough length; keep it natural, not salesy. " +
        "Return ONLY the rewritten caption text: no preamble, no quotes, no hashtags, no explanations.",
      messages: [
        {
          role: "user",
          content: `Clip title: ${title || "(untitled)"}\n\nCurrent caption:\n${caption || "(no caption — write a short one from the title)"}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined to rewrite this caption." }, { status: 502 });
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return NextResponse.json({ error: "Got an empty rewrite — try again." }, { status: 502 });

    return NextResponse.json({ caption: text });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is invalid — check the key in Vercel." }, { status: 500 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited — try again in a moment." }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error: ${e.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Rewrite failed — try again." }, { status: 502 });
  }
}
