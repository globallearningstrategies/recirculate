import { db } from "./supabase";

const DAY = 86400000;

// Rotation rule — kept identical to app/recirculate-app.tsx (and the reference UI):
// a platform is due when nothing has ever gone out on it, or the newest post is
// >= cadence_days old. The next clip is the never-posted one first (tie-break:
// oldest original posted_at, falling back to created_at), then the clip with the
// oldest last_posted_at. Archived clips and disabled toggles leave the pool, but
// their post history still counts toward the cadence — the cadence is about the
// audience's feed, not the rotation pool.
export async function platformStatus(platform: string, cadenceDays: number) {
  const { data } = await db
    .from("clip_platforms")
    .select("last_posted_at, enabled, clips(id, title, archived, posted_at, created_at)")
    .eq("platform", platform);
  const rows = (data ?? []) as any[];

  const globalLast = rows.reduce<string | null>(
    (m, r) => (r.last_posted_at && (!m || r.last_posted_at > m) ? r.last_posted_at : m),
    null
  );
  const sinceLast = globalLast ? Math.floor((Date.now() - +new Date(globalLast)) / DAY) : null;
  const due = !globalLast || (sinceLast as number) >= cadenceDays;

  const pool = rows.filter((r) => r.enabled && r.clips && !r.clips.archived);
  pool.sort((a, b) => {
    const x = a.last_posted_at, y = b.last_posted_at;
    if (!x && !y) {
      const ax = a.clips.posted_at ?? a.clips.created_at ?? "";
      const bx = b.clips.posted_at ?? b.clips.created_at ?? "";
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    }
    if (!x) return -1;
    if (!y) return 1;
    return +new Date(x) - +new Date(y);
  });
  const next = pool[0]?.clips ?? null;

  return {
    due,
    sinceLast,
    next: next ? { id: next.id as string, title: (next.title as string | null) ?? "Untitled" } : null,
    poolSize: pool.length,
  };
}
