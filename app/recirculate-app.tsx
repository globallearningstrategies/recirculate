"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Copy, Check, Trash2, Pencil, Clock, RotateCw, X, LogOut, Download, Music, Send, Archive, ArchiveRestore, Sparkles, Search, History } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { PLATFORMS, PK, Icon, type Platform } from "@/lib/platforms";

type Cadence = Record<Platform, number>;

type Reel = {
  id: string;
  title: string;
  caption: string;
  hashtags: string;
  video_path: string | null;
  thumb_path: string | null;
  source: string | null;
  licensed_audio: boolean;
  archived: boolean;
  posted_at: string | null; // when the original went up on its source platform
  created_at: string | null;
  links: Record<Platform, string>;
  platforms: Record<Platform, boolean>;
  posted: Record<Platform, string | null>;
  timesPosted: Record<Platform, number>;
  song_id: string | null;
  source_views: number | null;
  source_likes: number | null;
};

type ReelFormData = {
  id?: string;
  title: string;
  caption: string;
  hashtags: string;
  platforms: Record<Platform, boolean>;
  links: Record<Platform, string>;
  video_path: string | null;
  thumb_path: string | null;
  licensed_audio: boolean;
  song_id: string | null;
};

type Song = {
  id: string;
  title: string;
  slug: string;
  spotify_url: string;
  apple_url: string;
  youtube_url: string;
};

const DEFAULT_CADENCE: Cadence = { instagram: 5, tiktok: 4, youtube: 7 };
const todayISO = () => new Date().toISOString();
const daysBetween = (a: string, b: string) => Math.floor((+new Date(b) - +new Date(a)) / 86400000);
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtMonthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const emptyMap = <T,>(v: T): Record<Platform, T> => ({ instagram: v, tiktok: v, youtube: v });
const fmtNum = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "song";

