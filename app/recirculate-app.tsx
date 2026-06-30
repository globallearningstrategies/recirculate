"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Copy, Check, Trash2, Pencil, Clock, RotateCw, X, ExternalLink, LogOut } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { PLATFORMS, PK, HOME, Icon, type Platform } from "@/lib/platforms";

type Cadence = Record<Platform, number>;

type Reel = {
  id: string;
  title: string;
  caption: string;
  hashtags: string;
  video_path: string | null;
  links: Record<Platform, string>;
  platforms: Record<Platform, boolean>;
  posted: Record<Platform, string | null>;
  timesPosted: Record<Platform, number>;
};

type ReelFormData = {
  id?: string;
  title: string;
  caption: string;
  hashtags: string;
  platforms: Record<Platform, boolean>;
  links: Record<Platform, string>;
  video_path: string | null;
};

const DEFAULT_CADENCE: Cadence = { instagram: 5, tiktok: 4, youtube: 7 };
const todayISO = () => new Date().toISOString();
const daysBetween = (a: string, b: string) => Math.floor((+new Date(b) - +new Date(a)) / 86400000);
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const emptyMap = <T,>(v: T): Record<Platform, T> => ({ instagram: v, tiktok: v, youtube: v });

export default function RecirculateApp({ email }: { email: string }) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [reels, setReels] = useState<Reel[]>([]);
  const [cadence, setCadence] = useState<Cadence>(DEFAULT_CADENCE);
  const [plat, setPlat] = useState<Platform>("instagram");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const publicUrl = useCallback(
    (path: string) => supabase.storage.from("clips").getPublicUrl(path).data.publicUrl,
    [supabase]
  );

  // ---- load ----
  const load = useCallback(async () => {
    const [{ data: clipRows }, { data: settingRows }] = await Promise.all([
      supabase
        .from("clips")
        .select("id,title,caption,hashtags,video_path,created_at,clip_platforms(platform,enabled,link,last_posted_at,times_posted)")
        .order("created_at", { ascending: true }),
      supabase.from("settings").select("platform,cadence_days"),
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
      };
    });

    const cad: Cadence = { ...DEFAULT_CADENCE };
    for (const s of settingRows ?? []) if (s.platform in cad) cad[s.platform as Platform] = s.cadence_days;

    setReels(mapped);
    setCadence(cad);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const acc = PLATFORMS[plat];

  // ---- rotation rule (kept identical to reference/recirculate-ui.jsx) ----
  const inRot = reels.filter((r) => r.platforms[plat]);
  const ordered = [...inRot].sort((a, b) => {
    const x = a.posted[plat], y = b.posted[plat];
    if (!x && !y) return 0;
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

  const remove = async (id: string) => {
    setReels((rs) => rs.filter((r) => r.id !== id));
    await supabase.from("clips").delete().eq("id", id); // cascades clip_platforms
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
        .update({ title: data.title, caption: data.caption, hashtags: data.hashtags, video_path: data.video_path })
        .eq("id", clipId);
    } else {
      const { data: inserted, error } = await supabase
        .from("clips")
        .insert({ title: data.title, caption: data.caption, hashtags: data.hashtags, video_path: data.video_path })
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
            </button>
          ))}
        </div>

        <div className="rc-cadence">
          <RotateCw size={15} color={acc.b} />
          <span>Repost a {acc.sub} every</span>
          <button className="rc-step" onClick={() => changeCadence(-1)} aria-label="Fewer days">–</button>
          <span className="rc-num">{cadence[plat]}</span>
          <button className="rc-step" onClick={() => changeCadence(1)} aria-label="More days">+</button>
          <span>{cadence[plat] === 1 ? "day" : "days"}</span>
        </div>

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
                className="rc-thumb"
                style={{ width: "100%", height: "auto", maxHeight: 260, borderRadius: 14, marginBottom: 10 }}
                src={publicUrl(upNext.video_path)}
                controls
                playsInline
                preload="metadata"
              />
            )}
            {upNext.caption && <div className="rc-cap">{upNext.caption}</div>}
            {upNext.hashtags && <div className="rc-tags">{upNext.hashtags}</div>}
            <div className="rc-actions">
              <button className="rc-btn ghost" onClick={() => copyCaption(upNext)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy caption"}
              </button>
              <a className="rc-btn ghost" href={upNext.links[plat] || HOME[plat]} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> Open clip
              </a>
              <button className="rc-btn primary" onClick={() => markPosted(upNext)}>
                <Check size={15} /> Mark as posted
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

        <div className="rc-libhead">
          <h2>
            Library {reels.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {reels.length}</span>}
          </h2>
          {editing !== "new" && (
            <button className="rc-add" onClick={() => setEditing("new")}>
              <Plus size={14} /> Add clip
            </button>
          )}
        </div>

        {editing === "new" && <ReelForm onSave={saveReel} onCancel={() => setEditing(null)} publicUrl={publicUrl} supabase={supabase} />}

        {reels.map((r) =>
          editing === r.id ? (
            <ReelForm key={r.id} reel={r} onSave={saveReel} onCancel={() => setEditing(null)} publicUrl={publicUrl} supabase={supabase} />
          ) : (
            <div key={r.id} className={"rc-card" + (upNext && r.id === upNext.id ? " upnext" : "")}>
              {r.video_path && <video className="rc-thumb" src={publicUrl(r.video_path)} muted playsInline preload="metadata" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="rc-cardtitle">{r.title}</p>
                <div className="rc-badges">
                  {PK.map((k) => (
                    <div
                      key={k}
                      className="rc-badge"
                      style={r.platforms[k] ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})` } : {}}
                    >
                      <Icon p={k} size={13} color={r.platforms[k] ? "#15101B" : "var(--muted)"} />
                    </div>
                  ))}
                </div>
                <p className="rc-meta">
                  {r.platforms[plat]
                    ? r.posted[plat]
                      ? `${acc.name}: last posted ${fmt(r.posted[plat]!)} · ${r.timesPosted[plat] || 0}×`
                      : `${acc.name}: never posted`
                    : `Not in ${acc.name} rotation`}
                </p>
              </div>
              <button className="rc-icbtn" onClick={() => setEditing(r.id)} aria-label="Edit">
                <Pencil size={15} />
              </button>
              <button className="rc-icbtn" onClick={() => remove(r.id)} aria-label="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ReelForm({
  reel,
  onSave,
  onCancel,
  publicUrl,
  supabase,
}: {
  reel?: Reel;
  onSave: (d: ReelFormData) => Promise<void>;
  onCancel: () => void;
  publicUrl: (p: string) => string;
  supabase: ReturnType<typeof createSupabaseBrowser>;
}) {
  const [title, setTitle] = useState(reel?.title || "");
  const [caption, setCaption] = useState(reel?.caption || "");
  const [hashtags, setHashtags] = useState(reel?.hashtags || "");
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>(
    reel?.platforms || { instagram: true, tiktok: false, youtube: false }
  );
  const [links, setLinks] = useState<Record<Platform, string>>(reel?.links || emptyMap(""));
  const [videoPath, setVideoPath] = useState<string | null>(reel?.video_path ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      let path = videoPath;
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
        path = key;
      }
      await onSave({ id: reel?.id, title: title.trim(), caption, hashtags, platforms, links, video_path: path });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-form">
      <label className="rc-label">Clip name</label>
      <input className="rc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lev Tahor — chorus clip" />

      <label className="rc-label">Caption</label>
      <textarea className="rc-area" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="The caption you'll paste when you repost." />

      <label className="rc-label">Hashtags</label>
      <textarea className="rc-area" rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#yourtags #here" />

      <label className="rc-label">Video</label>
      <div className="rc-file">
        {videoPath && !file && (
          <video src={publicUrl(videoPath)} className="rc-thumb" style={{ width: "100%", height: "auto", maxHeight: 200, borderRadius: 12, marginBottom: 6 }} controls playsInline preload="metadata" />
        )}
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <div style={{ marginTop: 6 }}>Selected: {file.name}</div>}
        {videoPath && !file && <div style={{ marginTop: 4 }}>Current: {videoPath.split("/").pop()}</div>}
      </div>

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
