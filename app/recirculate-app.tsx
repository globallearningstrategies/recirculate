"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Copy, Check, Trash2, Pencil, Clock, RotateCw, X, LogOut, Download, Music, Send, Archive, ArchiveRestore, Sparkles, Search, History, CalendarClock, Megaphone, Clapperboard, Share2, LayoutGrid, MoreHorizontal, MessageCircle, Bell, Facebook } from "lucide-react";
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
  campaign_until: string | null;
};

type Curator = {
  id: string;
  name: string;
  contact_email: string;
  playlist_url: string;
  note: string;
  status: string; // new | pitched | placed | passed
  last_contact: string | null;
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
  const [posting, setPosting] = useState<string | null>(null);
  // One toast for every outcome — publish, import, stats, schedule — fixed
  // above the nav bar where the thumb already is.
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<"queue" | "library" | "songs" | "activity" | "inbox">("queue");
  // Comments inbox
  const [inbox, setInbox] = useState<{ id: string; platform: Platform; author: string; text: string; when: string; media: string | null }[] | null>(null);
  const [inboxErrs, setInboxErrs] = useState<string[]>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null); // card with the ⋯ actions open
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "never" | "notinrot" | "licensed" | "hits">("all");
  const [statsBusy, setStatsBusy] = useState(false);
  const [logRows, setLogRows] = useState<any[] | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [clicks, setClicks] = useState<{ song_id: string; target: string }[]>([]);
  const [songEditing, setSongEditing] = useState<string | null>(null); // song id | "new" | null
  const [sched, setSched] = useState<{ id: string; clip_id: string; platform: Platform; run_at: string }[]>([]);
  const [schedClip, setSchedClip] = useState<Reel | null>(null); // clip being scheduled to current tab's platform
  const [schedDate, setSchedDate] = useState("");
  // Meta ads promote panel
  const [promoClip, setPromoClip] = useState<Reel | null>(null);
  const [promoBudget, setPromoBudget] = useState("10");
  const [promoDays, setPromoDays] = useState("7");
  const [promoAudience, setPromoAudience] = useState(""); // "kind:id"
  const [audiences, setAudiences] = useState<{ id: string; name: string; kind: "saved" | "custom" }[] | null>(null);
  const [lalCountry, setLalCountry] = useState("US");
  const [lalBusy, setLalBusy] = useState(false);
  // Lead magnet + curator outreach
  const [magnet, setMagnet] = useState<{ id: string; title: string; file_path: string } | null>(null);
  const [curators, setCurators] = useState<Curator[]>([]);
  const [pitchCurator, setPitchCurator] = useState<Curator | null>(null);
  const [pitchSongId, setPitchSongId] = useState("");
  const [pitchSubject, setPitchSubject] = useState("");
  const [pitchBody, setPitchBody] = useState("");
  const [pitchBusy, setPitchBusy] = useState<"draft" | "send" | null>(null);
  const [adsConfigured, setAdsConfigured] = useState<boolean | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [lyricSong, setLyricSong] = useState<Song | null>(null);
  // platform → username (null = connected but no display name); key absent = not connected
  const [conns, setConns] = useState<Partial<Record<Platform, string | null>>>({});
  // Web Push: "prompt" = supported but not yet enabled (show the bell button)
  const [pushState, setPushState] = useState<"unsupported" | "prompt" | "on" | "denied">("unsupported");

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
        supabase.from("songs").select("id,title,slug,spotify_url,apple_url,youtube_url,campaign_until").order("created_at", { ascending: false }),
        supabase.from("link_clicks").select("song_id,target"),
      ]);
    const { data: schedRows } = await supabase
      .from("scheduled_posts")
      .select("id, clip_id, platform, run_at")
      .eq("status", "pending")
      .order("run_at", { ascending: true });
    const [{ data: magnetRow }, { data: curatorRows }] = await Promise.all([
      supabase.from("lead_magnet").select("id, title, file_path").limit(1).maybeSingle(),
      supabase.from("curators").select("*").order("created_at", { ascending: false }),
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
    setSched((schedRows as any[]) ?? []);
    setMagnet((magnetRow as any) ?? null);
    setCurators((curatorRows as Curator[]) ?? []);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // A "Published to Instagram 🎉" banner has no business on the TikTok tab.
  useEffect(() => {
    setToast(null);
  }, [plat]);

  // Good news dismisses itself; errors stay until replaced or tapped away.
  useEffect(() => {
    if (!toast?.ok) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Web Push (iOS supports it for installed PWAs) ----
  const pushSubscribe = useCallback(async () => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return false;
    const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "="));
    const appKey = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
    // register() (idempotent) instead of .ready — .ready never settles if the
    // initial registration failed, which would hang the bell button forever.
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const json = sub.toJSON();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || !json.endpoint || !json.keys) return false;
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        { user_id: u.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "endpoint" }
      );
    return !error;
  }, [supabase]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    ) {
      return; // stays "unsupported" — the bell simply never shows
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (Notification.permission === "granted") {
      setPushState("on");
      pushSubscribe().catch(() => {}); // keep the subscription fresh
    } else if (Notification.permission === "denied") {
      setPushState("denied");
    } else {
      setPushState("prompt");
    }
  }, [pushSubscribe]);

  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushState(perm === "denied" ? "denied" : "prompt");
        return;
      }
      const ok = await pushSubscribe();
      setPushState(ok ? "on" : "prompt"); // keep the bell visible so a failed save can be retried
      setToast({
        ok,
        text: ok ? "Notifications on — you'll get a buzz when something's due. 🔔" : "Saving the subscription failed — tap the bell to try again.",
      });
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Couldn't enable notifications." });
    }
  };

  const refreshInbox = useCallback(async () => {
    setInboxBusy(true);
    try {
      const res = await fetch("/api/comments");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Couldn't load comments.");
      setInbox(body.items ?? []);
      setInboxErrs(body.errors ?? []);
    } catch {
      setInbox([]);
      setInboxErrs(["Couldn't load comments — try again."]);
    } finally {
      setInboxBusy(false);
    }
  }, []);

  // The Inbox loads the first time it's opened.
  useEffect(() => {
    if (view !== "inbox" || inbox !== null || inboxBusy) return;
    refreshInbox();
  }, [view, inbox, inboxBusy, refreshInbox]);

  // The Activity view loads its log the first time it's opened.
  useEffect(() => {
    if (view !== "activity" || logRows !== null) return;
    (async () => {
      const { data } = await supabase
        .from("post_log")
        .select("id, platform, posted_at, status, error, views, likes, clips(title)")
        .order("posted_at", { ascending: false })
        .limit(25);
      setLogRows(data ?? []);
    })();
  }, [view, logRows, supabase]);

  const acc = PLATFORMS[plat];

  // Songs currently being pushed: their clips outrank everything in rotation.
  const campaignSet = new Set(
    songs.filter((s) => s.campaign_until && new Date(s.campaign_until) > new Date()).map((s) => s.id)
  );
  const isCampaign = (r: Reel) => !!(r.song_id && campaignSet.has(r.song_id));

  // ---- rotation rule (kept identical to reference/recirculate-ui.jsx):
  // never-posted first, then oldest last_posted_at. The reference left the
  // never-posted order unspecified; we tie-break by original post date so the
  // content people haven't seen the longest recirculates first. Campaign
  // clips sort ahead of all of it while their song's push is active. ----
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
    const ac = isCampaign(a) ? 0 : 1, bc = isCampaign(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
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
  // The actual due date — shown alongside the countdown so the math is checkable.
  const dueDate = globalLast ? new Date(+new Date(globalLast) + cadence[plat] * 86400000).toISOString() : todayISO();

  // Cross-platform due map for the tab dots and the "post all due" button —
  // the same rotation rule as above, evaluated for every platform.
  const dueInfo = PK.map((k) => {
    const next =
      [...reels.filter((r) => !r.archived && r.platforms[k])].sort((a, b) => {
        const ac = isCampaign(a) ? 0 : 1, bc = isCampaign(b) ? 0 : 1;
        if (ac !== bc) return ac - bc;
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
  // Platforms the app can post to by API (TikTok is assisted-manual).
  const apiDuePlats = duePlats.filter((d) => d.plat !== "tiktok");

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
    if (posting) return; // double-tap writes duplicate log rows
    setPosting(reel.id);
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
    try {
      await supabase
        .from("clip_platforms")
        .update({ last_posted_at: when, times_posted: nextTimes })
        .eq("clip_id", reel.id)
        .eq("platform", plat);
      await supabase.from("post_log").insert({ clip_id: reel.id, platform: plat, status: "success" });
    } finally {
      setPosting(null);
    }
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

  // Post the suggested next clip on every API platform that's due, in one go.
  // TikTok is excluded — its posts are assisted-manual from the TikTok tab.
  const postAllDue = async () => {
    if (posting) return;
    const targets = duePlats.filter((d) => d.plat !== "tiktok");
    if (targets.length < 2) return;
    const lines = targets.map((d) => `• ${PLATFORMS[d.plat].name}: "${d.next!.title}"`).join("\n");
    const tiktokNote = duePlats.some((d) => d.plat === "tiktok")
      ? "\n\n(TikTok is also due — share it manually from its tab.)"
      : "";
    if (!window.confirm(`Post everything that's due?\n\n${lines}${tiktokNote}\n\nEach posts to your real account.`)) return;
    setPosting("__all");
    setToast(null);
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
    setToast({
      ok: bad.length === 0,
      text: [ok.length ? `Posted to ${ok.join(" + ")}. 🎉` : "", ...bad].filter(Boolean).join(" · "),
    });
    setLogRows(null);
    setPosting(null);
    await load();
  };

  // Approve-now-post-later: writes a pending scheduled_posts row that the
  // daily cron (~10 AM New York) executes on the chosen day.
  const confirmSchedule = async () => {
    if (!schedClip || !schedDate) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    // LOCAL midnight, not UTC — otherwise the chip and toast render the day
    // before the one that was picked (midnight UTC = evening in New York).
    const runAt = new Date(schedDate + "T00:00:00").toISOString();
    const { data: row, error } = await supabase
      .from("scheduled_posts")
      .insert({ user_id: u.user.id, clip_id: schedClip.id, platform: plat, run_at: runAt })
      .select("id, clip_id, platform, run_at")
      .single();
    if (!error && row) {
      setSched((ss) => [...ss, row as any].sort((a, b) => (a.run_at < b.run_at ? -1 : 1)));
      setToast({ ok: true, text: `Scheduled "${schedClip.title}" for ${PLATFORMS[plat].name} on ${fmt(runAt)} (posts ~10 AM New York).` });
    }
    setSchedClip(null);
    setSchedDate("");
  };

  const cancelSchedule = async (id: string) => {
    setSched((ss) => ss.filter((s) => s.id !== id));
    await supabase.from("scheduled_posts").delete().eq("id", id);
  };

  // Hand the video file to the phone's share sheet — the easy path for
  // posting to accounts the app isn't connected to (e.g. a second Instagram).
  const shareClip = async (r: Reel) => {
    if (!r.video_path) return;
    const url = publicUrl(r.video_path);
    try {
      const nav: any = navigator;
      if (nav.share && nav.canShare) {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], `${(r.title || "clip").replace(/[^\w-]+/g, "_")}.mp4`, { type: "video/mp4" });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: r.title });
          return;
        }
        await nav.share({ url, title: r.title });
        return;
      }
    } catch {
      /* user cancelled or share unsupported — fall through */
    }
    window.open(url, "_blank");
  };

  // Meta ads: open the Promote panel and lazily load the saved audiences.
  const openPromote = async (r: Reel) => {
    setPromoClip(r);
    setPromoMsg(null);
    if (audiences === null) {
      try {
        const res = await fetch("/api/ads/audiences");
        const body = await res.json();
        setAdsConfigured(!!body.configured);
        setAudiences(body.audiences ?? []);
      } catch {
        setAdsConfigured(false);
        setAudiences([]);
      }
    }
  };

  // "People like my fans": engagement audience → 1% lookalike, then refresh
  // the dropdown so it's immediately pickable.
  const buildLookalike = async () => {
    if (lalBusy) return;
    setLalBusy(true);
    try {
      const res = await fetch("/api/ads/lookalike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: lalCountry }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPromoMsg({ ok: false, text: body?.error || "Lookalike creation failed." });
      } else {
        setPromoMsg({ ok: true, text: `"${body.name}" created — it may take a few hours to fill, but you can target it now.` });
        const a = await (await fetch("/api/ads/audiences")).json().catch(() => null);
        if (a?.audiences) setAudiences(a.audiences);
      }
    } catch (e: any) {
      setPromoMsg({ ok: false, text: e?.message || "Lookalike creation failed." });
    } finally {
      setLalBusy(false);
    }
  };

  // Creates the PAUSED campaign — money only moves after review in Ads Manager.
  const confirmPromote = async () => {
    if (!promoClip || promoBusy) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const [kind, id] = promoAudience.includes(":") ? promoAudience.split(":", 2) : ["", ""];
      const res = await fetch("/api/ads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: promoClip.id,
          dailyBudget: Number(promoBudget),
          days: Number(promoDays),
          audienceId: id || null,
          audienceKind: kind || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPromoMsg({ ok: false, text: body?.error || "Campaign creation failed." });
      } else {
        setPromoMsg({
          ok: true,
          text: `Draft campaign created (paused). Review and publish it in Ads Manager — nothing spends until you do.`,
          url: body.manageUrl,
        });
      }
    } catch (e: any) {
      setPromoMsg({ ok: false, text: e?.message || "Campaign creation failed." });
    } finally {
      setPromoBusy(false);
    }
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

  // ✨ draft → owner edits → send. Nothing posts without the send tap.
  const draftReply = async (item: { id: string; author: string; text: string }) => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/comments/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: item.text, author: item.author }),
      });
      const body = await res.json();
      if (!res.ok) setToast({ ok: false, text: body?.error || "Draft failed." });
      else setReplyText(body.reply);
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Draft failed." });
    } finally {
      setDrafting(false);
    }
  };

  const sendReply = async (item: { id: string; platform: Platform; author: string }) => {
    if (sendingReply || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch("/api/comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: item.platform, commentId: item.id, text: replyText.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast({ ok: false, text: body?.error || "Reply failed." });
      } else {
        setToast({ ok: true, text: `Replied to ${item.author}. 💬` });
        setInbox((xs) => (xs ?? []).filter((x) => x.id !== item.id));
        setReplyId(null);
        setReplyText("");
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Reply failed." });
    } finally {
      setSendingReply(false);
    }
  };

  // Pull fresh view/like counts from Instagram (originals + reposts) and
  // YouTube. Takes a little while — it's one API call per Instagram media.
  const refreshStats = async () => {
    if (statsBusy) return;
    setStatsBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/metrics/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setToast({ ok: false, text: body?.error || "Stats refresh failed." });
      } else {
        const bits = [
          `${body.instagram_originals ?? 0} originals`,
          `${body.instagram_posts ?? 0} IG reposts`,
          `${body.youtube_posts ?? 0} Shorts`,
        ];
        const errs = (body.errors ?? []).join(" · ");
        setToast({
          ok: !errs,
          text: `Stats updated: ${bits.join(" · ")}.` + (errs ? ` ${errs}` : ""),
        });
        setLogRows(null);
        await load();
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Stats refresh failed." });
    } finally {
      setStatsBusy(false);
    }
  };

  // TikTok's developer program doesn't approve personal apps for public
  // posting (audit rejected on policy grounds), so TikTok publishes are
  // ASSISTED-MANUAL: copy the full caption, hand the video to the share
  // sheet, then record the post so the rotation advances.
  const shareToTikTok = async (r: Reel) => {
    const song = songs.find((s) => s.id === r.song_id);
    const listen =
      song && (song.spotify_url || song.apple_url || song.youtube_url)
        ? `\n\n🎧 Full song: ${window.location.origin}/listen/${song.slug}?src=tiktok`
        : "";
    const text = [r.caption, r.hashtags].filter(Boolean).join("\n\n") + listen;
    try {
      if (text && navigator.clipboard) await navigator.clipboard.writeText(text);
    } catch {}
    setToast({ ok: true, text: "Caption copied 📋 — paste it in TikTok. Opening share…" });
    await shareClip(r);
    if (window.confirm(`Posted "${r.title}" on TikTok?\n\nOK records it and advances the rotation; Cancel leaves it queued.`)) {
      await markPosted(r);
      setToast({ ok: true, text: `Recorded — "${r.title}" moves to the back of the TikTok rotation.` });
    }
  };

  // Facebook (professional-mode profile) can't be posted to by API — Meta
  // only allows that for classic Pages. Assisted-manual like TikTok: copy
  // caption, share sheet, record to the activity log (no rotation impact).
  const shareToFacebook = async (r: Reel) => {
    const song = songs.find((s) => s.id === r.song_id);
    const listen =
      song && (song.spotify_url || song.apple_url || song.youtube_url)
        ? `\n\n🎧 Full song: ${window.location.origin}/listen/${song.slug}?src=facebook`
        : "";
    const text = [r.caption, r.hashtags].filter(Boolean).join("\n\n") + listen;
    try {
      if (text && navigator.clipboard) await navigator.clipboard.writeText(text);
    } catch {}
    setToast({ ok: true, text: "Caption copied 📋 — paste it in Facebook. Opening share…" });
    await shareClip(r);
    if (window.confirm(`Posted "${r.title}" on Facebook? OK records it in your activity.`)) {
      await supabase.from("post_log").insert({ clip_id: r.id, platform: "facebook", status: "success" });
      setLogRows(null);
      setToast({ ok: true, text: `Recorded the Facebook post. 📘` });
    }
  };

  // Real publish: posts the clip to the selected platform, then advances the
  // rotation server-side. This posts to the live account, so we confirm first.
  const publishClip = async (clip: Reel) => {
    if (posting) return;
    if (plat === "tiktok") return shareToTikTok(clip);
    const name = PLATFORMS[plat].name;
    const audioNote =
      clip.licensed_audio && plat !== "instagram"
        ? `\n\n⚠️ This clip uses Instagram licensed music — ${name} may mute it or flag it with Content ID.`
        : "";
    if (!window.confirm(`Publish "${clip.title}" to ${name} now?\n\nThis posts to your real ${name} account.${audioNote}`)) return;
    setPosting(clip.id);
    setToast(null);
    try {
      const res = await fetch(`/api/post/${plat}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId: clip.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ ok: false, text: data?.error || "Publish failed." });
      } else {
        setToast({ ok: true, text: `Published "${clip.title}" to ${name}. 🎉` });
        setLogRows(null); // stale now — refetch on next open
        await load();
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Publish failed." });
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
    setToast(null);
    try {
      const res = await fetch("/api/import/instagram", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setToast({ ok: false, text: body?.error || "Import failed." });
      } else {
        const { added, skipped, thumbed, failed } = body as { added: number; skipped: number; thumbed?: number; failed?: number };
        const bits = [`Imported ${added} new`, `skipped ${skipped} already in library`];
        if (thumbed) bits.push(`added ${thumbed} thumbnail${thumbed === 1 ? "" : "s"}`);
        if (failed) bits.push(`${failed} failed`);
        setToast({ ok: true, text: bits.join(" · ") + "." });
        await load();
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Import failed." });
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

    // A saved clip with video but no thumbnail (new upload or a replaced
    // video) gets one extracted server-side; refresh when it lands.
    if (clipId && data.video_path && !data.thumb_path) {
      fetch("/api/thumb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId }),
      })
        .then((r) => (r.ok ? load() : null))
        .catch(() => {});
    }
  };

  // Songs (smart links): create/update with a slug derived once from the
  // title, so shared /listen URLs never break on rename.
  const saveSong = async (s: Partial<Song> & { title: string }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (s.id) {
      await supabase
        .from("songs")
        .update({ title: s.title, spotify_url: s.spotify_url ?? "", apple_url: s.apple_url ?? "", youtube_url: s.youtube_url ?? "", campaign_until: s.campaign_until ?? null })
        .eq("id", s.id);
    } else {
      await supabase.from("songs").insert({
        user_id: u.user.id,
        title: s.title,
        slug: slugify(s.title),
        spotify_url: s.spotify_url ?? "",
        apple_url: s.apple_url ?? "",
        youtube_url: s.youtube_url ?? "",
        campaign_until: s.campaign_until ?? null,
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

  // Lead magnet: one bonus track, gated behind the /listen email form.
  const saveMagnet = async (title: string, file: File) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const ext = (file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `${u.user.id}/magnet/${Date.now()}.${ext}`;
    const up = await supabase.storage.from("clips").upload(key, file, { contentType: file.type || "audio/mpeg" });
    if (up.error) {
      setToast({ ok: false, text: "Upload failed: " + up.error.message });
      return;
    }
    // Insert the new row first; only delete the old one once the replacement
    // exists — a failed insert must not destroy the live magnet.
    const old = magnet;
    const { data: row, error: insErr } = await supabase
      .from("lead_magnet")
      .insert({ user_id: u.user.id, title: title.trim(), file_path: key })
      .select("id, title, file_path")
      .single();
    if (insErr || !row) {
      await supabase.storage.from("clips").remove([key]).catch(() => {});
      setToast({ ok: false, text: "Couldn't save the lead magnet — try again." });
      return;
    }
    if (old) {
      await supabase.from("lead_magnet").delete().eq("id", old.id);
      await supabase.storage.from("clips").remove([old.file_path]).catch(() => {});
    }
    setMagnet(row as any);
    setToast({ ok: true, text: `Lead magnet live — /listen now trades "${title.trim()}" for an email.` });
  };

  const removeMagnet = async () => {
    if (!magnet || !window.confirm(`Remove "${magnet.title}"? The /listen form goes back to a plain signup.`)) return;
    await supabase.storage.from("clips").remove([magnet.file_path]).catch(() => {});
    await supabase.from("lead_magnet").delete().eq("id", magnet.id);
    setMagnet(null);
  };

  // Curator outreach
  const addCurator = async (c: { name: string; contact_email: string; playlist_url: string; note: string }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || !c.name.trim()) return;
    const { data: row } = await supabase
      .from("curators")
      .insert({ user_id: u.user.id, ...c, name: c.name.trim() })
      .select("*")
      .single();
    if (row) setCurators((cs) => [row as Curator, ...cs]);
  };

  const setCuratorStatus = async (id: string, status: string) => {
    setCurators((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    await supabase.from("curators").update({ status }).eq("id", id);
  };

  const deleteCurator = async (c: Curator) => {
    if (!window.confirm(`Remove ${c.name} from outreach?`)) return;
    setCurators((cs) => cs.filter((x) => x.id !== c.id));
    await supabase.from("curators").delete().eq("id", c.id);
  };

  const draftPitch = async () => {
    if (!pitchCurator || pitchBusy) return;
    setPitchBusy("draft");
    try {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curatorId: pitchCurator.id, songId: pitchSongId || null }),
      });
      const body = await res.json();
      if (!res.ok) setToast({ ok: false, text: body?.error || "Draft failed." });
      else {
        setPitchSubject(body.subject);
        setPitchBody(body.body);
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Draft failed." });
    } finally {
      setPitchBusy(null);
    }
  };

  const sendPitch = async () => {
    if (!pitchCurator || pitchBusy || !pitchSubject.trim() || !pitchBody.trim()) return;
    setPitchBusy("send");
    try {
      const res = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curatorId: pitchCurator.id, subject: pitchSubject.trim(), text: pitchBody.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast({ ok: false, text: body?.error || "Send failed." });
      } else {
        setToast({ ok: true, text: `Pitch sent to ${pitchCurator.name}. 🤞 Follow-up nudges land in your daily email.` });
        setCurators((cs) =>
          cs.map((c) => (c.id === pitchCurator.id ? { ...c, status: "pitched", last_contact: new Date().toISOString() } : c))
        );
        setPitchCurator(null);
        setPitchSubject("");
        setPitchBody("");
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Send failed." });
    } finally {
      setPitchBusy(null);
    }
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
          <div className="rc-chip" title="Facebook is manual — use the 📘 button on any clip to share + record it">
            <Facebook size={12} color="#1877F2" /> Facebook · manual
          </div>
        </div>

        {view === "queue" && (
          <>
        <div className="rc-cadence">
          <RotateCw size={15} color={acc.b} />
          <span>Repost a {acc.sub} every</span>
          <button className="rc-step" onClick={() => changeCadence(-1)} aria-label="Fewer days">–</button>
          <span className="rc-num">{cadence[plat]}</span>
          <button className="rc-step" onClick={() => changeCadence(1)} aria-label="More days">+</button>
          <span>{cadence[plat] === 1 ? "day" : "days"}</span>
        </div>

        <p className="rc-meta" style={{ margin: "-8px 4px 14px" }}>
          {globalLast
            ? `Last ${acc.name} post: ${fmtDT(globalLast)} · next due: ${dueNow ? "now" : fmt(dueDate)}`
            : `Nothing posted to ${acc.name} yet — the rotation is due now.`}
        </p>

        {pushState === "prompt" && (
          <button className="rc-add" style={{ marginBottom: 12 }} onClick={enablePush}>
            <Bell size={14} /> Notify me when something&apos;s due
          </button>
        )}

        {apiDuePlats.length >= 2 && (
          <button
            className="rc-btn primary"
            style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}
            onClick={postAllDue}
            disabled={posting !== null}
          >
            <Send size={15} />
            {posting === "__all" ? "Posting everywhere…" : `Post all due (${apiDuePlats.length})`}
          </button>
        )}

        {sched.length > 0 && (
          <>
            <div className="rc-deck-label" style={{ margin: "0 0 6px" }}>Scheduled</div>
            <div className="rc-deck" style={{ paddingBottom: 12 }}>
              {sched.map((sp) => (
                <div key={sp.id} className="rc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon p={sp.platform} size={12} color={PLATFORMS[sp.platform]?.a} />
                  {reels.find((r) => r.id === sp.clip_id)?.title ?? "clip"} · {fmt(sp.run_at)}
                  <button
                    onClick={() => cancelSchedule(sp.id)}
                    aria-label="Cancel scheduled post"
                    title="Cancel scheduled post"
                    style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 0, display: "inline-flex" }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
          </>
        )}

        {schedClip && (
          <div className="rc-sheetwrap" onClick={() => { setSchedClip(null); setSchedDate(""); }}>
          <div className="rc-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="rc-form" style={{ marginBottom: 0 }}>
            <label className="rc-label" style={{ marginTop: 0 }}>
              Schedule “{schedClip.title}” to {acc.name} on
            </label>
            <input
              className="rc-input"
              type="date"
              value={schedDate}
              min={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`}
              onChange={(e) => setSchedDate(e.target.value)}
            />
            <p className="rc-note">
              Posts on that day&apos;s automatic run, ~10 AM New York time (or the next run if that day&apos;s already passed).
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="rc-btn primary" disabled={!schedDate} onClick={confirmSchedule}>
                <CalendarClock size={15} /> Schedule
              </button>
              <button className="rc-btn ghost" onClick={() => { setSchedClip(null); setSchedDate(""); }}>
                <X size={15} /> Cancel
              </button>
            </div>
          </div>
          </div>
          </div>
        )}

        {promoClip && (
          <div className="rc-sheetwrap" onClick={() => { setPromoClip(null); setPromoMsg(null); }}>
          <div className="rc-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="rc-form" style={{ marginBottom: 0 }}>
            <label className="rc-label" style={{ marginTop: 0 }}>
              <Megaphone size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Promote “{promoClip.title}” — Instagram ad → {promoClip.song_id ? "its song's /listen page" : "the /listen hub"}
            </label>
            {adsConfigured === false ? (
              <p className="rc-note">
                Set <b>META_ADS_TOKEN</b> (Business Manager → System users → generate token with ads_management, with your
                ad account + Page assigned), <b>META_AD_ACCOUNT_ID</b>, and <b>META_PAGE_ID</b> in Vercel, then redeploy.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="rc-label">$ / day</label>
                    <input className="rc-input" type="number" min={1} max={500} value={promoBudget} onChange={(e) => setPromoBudget(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="rc-label">Days</label>
                    <input className="rc-input" type="number" min={1} max={30} value={promoDays} onChange={(e) => setPromoDays(e.target.value)} />
                  </div>
                </div>
                <label className="rc-label">Audience</label>
                <select className="rc-input" value={promoAudience} onChange={(e) => setPromoAudience(e.target.value)}>
                  <option value="">Automatic (US, 18+, Instagram)</option>
                  {(audiences ?? []).map((a) => (
                    <option key={a.id} value={`${a.kind}:${a.id}`}>{a.name}</option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <button className="rc-add" onClick={buildLookalike} disabled={lalBusy} title="Custom audience of your IG engagers → 1% lookalike in the chosen country">
                    <Sparkles size={13} /> {lalBusy ? "Building…" : "Build fan lookalike"}
                  </button>
                  <select
                    className="rc-input"
                    style={{ width: "auto", padding: "6px 10px", fontSize: 12.5 }}
                    value={lalCountry}
                    onChange={(e) => setLalCountry(e.target.value)}
                    aria-label="Lookalike country"
                  >
                    <option value="US">USA</option>
                    <option value="IL">Israel</option>
                    <option value="CA">Canada</option>
                    <option value="GB">UK</option>
                    <option value="FR">France</option>
                  </select>
                </div>
                <p className="rc-note">
                  Max spend ≈ ${(Number(promoBudget) || 0) * (Number(promoDays) || 0)} · created <b>paused</b> — you review
                  and publish in Ads Manager.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="rc-btn primary" disabled={promoBusy || audiences === null} onClick={confirmPromote}>
                    <Megaphone size={15} /> {promoBusy ? "Creating…" : audiences === null ? "Loading…" : "Create draft campaign"}
                  </button>
                  <button className="rc-btn ghost" onClick={() => { setPromoClip(null); setPromoMsg(null); }}>
                    <X size={15} /> Close
                  </button>
                </div>
              </>
            )}
            {promoMsg && (
              <div className={"rc-msg " + (promoMsg.ok ? "ok" : "err")} style={{ marginTop: 10 }}>
                {promoMsg.text}
                {promoMsg.url && (
                  <>
                    {" "}
                    <a href={promoMsg.url} target="_blank" rel="noreferrer" style={{ color: "inherit", fontWeight: 700 }}>
                      Open Ads Manager ↗
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
          </div>
          </div>
        )}

        {view === "queue" && (
          <>
        {upNext ? (
          <div className={"rc-hero" + (dueNow ? " due" : "")}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="rc-eyebrow">
                <Icon p={plat} size={12} color={acc.b} /> Up next on {acc.name}
                {isCampaign(upNext) ? " · 📣 campaign" : ""}
              </span>
              <span className="rc-status">
                <Clock size={12} />
                {dueNow ? "Ready to post now" : `Due ${fmt(dueDate)}`}
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
                {plat === "tiktok" ? <Share2 size={15} /> : <Send size={15} />}
                {posting === upNext.id ? "Publishing…" : plat === "tiktok" ? "Share to TikTok" : `Publish to ${acc.name}`}
              </button>
              <button className="rc-btn ghost" onClick={() => copyCaption(upNext)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy caption"}
              </button>
              {plat !== "tiktok" && (
                <button
                  className="rc-btn ghost"
                  onClick={() => setSchedClip(upNext)}
                  title="Pick a day — it posts on that morning's automatic run"
                >
                  <CalendarClock size={15} /> Schedule
                </button>
              )}
              <button
                className="rc-btn ghost"
                onClick={() => shareToFacebook(upNext)}
                title="Copy the caption and hand the video to Facebook — recorded in Activity"
              >
                <Facebook size={15} /> Facebook
              </button>
              <button className="rc-btn ghost" onClick={() => markPosted(upNext)} title="Just record it as posted without publishing">
                <Check size={15} /> Mark posted
              </button>
            </div>
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
          </>
        )}

        {view === "library" && (
          <>
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
                {moreId === r.id && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {r.platforms[plat] && plat !== "tiktok" && (
                      <button className="rc-add" onClick={() => { setSchedClip(r); setMoreId(null); }}>
                        <CalendarClock size={13} /> Schedule
                      </button>
                    )}
                    {r.video_path && (
                      <button className="rc-add" onClick={() => { openPromote(r); setMoreId(null); }}>
                        <Megaphone size={13} /> Promote
                      </button>
                    )}
                    {r.video_path && (
                      <button className="rc-add" onClick={() => shareClip(r)}>
                        <Share2 size={13} /> Share
                      </button>
                    )}
                    {r.video_path && (
                      <button className="rc-add" onClick={() => { shareToFacebook(r); setMoreId(null); }}>
                        <Facebook size={13} /> Facebook
                      </button>
                    )}
                    <button className="rc-add" onClick={() => { setEditing(r.id); setMoreId(null); }}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className="rc-add" onClick={() => { setArchived(r, true); setMoreId(null); }}>
                      <Archive size={13} /> Archive
                    </button>
                    <button className="rc-add" onClick={() => remove(r)}>
                      <Trash2 size={13} /> Delete
                    </button>
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
              <button
                className="rc-icbtn"
                onClick={() => setMoreId(moreId === r.id ? null : r.id)}
                aria-label="More actions"
                title="More actions"
                style={moreId === r.id ? { color: "var(--text)" } : {}}
              >
                <MoreHorizontal size={17} />
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

          </>
        )}

        {lyricSong && (
          <div className="rc-sheetwrap" onClick={() => setLyricSong(null)}>
            <div className="rc-sheet" onClick={(e) => e.stopPropagation()}>
              <LyricVideoForm
                song={lyricSong}
                supabase={supabase}
                onCancel={() => setLyricSong(null)}
                onDone={async (text) => {
                  setLyricSong(null);
                  setToast({ ok: true, text });
                  await load();
                }}
              />
            </div>
          </div>
        )}

        {view === "songs" && (
          <div style={{ marginTop: 4 }}>
            <div className="rc-libhead">
              <h2>Songs {songs.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {songs.length}</span>}</h2>
              <a className="rc-add" href="/listen" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                /listen ↗
              </a>
            </div>
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
                    <p className="rc-cardtitle">
                      {s.title}
                      {s.campaign_until && new Date(s.campaign_until) > new Date() && (
                        <span className="rc-tag-chip warn" style={{ marginLeft: 8 }}>
                          📣 campaign until {fmt(s.campaign_until)}
                        </span>
                      )}
                    </p>
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
                  <button
                    className="rc-icbtn"
                    onClick={() => setLyricSong(s)}
                    aria-label="Generate lyric video"
                    title="Generate a lyric video for this song"
                  >
                    <Clapperboard size={15} />
                  </button>
                  <button className="rc-icbtn" onClick={() => setSongEditing(s.id)} aria-label="Edit song">
                    <Pencil size={15} />
                  </button>
                  <button className="rc-icbtn" onClick={() => deleteSong(s)} aria-label="Delete song">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            )}

            <div className="rc-deck-label" style={{ margin: "18px 0 8px" }}>Lead magnet</div>
            {magnet ? (
              <div className="rc-card" style={{ alignItems: "center" }}>
                <Download size={16} color="var(--lilac)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="rc-cardtitle">{magnet.title}</p>
                  <p className="rc-meta" style={{ margin: "3px 0 0" }}>
                    /listen trades this download for a fan&apos;s email.
                  </p>
                </div>
                <button className="rc-icbtn" onClick={removeMagnet} aria-label="Remove lead magnet">
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <MagnetForm onSave={saveMagnet} />
            )}

            <div className="rc-deck-label" style={{ margin: "18px 0 8px" }}>Playlist outreach</div>
            <CuratorForm onAdd={addCurator} />
            {curators.length === 0 && (
              <div className="rc-empty" style={{ marginTop: 8 }}>
                Add playlist curators you find (SubmitHub, playlist descriptions, Instagram bios) — draft a
                personal pitch with ✨ and send it from here. Follow-up nudges land in your daily email.
              </div>
            )}
            {curators.map((c) => (
              <div key={c.id} className="rc-card" style={{ alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="rc-cardtitle">
                    {c.name}
                    <span
                      className={"rc-tag-chip" + (c.status === "placed" ? "" : c.status === "pitched" ? " warn" : "")}
                      style={{ marginLeft: 8 }}
                    >
                      {c.status}
                      {c.status === "pitched" && c.last_contact ? ` ${fmt(c.last_contact)}` : ""}
                    </span>
                  </p>
                  <p className="rc-meta" style={{ margin: "3px 0 0" }}>
                    {[c.contact_email, c.playlist_url ? "playlist ↗" : "", c.note].filter(Boolean).join(" · ") || "no details yet"}
                  </p>
                </div>
                {c.status === "pitched" && (
                  <>
                    <button className="rc-icbtn" onClick={() => setCuratorStatus(c.id, "placed")} title="Mark placed 🎉" aria-label="Mark placed">
                      <Check size={15} />
                    </button>
                    <button className="rc-icbtn" onClick={() => setCuratorStatus(c.id, "passed")} title="Mark passed" aria-label="Mark passed">
                      <X size={15} />
                    </button>
                  </>
                )}
                <button
                  className="rc-icbtn"
                  onClick={() => { setPitchCurator(c); setPitchSongId(songs[0]?.id ?? ""); setPitchSubject(""); setPitchBody(""); }}
                  title="Draft & send a pitch"
                  aria-label="Pitch"
                >
                  <Send size={15} />
                </button>
                <button className="rc-icbtn" onClick={() => deleteCurator(c)} aria-label="Delete curator">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {pitchCurator && (
          <div className="rc-sheetwrap" onClick={() => setPitchCurator(null)}>
            <div className="rc-sheet" onClick={(e) => e.stopPropagation()}>
              <label className="rc-label" style={{ marginTop: 0 }}>
                <Send size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Pitch {pitchCurator.name}
                {pitchCurator.contact_email ? ` · ${pitchCurator.contact_email}` : " — ⚠ no email saved"}
              </label>
              <label className="rc-label">Song to pitch</label>
              <select className="rc-input" value={pitchSongId} onChange={(e) => setPitchSongId(e.target.value)}>
                <option value="">— the artist in general —</option>
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              <div style={{ marginTop: 10 }}>
                <button className="rc-add" onClick={draftPitch} disabled={pitchBusy !== null}>
                  <Sparkles size={13} /> {pitchBusy === "draft" ? "Drafting…" : "Draft pitch"}
                </button>
              </div>
              <label className="rc-label">Subject</label>
              <input className="rc-input" value={pitchSubject} onChange={(e) => setPitchSubject(e.target.value)} placeholder="Draft one with ✨ or write your own" />
              <label className="rc-label">Email</label>
              <textarea className="rc-area" rows={8} value={pitchBody} onChange={(e) => setPitchBody(e.target.value)} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  className="rc-btn primary"
                  onClick={sendPitch}
                  disabled={pitchBusy !== null || !pitchSubject.trim() || !pitchBody.trim() || !pitchCurator.contact_email}
                >
                  <Send size={15} /> {pitchBusy === "send" ? "Sending…" : "Send pitch"}
                </button>
                <button className="rc-btn ghost" onClick={() => setPitchCurator(null)}>
                  <X size={15} /> Close
                </button>
              </div>
            </div>
          </div>
        )}

        {view === "activity" && (
          <div style={{ marginTop: 4 }}>
            <div className="rc-libhead">
              <h2>Activity</h2>
              <button
                className="rc-add"
                onClick={refreshStats}
                disabled={statsBusy}
                title="Pull view/like counts from Instagram and YouTube"
              >
                <RotateCw size={14} /> {statsBusy ? "Refreshing…" : "Refresh stats"}
              </button>
            </div>
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

        {view === "inbox" && (
          <div style={{ marginTop: 4 }}>
            <div className="rc-libhead">
              <h2>Inbox {inbox && inbox.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {inbox.length}</span>}</h2>
              <button className="rc-add" onClick={refreshInbox} disabled={inboxBusy}>
                <RotateCw size={14} /> {inboxBusy ? "Checking…" : "Refresh"}
              </button>
            </div>
            <p className="rc-meta" style={{ margin: "-4px 0 10px" }}>
              Fan comments from Instagram and YouTube. Fast replies are the cheapest growth there is.
            </p>
            {inboxErrs.map((e, i) => (
              <div key={i} className="rc-msg err" style={{ marginBottom: 8 }}>{e}</div>
            ))}
            {inbox === null || (inboxBusy && !inbox?.length) ? (
              <div className="rc-empty">Checking your posts for comments…</div>
            ) : inbox.length === 0 ? (
              <div className="rc-empty">All caught up — no unanswered comments found. 🎉</div>
            ) : (
              inbox.map((c) => (
                <div key={c.id} className="rc-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon p={c.platform} size={14} color={PLATFORMS[c.platform]?.a} />
                    <b style={{ fontSize: 13 }}>{c.author}</b>
                    <span className="rc-meta" style={{ margin: 0, marginLeft: "auto" }}>{fmtDT(c.when)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45 }}>{c.text}</p>
                  {c.media && <p className="rc-meta" style={{ margin: 0 }}>on: {c.media}…</p>}
                  {replyId === c.id ? (
                    <div>
                      <textarea
                        className="rc-area"
                        rows={2}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={`Reply to ${c.author}…`}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button className="rc-add" onClick={() => draftReply(c)} disabled={drafting}>
                          <Sparkles size={13} /> {drafting ? "Drafting…" : "Draft"}
                        </button>
                        <button className="rc-add" onClick={() => sendReply(c)} disabled={sendingReply || !replyText.trim()}>
                          <Send size={13} /> {sendingReply ? "Sending…" : "Send"}
                        </button>
                        <button className="rc-add" onClick={() => { setReplyId(null); setReplyText(""); }}>
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button className="rc-add" onClick={() => { setReplyId(c.id); setReplyText(""); }}>
                        <MessageCircle size={13} /> Reply
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {toast && (
          <div
            className={"rc-msg rc-toast " + (toast.ok ? "ok" : "err")}
            onClick={() => setToast(null)}
            role="status"
            style={{ cursor: "pointer" }}
          >
            {toast.text}
          </div>
        )}

        <nav className="rc-nav" aria-label="Sections">
          {(
            [
              ["queue", "Queue", Clock, duePlats.length > 0],
              ["library", "Library", LayoutGrid, false],
              ["inbox", "Inbox", MessageCircle, false],
              ["songs", "Songs", Music, false],
              ["activity", "Activity", History, false],
            ] as const
          ).map(([key, label, IconC, dot]) => (
            <button
              key={key}
              className={"rc-navbtn" + (view === key ? " on" : "")}
              onClick={() => setView(key)}
              aria-label={label}
            >
              {dot && <span className="rc-navdot" />}
              <IconC size={19} />
              {label}
            </button>
          ))}
        </nav>
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
  const [campaign, setCampaign] = useState(song?.campaign_until ? song.campaign_until.slice(0, 10) : "");
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
        campaign_until: campaign ? new Date(campaign + "T23:59:59").toISOString() : null,
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
      <label className="rc-label">
        📣 Campaign — push this song&apos;s clips to the front of every rotation until (leave empty for none)
      </label>
      <input className="rc-input" type="date" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
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

function LyricVideoForm({
  song,
  supabase,
  onDone,
  onCancel,
}: {
  song: Song;
  supabase: ReturnType<typeof createSupabaseBrowser>;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("30");
  const [style, setStyle] = useState("midnight");
  const [lang, setLang] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [err, setErr] = useState("");

  // Upload the audio once and reuse the key for transcribe + generate.
  const ensureUploaded = async (): Promise<string> => {
    if (uploadedKey) return uploadedKey;
    if (!file) throw new Error("Pick the song's audio file first.");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in.");
    const ext = (file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `${u.user.id}/audio/${song.slug}_${Date.now()}.${ext}`;
    const up = await supabase.storage.from("clips").upload(key, file, { contentType: file.type || "audio/mpeg" });
    if (up.error) throw new Error("Audio upload failed: " + up.error.message);
    setUploadedKey(key);
    return key;
  };

  // CapCut-style auto-captions: Whisper listens to the chosen segment and
  // fills the textarea with [m:ss]-stamped lines for review.
  const autoTranscribe = async () => {
    if (busy || transcribing) return;
    setTranscribing(true);
    setErr("");
    try {
      const key = await ensureUploaded();
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioPath: key,
          start: Number(start) || 0,
          duration: Number(duration) || 30,
          language: lang === "auto" ? undefined : lang,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Transcription failed.");
      setLyrics(body.lyrics);
    } catch (e: any) {
      setErr(e?.message || "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };

  const generate = async () => {
    if (busy) return;
    if (!file) { setErr("Pick the song's audio file first."); return; }
    if (!lyrics.trim()) { setErr("Paste or auto-transcribe the lyrics first."); return; }
    setBusy(true);
    setErr("");
    try {
      const key = await ensureUploaded();

      const res = await fetch("/api/lyric-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: song.id,
          audioPath: key,
          lyrics,
          start: Number(start) || 0,
          duration: Number(duration) || 30,
          style,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Rendering failed.");
      await onDone(`Lyric video for "${song.title}" is in your library — top of the Never recirculated pile. Use the share button to post it to your other account.`);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-form">
      <label className="rc-label" style={{ marginTop: 0 }}>
        <Clapperboard size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Lyric video — “{song.title}”
      </label>

      <label className="rc-label">Audio file (mp3 / m4a / wav)</label>
      <div className="rc-file">
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadedKey(null); }}
        />
        {file && <div style={{ marginTop: 4 }}>Selected: {file.name}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
        <button
          type="button"
          className="rc-add"
          onClick={autoTranscribe}
          disabled={transcribing || busy || !file}
          title="Whisper listens to the chosen segment and writes timed lyric lines — Hebrew, English, and French all work"
        >
          <Sparkles size={13} /> {transcribing ? "Listening…" : "Auto-transcribe lyrics"}
        </button>
        <select
          className="rc-input"
          style={{ width: "auto", padding: "6px 10px", fontSize: 12.5 }}
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Lyrics language hint"
        >
          <option value="auto">Detect language</option>
          <option value="he">עברית</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </div>

      <label className="rc-label">
        Lyrics for this section — one line per screen. Optional [m:ss] stamps sync lines to the video clock, e.g. “[0:04] first line”. Auto-transcribed lines land here for you to fix up before rendering.
      </label>
      <textarea
        className="rc-area"
        rows={6}
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        placeholder={"You can leave the stamps out —\nlines will be spread evenly."}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="rc-label">Start in song (sec)</label>
          <input className="rc-input" type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="rc-label">Length (sec, max 90)</label>
          <input className="rc-input" type="number" min={10} max={90} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="rc-label">Style</label>
          <select className="rc-input" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="midnight">Midnight</option>
            <option value="sunset">Sunset</option>
            <option value="ocean">Ocean</option>
            <option value="forest">Forest</option>
          </select>
        </div>
      </div>

      <p className="rc-note">Rendering takes about a minute — keep the app open until it finishes.</p>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="rc-btn primary" disabled={busy} onClick={generate}>
          <Clapperboard size={15} /> {busy ? "Rendering…" : "Generate video"}
        </button>
        <button className="rc-btn ghost" onClick={onCancel} disabled={busy}>
          <X size={15} /> Cancel
        </button>
      </div>
      {err && (
        <div className="rc-msg err" style={{ marginTop: 10 }}>{err}</div>
      )}
    </div>
  );
}

function MagnetForm({ onSave }: { onSave: (title: string, file: File) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rc-form">
      <p className="rc-note" style={{ marginTop: 0 }}>
        Offer a bonus track (unreleased, acoustic, live) as a free download for joining the mailing list —
        it typically doubles signups on /listen.
      </p>
      <label className="rc-label">What fans get</label>
      <input className="rc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hallelujah — unreleased acoustic version" />
      <label className="rc-label">Audio file</label>
      <div className="rc-file">
        <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          className="rc-btn primary"
          disabled={busy || !title.trim() || !file}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            try {
              await onSave(title, file);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={15} /> {busy ? "Uploading…" : "Set lead magnet"}
        </button>
      </div>
    </div>
  );
}

function CuratorForm({ onAdd }: { onAdd: (c: { name: string; contact_email: string; playlist_url: string; note: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className="rc-add" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add curator
      </button>
    );
  }
  return (
    <div className="rc-form">
      <label className="rc-label" style={{ marginTop: 0 }}>Curator / playlist name</label>
      <input className="rc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shabbat Vibes playlist" />
      <label className="rc-label">Contact email</label>
      <input className="rc-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="curator@email.com" />
      <label className="rc-label">Playlist link</label>
      <input className="rc-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…" />
      <label className="rc-label">Notes (what the playlist is about — feeds the pitch draft)</label>
      <input className="rc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. acoustic Jewish music, ~40k followers, likes intimate covers" />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="rc-btn primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ name, contact_email: email.trim(), playlist_url: url.trim(), note: note.trim() });
              setName(""); setEmail(""); setUrl(""); setNote("");
              setOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={15} /> Save curator
        </button>
        <button className="rc-btn ghost" onClick={() => setOpen(false)}>
          <X size={15} /> Cancel
        </button>
      </div>
    </div>
  );
}
