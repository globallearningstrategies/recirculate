import Link from "next/link";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Public fan-facing hub (no auth gate, like /privacy and /terms — this one is
// MEANT to be shared). Lists every song with a smart-link page.
export const metadata = {
  title: "Jordan Cohen — Listen",
  description: "Stream Jordan Cohen on Spotify, Apple Music, and YouTube.",
};

export default async function ListenHub() {
  const { data: songs } = await db
    .from("songs")
    .select("title, slug")
    .order("created_at", { ascending: false });

  return (
    <div className="rc-login" style={{ alignItems: "flex-start", paddingTop: 48 }}>
      <div className="rc-card-login" style={{ maxWidth: 480, width: "100%" }}>
        <h1 className="rc-h1" style={{ fontSize: 26 }}>Jordan Cohen</h1>
        <p className="rc-sub">Songs · pick one to listen</p>
        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          {(songs ?? []).length === 0 && <p className="rc-sub">Music coming soon.</p>}
          {(songs ?? []).map((s) => (
            <Link
              key={s.slug}
              href={`/listen/${s.slug}`}
              style={{
                display: "block",
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--surface2)",
                border: "1px solid var(--line)",
                color: "var(--text)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {s.title} →
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