export default function RecirculateApp({
  email,
  notice,
  review,
}: {
  email: string;
  notice?: { ok: boolean; text: string } | null;
  review?: string | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  // A ?review=<platform> link (from the daily digest email) lands on that
  // platform's tab and pops the publish confirm for its suggested clip.
  const reviewPlat = review && PK.includes(review as Platform) ? (review as Platform) : null;
  const reviewPending = useRef(!!reviewPlat);

  const [reels, setReels] = useState<Reel[]>([]);
  const [cadence, setCadence] = useState<Cadence>(DEFAULT_CADENCE);
  const [plat, setPlat] = useState<Platform>(reviewPlat ?? "instagram");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [posting, setPosting] = useState<string | null>(null);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "never" | "notinrot" | "licensed" | "hits">("all");
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsMsg, setStatsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [logRows, setLogRows] = useState<any[] | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [clicks, setClicks] = useState<{ song_id: string; target: string }[]>([]);
  const [showSongs, setShowSongs] = useState(false);
  const [songEditing, setSongEditing] = useState<string | null>(null); // song id | "new" | null
  // platform → username (null = connected but no display name); key absent = not connected
  const [conns, setConns] = useState<Partial<Record<Platform, string | null>>>({});

  const publicUrl = useCallback(
    (path: string) => supabase.storage.from("clips").getPublicUrl(path).data.publicUrl,
    [supabase]
  );

  // ---- load ----
  const load = useCallback(async () => {
    const [{ data: clipRows }, { data: settingRows }, { data: connRows }, { data: songRows }, { data: clickRows }] =
      await Promise.all([
        supabase
          .from("clips")
          .select("id,title,caption,hashtags,video_path,thumb_path,source,licensed_audio,archived,posted_at,created_at,song_id,source_views,source_likes,clip_platforms(platform,enabled,link,last_posted_at,times_posted)")
          .order("created_at", { ascending: true }),
        supabase.from("settings").select("platform,cadence_days"),
        supabase.from("social_connections").select("platform,username"),
        supabase.from("songs").select("id,title,slug,spotify_url,apple_url,youtube_url").order("created_at", { ascending: false }),
        supabase.from("link_clicks").select("song_id,target"),
      ]);

    const mapped: Reel[] = (clipRows ?? []).map((c: any) => {
      const byPlat: Record<string, any> = {};
      for (const cp of c.clip_platforms ?? []) byPlat[cp.platform] = cp;
      return {
        id: c.id,
        title: c.title,
        caption: c.caption ?? "",
        hashtags: c.hashtags ?? "",
        video_path: c.video_path ?? null,
        thumb_path: c.thumb_path ?? null,
        source: c.source ?? null,
        licensed_audio: !!c.licensed_audio,
        archived: !!c.archived,
        posted_at: c.posted_at ?? null,
        created_at: c.created_at ?? null,
        links: { instagram: byPlat.instagram?.link ?? "", tiktok: byPlat.tiktok?.link ?? "", youtube: byPlat.youtube?.link ?? "" },
        platforms: {
          instagram: !!byPlat.instagram?.enabled,
          tiktok: !!byPlat.tiktok?.enabled,
          youtube: !!byPlat.youtube?.enabled,
        },
        posted: {
          instagram: byPlat.instagram?.last_posted_at ?? null,
          tiktok: byPlat.tiktok?.last_posted_at ?? null,
          youtube: byPlat.youtube?.last_posted_at ?? null,
        },
        timesPosted: {
          instagram: byPlat.instagram?.times_posted ?? 0,
          tiktok: byPlat.tiktok?.times_posted ?? 0,
          youtube: byPlat.youtube?.times_posted ?? 0,
        },
        song_id: c.song_id ?? null,
        source_views: c.source_views ?? null,
        source_likes: c.source_likes ?? null,
      };
    });

    const cad: Cadence = { ...DEFAULT_CADENCE };
    for (const s of settingRows ?? []) if (s.platform in cad) cad[s.platform as Platform] = s.cadence_days;

    const c: Partial<Record<Platform, string | null>> = {};
    for (const row of connRows ?? []) c[row.platform as Platform] = row.username ?? null;

    setReels(mapped);
    setCadence(cad);
    setConns(c);
    setSongs((songRows as Song[]) ?? []);
    setClicks((clickRows as { song_id: string; target: string }[]) ?? []);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // A "Published to Instagram 🎉" banner has no business on the TikTok tab.
  useEffect(() => {
    setPostMsg(null);
  }, [plat]);

  const acc = PLATFORMS[plat];

  // ---- rotation rule (kept identical to reference/recirculate-ui.jsx):
  // never-posted first, then oldest last_posted_at. The reference left the
  // never-posted order unspecified; we tie-break by original post date so the
  // content people haven't seen the longest recirculates first. ----
  const inRot = reels.filter((r) => !r.archived && r.platforms[plat]);
  // Across-all-platforms recirculation stats, for the library view.
  const lastRecirc = (r: Reel) =>
    PK.reduce<string | null>((m, k) => {
      const p = r.posted[k];
      return p && (!m || p > m) ? p : m;
    }, null);
  const totalRecirc = (r: Reel) => PK.reduce((n, k) => n + (r.timesPosted[k] || 0), 0);
  // Library order = recirculation priority, same shape as the rotation rule but
  // across every platform: never-recirculated clips first (oldest original
  // first), then the ones untouched the longest — so nothing gets missed.
  const active = reels
    .filter((r) => !r.archived)
    .sort((a, b) => {
      const x = lastRecirc(a), y = lastRecirc(b);
      if (!x && !y) {
        const ax = a.posted_at ?? a.created_at ?? "";
        const bx = b.posted_at ?? b.created_at ?? "";
        return ax < bx ? -1 : ax > bx ? 1 : 0;
      }
      if (!x) return -1;
      if (!y) return 1;
      return +new Date(x) - +new Date(y);
    });
  const archived = reels.filter((r) => r.archived);

  // ---- library search + filters (counts double as at-a-glance stats) ----
  const q = query.trim().toLowerCase();
  const neverCount = active.filter((r) => totalRecirc(r) === 0).length;
  const notInRotCount = active.filter((r) => !r.platforms[plat]).length;
  const licensedCount = active.filter((r) => r.licensed_audio).length;
  const hitsCount = active.filter((r) => r.source_views != null).length;
  const base = active.filter((r) => {
    if (q && !`${r.title} ${r.caption} ${r.hashtags}`.toLowerCase().includes(q)) return false;
    if (filter === "never") return totalRecirc(r) === 0;
    if (filter === "notinrot") return !r.platforms[plat];
    if (filter === "licensed") return r.licensed_audio;
    if (filter === "hits") return r.source_views != null;
    return true;
  });
  // Top performers ranks by real audience numbers instead of rotation priority.
  const visible = filter === "hits" ? [...base].sort((a, b) => (b.source_views ?? 0) - (a.source_views ?? 0)) : base;
  const ordered = [...inRot].sort((a, b) => {
    const x = a.posted[plat], y = b.posted[plat];
    if (!x && !y) {
      const ax = a.posted_at ?? a.created_at ?? "";
      const bx = b.posted_at ?? b.created_at ?? "";
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    }
    if (!x) return -1;
    if (!y) return 1;
    return +new Date(x) - +new Date(y);
  });
  const upNext = ordered[0] || null;
  const globalLast = reels.reduce<string | null>((m, r) => {
    const p = r.posted[plat];
    return p && (!m || p > m) ? p : m;
  }, null);
  const sinceLast = globalLast ? daysBetween(globalLast, todayISO()) : null;
  const dueNow = !globalLast || (sinceLast as number) >= cadence[plat];
  const daysLeft = globalLast ? Math.max(0, cadence[plat] - (sinceLast as number)) : 0;

  // Cross-platform due map for the tab dots and the "post all due" button —
  // the same rotation rule as above, evaluated for every platform.
  const dueInfo = PK.map((k) => {
    const next =
      [...reels.filter((r) => !r.archived && r.platforms[k])].sort((a, b) => {
        const x = a.posted[k], y = b.posted[k];
        if (!x && !y) {
          const ax = a.posted_at ?? a.created_at ?? "";
          const bx = b.posted_at ?? b.created_at ?? "";
          return ax < bx ? -1 : ax > bx ? 1 : 0;
        }
        if (!x) return -1;
        if (!y) return 1;
        return +new Date(x) - +new Date(y);
      })[0] || null;
    const last = reels.reduce<string | null>((m, r) => {
      const p = r.posted[k];
      return p && (!m || p > m) ? p : m;
    }, null);
    return { plat: k, next, due: !!next && (!last || daysBetween(last, todayISO()) >= cadence[k]) };
  });
  const duePlats = dueInfo.filter((d) => d.due);

  // ---- mutations ----
  const changeCadence = async (delta: number) => {
    const next = Math.min(60, Math.max(1, cadence[plat] + delta));
    setCadence((c) => ({ ...c, [plat]: next }));
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("settings")
      .upsert({ user_id: u.user.id, platform: plat, cadence_days: next }, { onConflict: "user_id,platform" });
  };

  const markPosted = async (reel: Reel) => {
    const when = todayISO();
    const nextTimes = (reel.timesPosted[plat] || 0) + 1;
    // optimistic
    setReels((rs) =>
      rs.map((r) =>
        r.id === reel.id
          ? { ...r, posted: { ...r.posted, [plat]: when }, timesPosted: { ...r.timesPosted, [plat]: nextTimes } }
          : r
      )
    );
    await supabase
      .from("clip_platforms")
      .update({ last_posted_at: when, times_posted: nextTimes })
      .eq("clip_id", reel.id)
      .eq("platform", plat);
    await supabase.from("post_log").insert({ clip_id: reel.id, platform: plat, status: "success" });
  };

  const remove = async (reel: Reel) => {
    if (!window.confirm(`Delete "${reel.title}" and its video? This can't be undone.`)) return;
    setReels((rs) => rs.filter((r) => r.id !== reel.id));
    await supabase.from("clips").delete().eq("id", reel.id); // cascades clip_platforms
    // Clean up the stored files too, or the bucket fills with orphans.
    const paths = [reel.video_path, reel.thumb_path].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("clips").remove(paths).catch(() => {});
  };

  // Archive: keep the clip and its video, but pull it out of every rotation
  // and the main library view. Reversible, unlike delete.
  const setArchived = async (reel: Reel, value: boolean) => {
    setReels((rs) => rs.map((r) => (r.id === reel.id ? { ...r, archived: value } : r)));
    await supabase.from("clips").update({ archived: value }).eq("id", reel.id);
  };

  // Post the suggested next clip on every platform that's due, in one go.
  const postAllDue = async () => {
    if (posting) return;
    const targets = duePlats;
    if (targets.length < 2) return;
    const lines = targets.map((d) => `• ${PLATFORMS[d.plat].name}: "${d.next!.title}"`).join("\n");
    const tiktokNote = targets.some((d) => d.plat === "tiktok")
      ? "\n\nNote: TikTok posts land PRIVATE until their audit clears."
      : "";
    if (!window.confirm(`Post everything that's due?\n\n${lines}${tiktokNote}\n\nEach posts to your real account.`)) return;
    setPosting("__all");
    setPostMsg(null);
    const ok: string[] = [];
    const bad: string[] = [];
    for (const d of targets) {
      try {
        const res = await fetch(`/api/post/${d.plat}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clipId: d.next!.id }),
        });
        const body = await res.json();
        if (res.ok) ok.push(PLATFORMS[d.plat].name);
        else bad.push(`${PLATFORMS[d.plat].name}: ${body?.error || "failed"}`);
      } catch (e: any) {
        bad.push(`${PLATFORMS[d.plat].name}: ${e?.message || "failed"}`);
      }
    }
    setPostMsg({
      ok: bad.length === 0,
      text: [ok.length ? `Posted to ${ok.join(" + ")}. 🎉` : "", ...bad].filter(Boolean).join(" · "),
    });
    setLogRows(null);
    setPosting(null);
    await load();
  };

  // Flip one platform's rotation membership straight from the card — no form.
  const togglePlatform = async (reel: Reel, k: Platform) => {
    const next = !reel.platforms[k];
    setReels((rs) => rs.map((r) => (r.id === reel.id ? { ...r, platforms: { ...r.platforms, [k]: next } } : r)));
    await supabase
      .from("clip_platforms")
      .upsert({ clip_id: reel.id, platform: k, enabled: next }, { onConflict: "clip_id,platform" });
  };

  // Onboard the whole back catalog in one tap instead of one form per clip.
  const enableAllOn = async (k: Platform) => {
    const missing = active.filter((r) => !r.platforms[k]);
    if (!missing.length) return;
    if (!window.confirm(`Add ${missing.length} clip${missing.length === 1 ? "" : "s"} to the ${PLATFORMS[k].name} rotation?`)) return;
    const ids = new Set(missing.map((r) => r.id));
    setReels((rs) => rs.map((r) => (ids.has(r.id) ? { ...r, platforms: { ...r.platforms, [k]: true } } : r)));
    await supabase
      .from("clip_platforms")
      .upsert(missing.map((r) => ({ clip_id: r.id, platform: k, enabled: true })), { onConflict: "clip_id,platform" });
  };

  const toggleLog = async () => {
    const next = !showLog;
    setShowLog(next);
    if (next && !logRows) {
      const { data } = await supabase
        .from("post_log")
        .select("id, platform, posted_at, status, error, views, likes, clips(title)")
        .order("posted_at", { ascending: false })
        .limit(25);
      setLogRows(data ?? []);
    }
  };

  // Pull fresh view/like counts from Instagram (originals + reposts) and
  // YouTube. Takes a little while — it's one API call per Instagram media.
  const refreshStats = async () => {
    if (statsBusy) return;
    setStatsBusy(true);
    setStatsMsg(null);
    try {
      const res = await fetch("/api/metrics/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setStatsMsg({ ok: false, text: body?.error || "Stats refresh failed." });
      } else {
        const bits = [
          `${body.instagram_originals ?? 0} originals`,
          `${body.instagram_posts ?? 0} IG reposts`,
          `${body.youtube_posts ?? 0} Shorts`,
        ];
        const errs = (body.errors ?? []).join(" · ");
        setStatsMsg({
          ok: !errs,
          text: `Stats updated: ${bits.join(" · ")}.` + (errs ? ` ${errs}` : ""),
        });
        setLogRows(null);
        await load();
      }
    } catch (e: any) {
      setStatsMsg({ ok: false, text: e?.message || "Stats refresh failed." });
    } finally {
      setStatsBusy(false);
    }
  };

  // Real publish: posts the clip to the selected platform, then advances the
  // rotation server-side. This posts to the live account, so we confirm first.
  const publishClip = async (clip: Reel) => {
    if (posting) return;
    const name = PLATFORMS[plat].name;
    const tiktokNote =
      plat === "tiktok"
        ? "\n\nNote: until the TikTok app passes their audit, posts land as PRIVATE (only you can see them)."
        : "";
    const audioNote =
      clip.licensed_audio && plat !== "instagram"
        ? `\n\n⚠️ This clip uses Instagram licensed music — ${name} may mute it or flag it with Content ID.`
        : "";
    if (!window.confirm(`Publish "${clip.title}" to ${name} now?\n\nThis posts to your real ${name} account.${audioNote}${tiktokNote}`)) return;
    setPosting(clip.id);
    setPostMsg(null);
    try {
      const res = await fetch(`/api/post/${plat}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId: clip.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostMsg({ ok: false, text: data?.error || "Publish failed." });
      } else {
        setPostMsg({ ok: true, text: `Published "${clip.title}" to ${name}. 🎉` });
        setLogRows(null); // stale now — refetch on next open
        await load();
      }
    } catch (e: any) {
      setPostMsg({ ok: false, text: e?.message || "Publish failed." });
    } finally {
      setPosting(null);
    }
  };

  // Arrived via a digest-email link: pop the publish confirm for this
  // platform's suggested clip as soon as the library is loaded. One-shot —
  // the URL is cleaned so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (!loaded || !reviewPending.current) return;
    reviewPending.current = false;
    window.history.replaceState({}, "", "/");
    if (upNext) publishClip(upNext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/import/instagram", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setImportMsg({ ok: false, text: body?.error || "Import failed." });
      } else {
        const { added, skipped, thumbed, failed } = body as { added: number; skipped: number; thumbed?: number; failed?: number };
        const bits = [`Imported ${added} new`, `skipped ${skipped} already in library`];
        if (thumbed) bits.push(`added ${thumbed} thumbnail${thumbed === 1 ? "" : "s"}`);
        if (failed) bits.push(`${failed} failed`);
        setImportMsg({ ok: true, text: bits.join(" · ") + "." });
        await load();
      }
    } catch (e: any) {
      setImportMsg({ ok: false, text: e?.message || "Import failed." });
    } finally {
      setImporting(false);
    }
  };

  const copyCaption = (r: Reel) => {
    const t = [r.caption, r.hashtags].filter(Boolean).join("\n\n");
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveReel = async (data: ReelFormData) => {
    let clipId = data.id;

    if (clipId) {
      await supabase
        .from("clips")
        .update({ title: data.title, caption: data.caption, hashtags: data.hashtags, video_path: data.video_path, thumb_path: data.thumb_path, licensed_audio: data.licensed_audio, song_id: data.song_id })
        .eq("id", clipId);
    } else {
      const { data: inserted, error } = await supabase
        .from("clips")
        .insert({ title: data.title, caption: data.caption, hashtags: data.hashtags, video_path: data.video_path, thumb_path: data.thumb_path, licensed_audio: data.licensed_audio, song_id: data.song_id })
        .select("id")
        .single();
      if (error || !inserted) return;
      clipId = inserted.id;
    }

    // Upsert all three platform rows; last_posted_at / times_posted are omitted so
    // existing rotation history is preserved on edit.
    const rows = PK.map((p) => ({
      clip_id: clipId!,
      platform: p,
      enabled: data.platforms[p],
      link: data.links[p] ?? "",
    }));
    await supabase.from("clip_platforms").upsert(rows, { onConflict: "clip_id,platform" });

    setEditing(null);
    await load();
  };

  // Songs (smart links): create/update with a slug derived once from the
  // title, so shared /listen URLs never break on rename.
  const saveSong = async (s: Partial<Song> & { title: string }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (s.id) {
      await supabase
        .from("songs")
        .update({ title: s.title, spotify_url: s.spotify_url ?? "", apple_url: s.apple_url ?? "", youtube_url: s.youtube_url ?? "" })
        .eq("id", s.id);
    } else {
      await supabase.from("songs").insert({
        user_id: u.user.id,
        title: s.title,
        slug: slugify(s.title),
        spotify_url: s.spotify_url ?? "",
        apple_url: s.apple_url ?? "",
        youtube_url: s.youtube_url ?? "",
      });
    }
    setSongEditing(null);
    await load();
  };

  const deleteSong = async (s: Song) => {
    if (!window.confirm(`Delete "${s.title}"? Its /listen page stops working and clips lose the link.`)) return;
    setSongs((ss) => ss.filter((x) => x.id !== s.id));
    await supabase.from("songs").delete().eq("id", s.id);
  };

  const songClicks = (songId: string) => {
    const rows = clicks.filter((c) => c.song_id === songId);
    const by = (t: string) => rows.filter((c) => c.target === t).length;
    return { total: rows.length, spotify: by("spotify"), apple: by("apple"), youtube: by("youtube") };
  };

  if (!loaded) return <div style={{ background: "#15101B", minHeight: "100vh" }} />;

  return (
    <div
      className="rc-root"
      style={
        {
          "--acc-a": acc.a,
          "--acc-b": acc.b,
          background: `radial-gradient(120% 60% at 50% -10%, ${acc.a}28 0%, transparent 60%), var(--bg)`,
        } as React.CSSProperties
      }
    >
      <div className="rc-wrap">
        <div className="rc-topbar">
          <div>
            <h1 className="rc-h1">Recirculate</h1>
            <p className="rc-sub">Your short-form clips, back in rotation across every platform.</p>
          </div>
          <form action="/auth/signout" method="post">
            <button className="rc-signout" type="submit" title={email}>
              <LogOut size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
              Sign out
            </button>
          </form>
        </div>

        <div className="rc-tabs">
          {PK.map((k) => (
            <button
              key={k}
              className={"rc-tab" + (k === plat ? " on" : "")}
              onClick={() => setPlat(k)}
              style={k === plat ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})` } : {}}
            >
              <Icon p={k} size={17} color={k === plat ? "#15101B" : "var(--muted)"} />
              {PLATFORMS[k].name}
              <small>{PLATFORMS[k].sub}</small>
              {dueInfo.find((d) => d.plat === k)?.due && (
                <span
                  title="Due — something is ready to post"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: k === plat ? "#15101B" : PLATFORMS[k].a,
                    flex: "0 0 auto",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {notice && (
          <div className={"rc-msg " + (notice.ok ? "ok" : "err")} style={{ margin: "0 0 12px" }}>
            {notice.text}
          </div>
        )}

        <div className="rc-deck" style={{ padding: "0 2px 12px" }}>
          {PK.map((k) =>
            k in conns ? (
              <div key={k} className="rc-chip" title={`${PLATFORMS[k].name} connected`}>
                <Icon p={k} size={12} color={PLATFORMS[k].a} /> <b>{conns[k] || "Connected"}</b> ✓
              </div>
            ) : k === "instagram" ? (
              <div key={k} className="rc-chip" title="Instagram connects via a pasted token — see setup">
                <Icon p={k} size={12} color="var(--muted)" /> Not connected
              </div>
            ) : (
              <a key={k} className="rc-chip" href={`/api/connect/${k}`} style={{ color: "var(--text)", textDecoration: "none" }}>
                <Icon p={k} size={12} color={PLATFORMS[k].a} /> Connect {PLATFORMS[k].name}
              </a>
            )
          )}
        </div>

        <div className="rc-cadence">
          <RotateCw size={15} color={acc.b} />
          <span>Repost a {acc.sub} every</span>
          <button className="rc-step" onClick={() => changeCadence(-1)} aria-label="Fewer days">–</button>
          <span className="rc-num">{cadence[plat]}</span>
          <button className="rc-step" onClick={() => changeCadence(1)} aria-label="More days">+</button>
          <span>{cadence[plat] === 1 ? "day" : "days"}</span>
        </div>

        {duePlats.length >= 2 && (
          <button
            className="rc-btn primary"
            style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}
            onClick={postAllDue}
            disabled={posting !== null}
          >
            <Send size={15} />
            {posting === "__all" ? "Posting everywhere…" : `Post all due (${duePlats.length})`}
          </button>
        )}

        {upNext ? (
          <div className={"rc-hero" + (dueNow ? " due" : "")}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="rc-eyebrow">
                <Icon p={plat} size={12} color={acc.b} /> Up next on {acc.name}
              </span>
              <span className="rc-status">
                <Clock size={12} />
                {dueNow ? "Ready to post now" : `Due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}
              </span>
            </div>
            <div className="rc-title">{upNext.title}</div>
            {upNext.video_path && (
              <video
                key={upNext.id}
                style={{ display: "block", margin: "0 auto 10px", width: "auto", height: "auto", maxWidth: "100%", maxHeight: 360, borderRadius: 14, background: "#000" }}
                src={publicUrl(upNext.video_path)}
                poster={upNext.thumb_path ? publicUrl(upNext.thumb_path) : undefined}
                controls
                playsInline
                preload={upNext.thumb_path ? "none" : "metadata"}
              />
            )}
            {upNext.caption && <div className="rc-cap">{upNext.caption}</div>}
            {upNext.hashtags && <div className="rc-tags">{upNext.hashtags}</div>}
            <div className="rc-actions">
              <button className="rc-btn primary" onClick={() => publishClip(upNext)} disabled={posting === upNext.id}>
                <Send size={15} /> {posting === upNext.id ? "Publishing…" : `Publish to ${acc.name}`}
              </button>
              <button className="rc-btn ghost" onClick={() => copyCaption(upNext)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy caption"}
              </button>
              <button className="rc-btn ghost" onClick={() => markPosted(upNext)} title="Just record it as posted without publishing">
                <Check size={15} /> Mark posted
              </button>
            </div>
            {postMsg && (
              <div className={"rc-msg " + (postMsg.ok ? "ok" : "err")} style={{ marginTop: 12 }}>
                {postMsg.text}
              </div>
            )}
          </div>
        ) : (
          <div className="rc-empty">
            {reels.length === 0 ? (
              <>No clips yet.<br />Add your best ones below and they&apos;ll start cycling back around.</>
            ) : (
              <>Nothing set for {acc.name} yet.<br />Open a clip in your library and switch on {acc.name}.</>
            )}
          </div>
        )}

        {ordered.length > 1 && (
          <>
            <div className="rc-deck-label">Then back around to</div>
            <div className="rc-deck">
              {ordered.slice(1).map((r, i) => (
                <div key={r.id} className="rc-chip">
                  <b>{i + 2}.</b> {r.title}
                </div>
              ))}
              <div className="rc-chip" style={{ color: acc.a }}>↻ loops</div>
            </div>
          </>
        )}

        <div className="rc-libhead">
          <h2>
            Library {active.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {active.length}</span>}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="rc-add" onClick={runImport} disabled={importing} title="Pull your Instagram Reels into the library">
              <Download size={14} /> {importing ? "Importing…" : "Import from Instagram"}
            </button>
            {editing !== "new" && (
              <button className="rc-add" onClick={() => setEditing("new")}>
                <Plus size={14} /> Add clip
              </button>
            )}
          </div>
        </div>

        <div style={{ position: "relative", margin: "0 0 8px" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            className="rc-input"
            style={{ paddingLeft: 34 }}
            placeholder="Search clips…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 8px" }}>
          {(
            [
              ["all", `All · ${active.length}`],
              ["never", `Never recirculated · ${neverCount}`],
              ["notinrot", `Not on ${acc.name} · ${notInRotCount}`],
              ["licensed", `Licensed audio · ${licensedCount}`],
              ...(hitsCount > 0 ? ([["hits", `Top performers · ${hitsCount}`]] as const) : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className="rc-chip"
              onClick={() => setFilter(key)}
              style={{
                cursor: "pointer",
                fontFamily: "inherit",
                ...(filter === key ? { color: "var(--text)", borderColor: acc.a, background: "var(--surface2)" } : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {filter === "notinrot" && notInRotCount > 0 && (
          <button className="rc-add" style={{ marginBottom: 8 }} onClick={() => enableAllOn(plat)}>
            <Plus size={14} /> Add all {notInRotCount} to {acc.name} rotation
          </button>
        )}
        <p className="rc-meta" style={{ margin: "0 0 10px" }}>
          Sorted by priority — never-recirculated clips first, then the ones untouched the longest.
        </p>

        {importMsg && (
          <div className={"rc-msg " + (importMsg.ok ? "ok" : "err")} style={{ marginBottom: 10 }}>
            {importMsg.text}
          </div>
        )}

        {editing === "new" && <ReelForm songs={songs} onSave={saveReel} onCancel={() => setEditing(null)} publicUrl={publicUrl} supabase={supabase} />}

        {visible.length === 0 && (query || filter !== "all") && (
          <div className="rc-empty">No clips match{query ? ` “${query}”` : " this filter"}.</div>
        )}

        {visible.map((r) =>
          editing === r.id ? (
            <ReelForm key={r.id} reel={r} songs={songs} onSave={saveReel} onCancel={() => setEditing(null)} publicUrl={publicUrl} supabase={supabase} />
          ) : (
            <div key={r.id} className={"rc-card" + (upNext && r.id === upNext.id ? " upnext" : "")}>
              {r.thumb_path ? (
                <img className="rc-thumb" src={publicUrl(r.thumb_path)} alt="" loading="lazy" />
              ) : (
                r.video_path && <video className="rc-thumb" src={publicUrl(r.video_path)} muted playsInline preload="none" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="rc-cardtitle">{r.title}</p>
                <div className="rc-badges">
                  {PK.map((k) => (
                    <button
                      key={k}
                      className="rc-badge"
                      onClick={() => togglePlatform(r, k)}
                      title={
                        r.platforms[k]
                          ? `In ${PLATFORMS[k].name} rotation — tap to remove`
                          : `Tap to add to ${PLATFORMS[k].name} rotation`
                      }
                      aria-label={`Toggle ${PLATFORMS[k].name} rotation`}
                      style={{
                        cursor: "pointer",
                        border: "none",
                        padding: 0,
                        font: "inherit",
                        ...(r.platforms[k]
                          ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})` }
                          : {}),
                      }}
                    >
                      <Icon p={k} size={13} color={r.platforms[k] ? "#15101B" : "var(--muted)"} />
                    </button>
                  ))}
                </div>
                {totalRecirc(r) === 0 ? (
                  <p className="rc-meta" style={{ color: acc.a, fontWeight: 600 }}>
                    Never recirculated
                  </p>
                ) : (
                  <p className="rc-meta">
                    {`Recirculated ${totalRecirc(r)}× · last ${fmt(lastRecirc(r)!)} · `}
                    {PK.filter((k) => (r.timesPosted[k] || 0) > 0)
                      .map((k) => `${PLATFORMS[k].name} ${r.timesPosted[k]}× (${fmt(r.posted[k]!)})`)
                      .join(" · ")}
                  </p>
                )}
                {(!r.platforms[plat] || r.posted_at) && (
                  <p className="rc-meta">
                    {[!r.platforms[plat] ? `Not in ${acc.name} rotation` : "", r.posted_at ? `Original ${fmtMonthYear(r.posted_at)}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {(r.source === "instagram" || r.licensed_audio || r.song_id || r.source_views != null) && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {r.source_views != null && (
                      <span className="rc-tag-chip" title="Views on the original Instagram post">
                        ▶ {fmtNum(r.source_views)}
                        {r.source_likes != null ? ` · ♥ ${fmtNum(r.source_likes)}` : ""}
                      </span>
                    )}
                    {r.song_id && (
                      <span className="rc-tag-chip" title="Publishes include this song's tracked listen link">
                        <Music size={11} /> {songs.find((s) => s.id === r.song_id)?.title ?? "Song"}
                      </span>
                    )}
                    {r.source === "instagram" && (
                      <span className="rc-tag-chip">
                        <Icon p="instagram" size={11} color="var(--lilac)" /> Imported
                      </span>
                    )}
                    {r.licensed_audio && (
                      <span className="rc-tag-chip warn" title="Uses Instagram licensed music — may trip Content ID on TikTok/YouTube">
                        <Music size={11} /> Licensed audio
                      </span>
                    )}
                  </div>
                )}
              </div>
              {r.platforms[plat] && (
                <button
                  className="rc-icbtn"
                  onClick={() => publishClip(r)}
                  disabled={posting === r.id}
                  aria-label={`Publish to ${acc.name} now`}
                  title={`Publish to ${acc.name} now`}
                >
                  <Send size={15} />
                </button>
              )}
              <button className="rc-icbtn" onClick={() => setEditing(r.id)} aria-label="Edit">
                <Pencil size={15} />
              </button>
              <button
                className="rc-icbtn"
                onClick={() => setArchived(r, true)}
                aria-label="Archive — keep the clip but never reshare it"
                title="Archive — keep the clip but never reshare it"
              >
                <Archive size={15} />
              </button>
              <button className="rc-icbtn" onClick={() => remove(r)} aria-label="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          )
        )}

        {archived.length > 0 && (
          <>
            <button className="rc-add" style={{ marginTop: 14 }} onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} /> {showArchived ? "Hide" : "Show"} archived · {archived.length}
            </button>
            {showArchived && (
              <div style={{ marginTop: 10, opacity: 0.75 }}>
                {archived.map((r) => (
                  <div key={r.id} className="rc-card">
                    {r.thumb_path ? (
                      <img className="rc-thumb" src={publicUrl(r.thumb_path)} alt="" loading="lazy" />
                    ) : (
                      r.video_path && <video className="rc-thumb" src={publicUrl(r.video_path)} muted playsInline preload="none" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="rc-cardtitle">{r.title}</p>
                      <p className="rc-meta">
                        Archived — not in any rotation
                        {r.posted_at ? ` · original ${fmtMonthYear(r.posted_at)}` : ""}
                      </p>
                    </div>
                    <button
                      className="rc-icbtn"
                      onClick={() => setArchived(r, false)}
                      aria-label="Restore to library"
                      title="Restore to library"
                    >
                      <ArchiveRestore size={15} />
                    </button>
                    <button className="rc-icbtn" onClick={() => remove(r)} aria-label="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <button
          className="rc-add"
          style={{ marginTop: 14, marginRight: 8 }}
          onClick={refreshStats}
          disabled={statsBusy}
          title="Pull view/like counts from Instagram and YouTube"
        >
          <RotateCw size={14} /> {statsBusy ? "Refreshing stats…" : "Refresh stats"}
        </button>
        <button className="rc-add" style={{ marginTop: 14, marginRight: 8 }} onClick={() => setShowSongs((v) => !v)}>
          <Music size={14} /> {showSongs ? "Hide" : "Show"} songs &amp; links{songs.length ? ` · ${songs.length}` : ""}
        </button>
        {statsMsg && (
          <div className={"rc-msg " + (statsMsg.ok ? "ok" : "err")} style={{ marginTop: 10 }}>
            {statsMsg.text}
          </div>
        )}
        {showSongs && (
          <div style={{ marginTop: 10 }}>
            {songEditing === "new" ? (
              <SongForm onSave={saveSong} onCancel={() => setSongEditing(null)} />
            ) : (
              <button className="rc-add" style={{ marginBottom: 10 }} onClick={() => setSongEditing("new")}>
                <Plus size={14} /> Add song
              </button>
            )}
            {songs.length === 0 && songEditing !== "new" && (
              <div className="rc-empty">
                Add a song with its Spotify / Apple Music / YouTube links.
                <br />
                Assign it to clips and every publish gets a tracked listen link.
              </div>
            )}
            {songs.map((s) =>
              songEditing === s.id ? (
                <SongForm key={s.id} song={s} onSave={saveSong} onCancel={() => setSongEditing(null)} />
              ) : (
                <div key={s.id} className="rc-card" style={{ alignItems: "center" }}>
                  <Music size={16} color="var(--lilac)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="rc-cardtitle">{s.title}</p>
                    <p className="rc-meta" style={{ margin: "3px 0 0" }}>
                      {(() => {
                        const st = songClicks(s.id);
                        return st.total === 0
                          ? "No clicks yet"
                          : `${st.total} click${st.total === 1 ? "" : "s"} · Spotify ${st.spotify} · Apple ${st.apple} · YouTube ${st.youtube}`;
                      })()}
                    </p>
                    <p className="rc-meta" style={{ margin: "3px 0 0" }}>
                      <a href={`/listen/${s.slug}`} target="_blank" rel="noreferrer" style={{ color: "var(--lilac)" }}>
                        /listen/{s.slug} ↗
                      </a>
                    </p>
                  </div>
                  <button className="rc-icbtn" onClick={() => setSongEditing(s.id)} aria-label="Edit song">
                    <Pencil size={15} />
                  </button>
                  <button className="rc-icbtn" onClick={() => deleteSong(s)} aria-label="Delete song">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <button className="rc-add" style={{ marginTop: 14 }} onClick={toggleLog}>
          <History size={14} /> {showLog ? "Hide" : "Show"} activity
        </button>
        {showLog && (
          <div style={{ marginTop: 10 }}>
            {logRows === null ? (
              <div className="rc-empty">Loading…</div>
            ) : logRows.length === 0 ? (
              <div className="rc-empty">Nothing logged yet — every publish (and failure) will show up here.</div>
            ) : (
              logRows.map((row) => (
                <div key={row.id} className="rc-card" style={{ padding: "10px 14px", alignItems: "center" }}>
                  <Icon p={row.platform as Platform} size={15} color="var(--muted)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="rc-cardtitle" style={{ fontSize: 13 }}>{row.clips?.title ?? "Deleted clip"}</p>
                    <p className="rc-meta" style={{ margin: "2px 0 0" }}>
                      {PLATFORMS[row.platform as Platform]?.name ?? row.platform} · {fmtDT(row.posted_at)}
                      {row.views != null ? ` · ▶ ${fmtNum(row.views)}` : ""}
                      {row.likes != null ? ` · ♥ ${fmtNum(row.likes)}` : ""}
                      {row.status !== "success" && row.error ? ` — ${row.error}` : ""}
                    </p>
                  </div>
                  {row.status === "success" ? <Check size={14} color="#7ED9A0" /> : <X size={14} color="#FF5C7A" />}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReelForm({
  reel,
  songs,
  onSave,
  onCancel,
  publicUrl,
  supabase,
}: {
  reel?: Reel;
  songs: Song[];
  onSave: (d: ReelFormData) => Promise<void>;
  onCancel: () => void;
  publicUrl: (p: string) => string;
  supabase: ReturnType<typeof createSupabaseBrowser>;
}) {
  const [title, setTitle] = useState(reel?.title || "");
  const [songId, setSongId] = useState<string | null>(reel?.song_id ?? null);
  const [caption, setCaption] = useState(reel?.caption || "");
  const [hashtags, setHashtags] = useState(reel?.hashtags || "");
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>(
    reel?.platforms || { instagram: true, tiktok: false, youtube: false }
  );
  const [links, setLinks] = useState<Record<Platform, string>>(reel?.links || emptyMap(""));
  const [videoPath, setVideoPath] = useState<string | null>(reel?.video_path ?? null);
  const [licensedAudio, setLicensedAudio] = useState<boolean>(reel?.licensed_audio ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [err, setErr] = useState("");

  // AI rewrite: asks the server (Claude) for a fresh take on the caption. The
  // result lands in the textarea for review — nothing saves until you save.
  const rewriteCaption = async () => {
    if (rewriting) return;
    setRewriting(true);
    setErr("");
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, caption }),
      });
      const data = await res.json();
      if (!res.ok) setErr(data?.error || "Rewrite failed.");
      else setCaption(data.caption);
    } catch (e: any) {
      setErr(e?.message || "Rewrite failed.");
    } finally {
      setRewriting(false);
    }
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      let path = videoPath;
      let thumb = reel?.thumb_path ?? null;
      if (file) {
        const { data: u } = await supabase.auth.getUser();
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const key = `${u.user?.id ?? "anon"}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from("clips").upload(key, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "video/mp4",
        });
        if (error) {
          setErr("Upload failed: " + error.message);
          setBusy(false);
          return;
        }
        // Replacing the video: the old file (and its now-stale thumbnail)
        // would otherwise be orphaned in the bucket forever.
        const stale = [reel?.video_path, reel?.thumb_path].filter(Boolean) as string[];
        if (stale.length) await supabase.storage.from("clips").remove(stale).catch(() => {});
        path = key;
        thumb = null;
      }
      await onSave({ id: reel?.id, title: title.trim(), caption, hashtags, platforms, links, video_path: path, thumb_path: thumb, licensed_audio: licensedAudio, song_id: songId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-form">
      <label className="rc-label">Clip name</label>
      <input className="rc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lev Tahor — chorus clip" />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label className="rc-label" style={{ margin: "13px 0 5px" }}>Caption</label>
        <button
          type="button"
          className="rc-add"
          style={{ padding: "4px 9px", fontSize: 11.5 }}
          onClick={rewriteCaption}
          disabled={rewriting || (!caption.trim() && !title.trim())}
          title="Have AI rewrite the caption so the repost reads fresh"
        >
          <Sparkles size={12} /> {rewriting ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      <textarea className="rc-area" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="The caption you'll paste when you repost." />

      <label className="rc-label">Hashtags</label>
      <textarea className="rc-area" rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#yourtags #here" />

      {songs.length > 0 && (
        <>
          <label className="rc-label">Song — publishes add its tracked listen link to the caption</label>
          <select className="rc-input" value={songId ?? ""} onChange={(e) => setSongId(e.target.value || null)}>
            <option value="">— no song link —</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </>
      )}

      <label className="rc-label">Video</label>
      <div className="rc-file">
        {videoPath && !file && (
          <video
            src={publicUrl(videoPath)}
            poster={reel?.thumb_path ? publicUrl(reel.thumb_path) : undefined}
            style={{ display: "block", margin: "0 auto 6px", width: "auto", height: "auto", maxWidth: "100%", maxHeight: 320, borderRadius: 12, background: "#000" }}
            controls
            playsInline
            preload={reel?.thumb_path ? "none" : "metadata"}
          />
        )}
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <div style={{ marginTop: 6 }}>Selected: {file.name}</div>}
        {videoPath && !file && <div style={{ marginTop: 4 }}>Current: {videoPath.split("/").pop()}</div>}
      </div>

      <button
        type="button"
        className={"rc-tog" + (licensedAudio ? " on" : "")}
        onClick={() => setLicensedAudio((v) => !v)}
        style={licensedAudio ? { background: "linear-gradient(135deg,#FF5C7A,#FFA24C)", color: "#15101B" } : {}}
      >
        <Music size={16} color={licensedAudio ? "#15101B" : "var(--muted)"} />
        Licensed audio <span style={{ opacity: 0.7, fontWeight: 400 }}>· may trip Content ID on TikTok/YouTube</span>
        <span className="rc-switch"><span className="rc-knob" /></span>
      </button>

      <label className="rc-label">Post this clip to</label>
      {PK.map((k) => (
        <div key={k}>
          <button
            className={"rc-tog" + (platforms[k] ? " on" : "")}
            onClick={() => setPlatforms((p) => ({ ...p, [k]: !p[k] }))}
            style={platforms[k] ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})`, color: "#15101B" } : {}}
          >
            <Icon p={k} size={16} color={platforms[k] ? "#15101B" : "var(--muted)"} />
            {PLATFORMS[k].name} <span style={{ opacity: 0.7, fontWeight: 400 }}>· {PLATFORMS[k].sub}</span>
            <span className="rc-switch"><span className="rc-knob" /></span>
          </button>
          {platforms[k] && (
            <div className="rc-sublink">
              <input
                className="rc-input"
                value={links[k]}
                onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))}
                placeholder={`Link to this clip on ${PLATFORMS[k].name} (optional)`}
              />
            </div>
          )}
        </div>
      ))}

      {err && <div className="rc-msg err">{err}</div>}

      <div className="rc-formrow">
        <button className="rc-btn ghost" onClick={onCancel} style={{ flex: 0, minWidth: 0, padding: "11px 16px" }}>
          <X size={15} />
        </button>
        <button className="rc-btn primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : reel ? "Save changes" : "Add to rotation"}
        </button>
      </div>
    </div>
  );
}

function SongForm({
  song,
  onSave,
  onCancel,
}: {
  song?: Song;
  onSave: (s: Partial<Song> & { title: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(song?.title || "");
  const [spotify, setSpotify] = useState(song?.spotify_url || "");
  const [apple, setApple] = useState(song?.apple_url || "");
  const [youtube, setYoutube] = useState(song?.youtube_url || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        id: song?.id,
        title: title.trim(),
        spotify_url: spotify.trim(),
        apple_url: apple.trim(),
        youtube_url: youtube.trim(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-form">
      <label className="rc-label">Song title</label>
      <input className="rc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hallelujah" />
      <label className="rc-label">Spotify link</label>
      <input className="rc-input" value={spotify} onChange={(e) => setSpotify(e.target.value)} placeholder="https://open.spotify.com/track/…" />
      <label className="rc-label">Apple Music link</label>
      <input className="rc-input" value={apple} onChange={(e) => setApple(e.target.value)} placeholder="https://music.apple.com/…" />
      <label className="rc-label">YouTube link</label>
      <input className="rc-input" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtu.be/…" />
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="rc-btn primary" disabled={busy || !title.trim()} onClick={save}>
          <Check size={15} /> {busy ? "Saving…" : "Save song"}
        </button>
        <button className="rc-btn ghost" onClick={onCancel}>
          <X size={15} /> Cancel
        </button>
      </div>
    </div>
  );
}
