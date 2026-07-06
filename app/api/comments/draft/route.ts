import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Drafts a reply to a fan comment in the artist's voice — the owner edits and
// approves before anything is sent.
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
    return NextResponse.json({ error: "Add ANTHROPIC_API_KEY in Vercel to enable reply drafts." }, { status: 500 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const text = String(body?.text ?? "").trim();
  const author = String(body?.author ?? "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to reply to." }, { status: 400 });

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 300,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You draft replies to fan comments for Jordan Cohen, a musician who posts his songs as short " +
        "videos. Write ONE warm, genuine reply of 1–2 short sentences in his voice: grateful, humble, " +
        "personal, never salesy and never generic. Reply in the SAME language as the comment (Hebrew " +
        "comments get Hebrew replies, French get French). At most one emoji, and only when it fits. " +
        "Never promise anything, never mention links. Return ONLY the reply text — no quotes, no preamble.",
      messages: [
        {
          role: "user",
          content: `Comment from ${author || "a fan"}:\n${text}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined — write this one by hand." }, { status: 502 });
    }
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!reply) return NextResponse.json({ error: "Empty draft — try again." }, { status: 502 });
    return NextResponse.json({ reply });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error: ${e.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Draft failed — try again." }, { status: 502 });
  }
}
