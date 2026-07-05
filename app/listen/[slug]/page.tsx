import Link from "next/link";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Public smart-link page for one song: big title, streaming buttons that
// count the click (via /api/go) before bouncing to the platform.
export async function generateMetadata({ params }: { params: { slug: string } }) {
  const { data: song } = await db.from("songs").select("title").eq("slug", params.slug).maybeSingle();
  const title = song ? `${song.title} — Jordan Cohen` : "Jordan Cohen — Listen";
  return {
    title,
    description: song
      ? `Stream “${song.title}” by Jordan Cohen on Spotify, Apple Music, and YouTube.`
      : "Stream Jordan Cohen on Spotify, Apple Music, and YouTube.",
  };
}

export default async function SongPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { src?: string };
}) {
  const { data: song } = await db
    .from("songs")
    .select("title, slug, spotify_url, apple_url, youtube_url")
    .eq("slug", params.slug)
    .maybeSingle();

  const src = searchParams?.src ? `&src=${encodeURIComponent(searchParams.src)}` : "";
  const targets = song
    ? [
        { key: "spotify", label: "Listen on Spotify", url: song.spotify_url, bg: "#1DB954", fg: "#08210F" },
        { key: "apple", label: "Listen on Apple Music", url: song.apple_url, bg: "#FA243C", fg: "#FFFFFF" },
        { key: "youtube", label: "Watch on YouTube", url: song.youtube_url, bg: "#FF0033", fg: "#FFFFFF" },
      ].filter((t) => t.url)
    : [];

  return (
    <div className="rc-login" style={{ alignItems: "flex-start", paddingTop: 48 }}>
      <div className="rc-card-login" style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        {!song ? (
          <>
            <h1 className="rc-h1" style={{ fontSize: 22 }}>Song not found</h1>
            <p className="rc-sub" style={{ marginTop: 10 }}>
              <Link href="/listen" style={{ color: "var(--lilac)" }}>See all songs →</Link>
            </p>
          </>
        ) : (
          <>
            <p className="rc-sub" style={{ letterSpacing: ".08em", textTransform: "uppercase", fontSize: 11 }}>
              Jordan Cohen
            </p>
            <h1 className="rc-h1" style={{ fontSize: 28, margin: "6px 0 20px" }}>{song.title}</h1>
            <div style={{ display: "grid", gap: 10 }}>
              {targets.length === 0 && <p className="rc-sub">Streaming links coming soon.</p>}
              {targets.map((t) => (
                <a
                  key={t.key}
                  href={`/api/go/${song.slug}?to=${t.key}${src}`}
                  style={{
                    display: "block",
                    padding: "15px 16px",
                    borderRadius: 14,
                    background: t.bg,
                    color: t.fg,
                    textDecoration: "none",
                    fontWeight: 700,
                    fontSize: 15.5,
                  }}
                >
                  {t.label}
                </a>
              ))}
            </div>
            <p className="rc-sub" style={{ marginTop: 18, fontSize: 12 }}>
              <Link href="/listen" style={{ color: "var(--muted)" }}>More songs</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
