import Anthropic from "@anthropic-ai/sdk";
import { db } from "./supabase";

// Self-improving captions: reposts get a FRESH caption variant — new hook,
// rotating CTA — steered by the captions of the account's proven top
// performers and forbidden from repeating anything already used for this
// clip on this platform. Best-effort: any failure returns null and the post
// goes out with the authored caption. First-ever posts keep the original.
export async function freshCaption(opts: {
  userId: string;
  clipId: string;
  platform: string;
  title: string;
  caption: string;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || !opts.caption.trim()) return null;
  try {
    const [{ data: prior }, { data: top }] = await Promise.all([
      db
        .from("post_log")
        .select("caption")
        .eq("clip_id", opts.clipId)
        .eq("platform", opts.platform)
        .eq("status", "success")
        .not("caption", "is", null)
        .order("posted_at", { ascending: false })
        .limit(5),
      db
        .from("clips")
        .select("caption, source_views")
        .eq("user_id", opts.userId)
        .not("source_views", "is", null)
        .not("caption", "is", null)
        .order("source_views", { ascending: false })
        .limit(3),
    ]);
    const priorCaptions = (prior ?? []).map((p: any) => p.caption).filter(Boolean);
    const topExamples = (top ?? []).map((t: any) => t.caption).filter(Boolean);

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 600,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You write short-form video captions for Jordan Cohen, a musician recirculating his own clips. " +
        "Write ONE fresh caption for this repost: a new hook or angle, same meaning and language as the " +
        "original, natural voice, never salesy. It must read noticeably different from every caption " +
        "listed as already used. If style examples from the account's top-performing posts are given, " +
        "lean toward what they do well (hook shape, length, energy) without copying them. " +
        "Return ONLY the caption text — no quotes, no hashtags, no explanations.",
      messages: [
        {
          role: "user",
          content:
            `Clip: ${opts.title}\n\nOriginal caption:\n${opts.caption}\n\n` +
            (priorCaptions.length
              ? `Already used on ${opts.platform} (do NOT resemble these):\n${priorCaptions.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}\n\n`
              : "") +
            (topExamples.length
              ? `Style examples from this account's top-performing posts:\n${topExamples.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}`
              : ""),
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}
