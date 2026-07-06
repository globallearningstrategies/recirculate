import Anthropic from "@anthropic-ai/sdk";

// YouTube is a search engine; covers are search magnets. Generates a
// search-optimized title/description/tags for a YouTube publish. Best-effort
// by design: any failure returns null and the publish falls back to the
// clip's own title and caption — SEO must never block a post.
export async function youtubeSearchMeta(input: {
  clipTitle: string;
  songTitle: string | null;
  caption: string;
}): Promise<{ title: string; description: string; tags: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 700,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You write YouTube search metadata for Jordan Cohen, a musician who posts covers and original " +
        "songs as Shorts. Optimize for what people actually type into YouTube search: the song name, " +
        "the original artist, the word 'cover' when it is one, and the song's language. " +
        'Title: at most 90 characters, shaped like "Song Name - Original Artist Cover | Jordan Cohen" ' +
        "(adapt sensibly; original songs drop the cover framing; Hebrew songs keep the Hebrew title and " +
        "add a transliteration or translation if it fits). " +
        "Description: 2–4 natural, keyword-rich sentences. If the source caption contains a URL, keep " +
        "that URL verbatim on its own line. End with 2–3 relevant hashtags. " +
        "Tags: 10–15 short search phrases (each under 30 characters), mixing English and the song's language. " +
        'Return ONLY a JSON object: {"title":"...","description":"...","tags":["..."]} — no other text.',
      messages: [
        {
          role: "user",
          content: `Clip title: ${input.clipTitle}\nSong: ${input.songTitle ?? "(not set — infer from the clip title)"}\n\nSource caption:\n${input.caption || "(none)"}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 95) : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 4500) : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t: unknown) => typeof t === "string")
          .map((t: string) => t.trim().slice(0, 30))
          .filter(Boolean)
          .slice(0, 15)
      : [];
    if (!title || !description) return null;
    return { title, description, tags };
  } catch {
    return null;
  }
}
