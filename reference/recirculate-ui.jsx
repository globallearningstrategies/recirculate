import React, { useState, useEffect, useRef } from "react";
import { Plus, Copy, Check, Trash2, Pencil, Clock, RotateCw, X, ExternalLink } from "lucide-react";

// ---- platforms ----
const PLATFORMS = {
  instagram: { name: "Instagram", sub: "Reels",  a: "#FF5C7A", b: "#FFA24C" },
  tiktok:    { name: "TikTok",    sub: "TikTok", a: "#25F4EE", b: "#FE2C55" },
  youtube:   { name: "YouTube",   sub: "Shorts", a: "#FF6A4D", b: "#FF0033" },
};
const PK = ["instagram", "tiktok", "youtube"];
const HOME = { instagram: "https://instagram.com", tiktok: "https://tiktok.com", youtube: "https://youtube.com" };

const Icon = ({ p, size = 16, color = "currentColor" }) => {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (p === "instagram") return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17" cy="7" r="1" fill={color} stroke="none" /></svg>;
  if (p === "tiktok") return <svg {...s}><path d="M9 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path d="M12 12V4c.5 2 2 3.3 4 3.6" /></svg>;
  return <svg {...s}><rect x="2" y="5" width="20" height="14" rx="4" /><path d="M10 9l5 3-5 3V9z" fill={color} stroke="none" /></svg>;
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
:root{--bg:#15101B;--bg2:#1E1626;--surface:#271C31;--surface2:#322441;--line:rgba(255,255,255,.08);
  --text:#F3EDF8;--muted:#A595B2;--lilac:#C9A8FF;--acc-a:#FF5C7A;--acc-b:#FFA24C;}
*{box-sizing:border-box}
.rc-root{font-family:'Inter',system-ui,sans-serif;background:radial-gradient(120% 60% at 50% -10%, rgba(255,92,122,.16) 0%, transparent 60%),var(--bg);
  color:var(--text);min-height:100vh;padding:22px 16px 60px;transition:background .35s}
.rc-wrap{max-width:560px;margin:0 auto}
.rc-h1{font-family:'Space Grotesk';font-weight:700;font-size:26px;letter-spacing:-.02em;margin:0;
  background:linear-gradient(135deg,#FF5C7A,#FFA24C);-webkit-background-clip:text;background-clip:text;color:transparent}
.rc-sub{color:var(--muted);font-size:13px;margin:3px 0 0}
.rc-tabs{display:flex;gap:7px;margin:18px 0 14px}
.rc-tab{flex:1;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:13px;
  padding:10px 6px;font-size:12.5px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;font-family:inherit;transition:.18s}
.rc-tab small{font-size:10px;font-weight:500;opacity:.85}
.rc-tab.on{color:#15101B;border-color:transparent}
.rc-cadence{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:11px 14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;font-size:13px}
.rc-step{width:28px;height:28px;border-radius:9px;border:1px solid var(--line);background:var(--surface2);color:var(--text);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.rc-step:hover{border-color:var(--acc-a)}
.rc-num{font-family:'Space Grotesk';font-weight:700;font-size:18px;min-width:20px;text-align:center}
.rc-hero{position:relative;border-radius:20px;padding:20px;overflow:hidden;background:linear-gradient(160deg,var(--surface2),var(--surface));border:1px solid var(--line)}
.rc-hero.due:before{content:"";position:absolute;inset:0;border-radius:20px;padding:1px;
  background:linear-gradient(135deg,var(--acc-a),var(--acc-b));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;animation:rc-pulse 2.6s ease-in-out infinite}
@keyframes rc-pulse{0%,100%{opacity:.5}50%{opacity:1}}
.rc-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--acc-b)}
.rc-status{margin-left:auto;font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.rc-title{font-family:'Space Grotesk';font-weight:600;font-size:20px;margin:12px 0 8px;letter-spacing:-.01em}
.rc-cap{font-size:13.5px;line-height:1.5;color:#D8CDE2;white-space:pre-wrap}
.rc-tags{font-size:12.5px;color:var(--lilac);margin-top:7px;word-break:break-word}
.rc-actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.rc-btn{flex:1;min-width:128px;border:none;border-radius:12px;padding:11px 12px;font-size:13.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;text-decoration:none}
.rc-btn.primary{background:linear-gradient(135deg,var(--acc-a),var(--acc-b));color:#15101B}
.rc-btn.ghost{background:var(--surface2);color:var(--text);border:1px solid var(--line)}
.rc-btn:hover{filter:brightness(1.08)}
.rc-btn:focus-visible,.rc-step:focus-visible,.rc-icbtn:focus-visible,.rc-tab:focus-visible,.rc-tog:focus-visible{outline:2px solid var(--lilac);outline-offset:2px}
.rc-deck{display:flex;gap:8px;overflow-x:auto;padding:14px 2px 4px;scrollbar-width:none}
.rc-deck::-webkit-scrollbar{display:none}
.rc-chip{flex:0 0 auto;font-size:12px;padding:7px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.rc-chip b{color:var(--text);font-weight:600}
.rc-deck-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 0 0}
.rc-libhead{display:flex;align-items:center;justify-content:space-between;margin:24px 0 10px}
.rc-libhead h2{font-family:'Space Grotesk';font-size:15px;font-weight:600;margin:0}
.rc-add{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit}
.rc-add:hover{border-color:var(--acc-a)}
.rc-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 14px;margin-bottom:9px;display:flex;gap:12px;align-items:flex-start}
.rc-card.upnext{border-color:var(--acc-a)}
.rc-cardtitle{font-weight:600;font-size:14.5px;margin:0 0 5px}
.rc-badges{display:flex;gap:5px}
.rc-badge{width:23px;height:23px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:var(--surface2)}
.rc-meta{font-size:11.5px;color:var(--muted);margin:7px 0 0}
.rc-icbtn{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:5px;border-radius:8px}
.rc-icbtn:hover{color:var(--text);background:var(--surface2)}
.rc-empty{text-align:center;color:var(--muted);font-size:13.5px;padding:32px 16px;border:1px dashed var(--line);border-radius:16px;line-height:1.6}
.rc-form{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
.rc-label{display:block;font-size:11.5px;color:var(--muted);margin:13px 0 5px}
.rc-label:first-child{margin-top:0}
.rc-input,.rc-area{width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--text);padding:10px 12px;font-size:13.5px;font-family:inherit;resize:vertical}
.rc-input:focus,.rc-area:focus{outline:none;border-color:var(--acc-a)}
.rc-tog{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--line);border-radius:11px;margin-top:8px;cursor:pointer;background:var(--bg2);color:var(--text);width:100%;font-family:inherit;font-size:13px;font-weight:500;text-align:left}
.rc-tog.on{border-color:transparent}
.rc-switch{margin-left:auto;width:34px;height:20px;border-radius:999px;background:var(--surface2);position:relative;transition:.15s;flex:0 0 auto}
.rc-tog.on .rc-switch{background:rgba(0,0,0,.35)}
.rc-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.rc-tog.on .rc-knob{left:16px}
.rc-sublink{margin:6px 0 4px 6px;padding-left:10px;border-left:2px solid var(--line)}
.rc-formrow{display:flex;gap:8px;margin-top:16px}
`;

const todayISO = () => new Date().toISOString();
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const uid = () => Math.random().toString(36).slice(2, 9);
const hasStore = typeof window !== "undefined" && window.storage;

function migrate(s) {
  let cadence = s.cadence;
  if (typeof cadence === "number") cadence = { instagram: cadence, tiktok: cadence, youtube: cadence };
  cadence = { instagram: 5, tiktok: 4, youtube: 7, ...(cadence || {}) };
  const reels = (s.reels || []).map((r) => {
    if (r.platforms && r.posted) return r;
    return {
      id: r.id || uid(), title: r.title, caption: r.caption || "", hashtags: r.hashtags || "",
      links: { instagram: r.url || "", tiktok: "", youtube: "" },
      platforms: { instagram: true, tiktok: false, youtube: false },
      posted: { instagram: r.lastPosted || null, tiktok: null, youtube: null },
      timesPosted: { instagram: r.timesPosted || 0, tiktok: 0, youtube: 0 },
    };
  });
  return { reels, cadence };
}

export default function Recirculate() {
  const [reels, setReels] = useState([]);
  const [cadence, setCadence] = useState({ instagram: 5, tiktok: 4, youtube: 7 });
  const [plat, setPlat] = useState("instagram");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(false);
  const firstSave = useRef(true);

  useEffect(() => {
    (async () => {
      if (hasStore) {
        try {
          const r = await window.storage.get("recirculate-state");
          if (r && r.value) { const s = migrate(JSON.parse(r.value)); setReels(s.reels); setCadence(s.cadence); }
        } catch (e) {}
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (firstSave.current) { firstSave.current = false; return; }
    if (hasStore) window.storage.set("recirculate-state", JSON.stringify({ reels, cadence })).catch(() => {});
  }, [reels, cadence, loaded]);

  const acc = PLATFORMS[plat];
  const inRot = reels.filter((r) => r.platforms[plat]);
  const ordered = [...inRot].sort((a, b) => {
    const x = a.posted[plat], y = b.posted[plat];
    if (!x && !y) return 0; if (!x) return -1; if (!y) return 1;
    return new Date(x) - new Date(y);
  });
  const upNext = ordered[0] || null;
  const globalLast = reels.reduce((m, r) => { const p = r.posted[plat]; return p && (!m || p > m) ? p : m; }, null);
  const sinceLast = globalLast ? daysBetween(globalLast, todayISO()) : null;
  const dueNow = !globalLast || sinceLast >= cadence[plat];
  const daysLeft = globalLast ? Math.max(0, cadence[plat] - sinceLast) : 0;

  const markPosted = (id) => setReels((rs) => rs.map((r) => r.id === id
    ? { ...r, posted: { ...r.posted, [plat]: todayISO() }, timesPosted: { ...r.timesPosted, [plat]: (r.timesPosted[plat] || 0) + 1 } } : r));
  const remove = (id) => setReels((rs) => rs.filter((r) => r.id !== id));
  const copyCaption = (r) => {
    const t = [r.caption, r.hashtags].filter(Boolean).join("\n\n");
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  const saveReel = (data) => {
    setReels((rs) => data.id
      ? rs.map((r) => (r.id === data.id ? { ...r, ...data } : r))
      : [...rs, { id: uid(), posted: { instagram: null, tiktok: null, youtube: null }, timesPosted: { instagram: 0, tiktok: 0, youtube: 0 }, ...data }]);
    setEditing(null);
  };

  if (!loaded) return <div style={{ background: "#15101B", minHeight: "100vh" }} />;

  return (
    <div className="rc-root" style={{ "--acc-a": acc.a, "--acc-b": acc.b,
      background: `radial-gradient(120% 60% at 50% -10%, ${acc.a}28 0%, transparent 60%), var(--bg)` }}>
      <style>{CSS}</style>
      <div className="rc-wrap">
        <h1 className="rc-h1">Recirculate</h1>
        <p className="rc-sub">Your short-form clips, back in rotation across every platform.</p>

        <div className="rc-tabs">
          {PK.map((k) => (
            <button key={k} className={"rc-tab" + (k === plat ? " on" : "")} onClick={() => setPlat(k)}
              style={k === plat ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})` } : {}}>
              <Icon p={k} size={17} color={k === plat ? "#15101B" : "var(--muted)"} />
              {PLATFORMS[k].name}<small>{PLATFORMS[k].sub}</small>
            </button>
          ))}
        </div>

        <div className="rc-cadence">
          <RotateCw size={15} color={acc.b} />
          <span>Repost a {acc.sub} every</span>
          <button className="rc-step" onClick={() => setCadence((c) => ({ ...c, [plat]: Math.max(1, c[plat] - 1) }))} aria-label="Fewer days">–</button>
          <span className="rc-num">{cadence[plat]}</span>
          <button className="rc-step" onClick={() => setCadence((c) => ({ ...c, [plat]: Math.min(60, c[plat] + 1) }))} aria-label="More days">+</button>
          <span>{cadence[plat] === 1 ? "day" : "days"}</span>
        </div>

        {upNext ? (
          <div className={"rc-hero" + (dueNow ? " due" : "")}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="rc-eyebrow"><Icon p={plat} size={12} color={acc.b} /> Up next on {acc.name}</span>
              <span className="rc-status"><Clock size={12} />{dueNow ? "Ready to post now" : `Due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}</span>
            </div>
            <div className="rc-title">{upNext.title}</div>
            {upNext.caption && <div className="rc-cap">{upNext.caption}</div>}
            {upNext.hashtags && <div className="rc-tags">{upNext.hashtags}</div>}
            <div className="rc-actions">
              <button className="rc-btn ghost" onClick={() => copyCaption(upNext)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy caption"}
              </button>
              <a className="rc-btn ghost" href={upNext.links[plat] || HOME[plat]} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> Open clip
              </a>
              <button className="rc-btn primary" onClick={() => markPosted(upNext.id)}>
                <Check size={15} /> Mark as posted
              </button>
            </div>
          </div>
        ) : (
          <div className="rc-empty">
            {reels.length === 0
              ? <>No clips yet.<br />Add your best ones below and they'll start cycling back around.</>
              : <>Nothing set for {acc.name} yet.<br />Open a clip in your library and switch on {acc.name}.</>}
          </div>
        )}

        {ordered.length > 1 && (
          <>
            <div className="rc-deck-label">Then back around to</div>
            <div className="rc-deck">
              {ordered.slice(1).map((r, i) => <div key={r.id} className="rc-chip"><b>{i + 2}.</b> {r.title}</div>)}
              <div className="rc-chip" style={{ color: acc.a }}>↻ loops</div>
            </div>
          </>
        )}

        <div className="rc-libhead">
          <h2>Library {reels.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {reels.length}</span>}</h2>
          {editing !== "new" && <button className="rc-add" onClick={() => setEditing("new")}><Plus size={14} /> Add clip</button>}
        </div>

        {editing === "new" && <ReelForm onSave={saveReel} onCancel={() => setEditing(null)} />}

        {reels.map((r) => editing === r.id ? (
          <ReelForm key={r.id} reel={r} onSave={saveReel} onCancel={() => setEditing(null)} />
        ) : (
          <div key={r.id} className={"rc-card" + (upNext && r.id === upNext.id ? " upnext" : "")}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="rc-cardtitle">{r.title}</p>
              <div className="rc-badges">
                {PK.map((k) => (
                  <div key={k} className="rc-badge" style={r.platforms[k] ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})` } : {}}>
                    <Icon p={k} size={13} color={r.platforms[k] ? "#15101B" : "var(--muted)"} />
                  </div>
                ))}
              </div>
              <p className="rc-meta">
                {r.platforms[plat]
                  ? (r.posted[plat] ? `${acc.name}: last posted ${fmt(r.posted[plat])} · ${r.timesPosted[plat] || 0}×` : `${acc.name}: never posted`)
                  : `Not in ${acc.name} rotation`}
              </p>
            </div>
            <button className="rc-icbtn" onClick={() => setEditing(r.id)} aria-label="Edit"><Pencil size={15} /></button>
            <button className="rc-icbtn" onClick={() => remove(r.id)} aria-label="Delete"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReelForm({ reel, onSave, onCancel }) {
  const [title, setTitle] = useState(reel?.title || "");
  const [caption, setCaption] = useState(reel?.caption || "");
  const [hashtags, setHashtags] = useState(reel?.hashtags || "");
  const [platforms, setPlatforms] = useState(reel?.platforms || { instagram: true, tiktok: false, youtube: false });
  const [links, setLinks] = useState(reel?.links || { instagram: "", tiktok: "", youtube: "" });

  const submit = () => {
    if (!title.trim()) return;
    onSave({ id: reel?.id, title: title.trim(), caption, hashtags, platforms, links });
  };

  return (
    <div className="rc-form">
      <label className="rc-label">Clip name</label>
      <input className="rc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lev Tahor — chorus clip" />
      <label className="rc-label">Caption</label>
      <textarea className="rc-area" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="The caption you'll paste when you repost." />
      <label className="rc-label">Hashtags</label>
      <textarea className="rc-area" rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#yourtags #here" />
      <label className="rc-label">Post this clip to</label>
      {PK.map((k) => (
        <div key={k}>
          <button className={"rc-tog" + (platforms[k] ? " on" : "")} onClick={() => setPlatforms((p) => ({ ...p, [k]: !p[k] }))}
            style={platforms[k] ? { background: `linear-gradient(135deg,${PLATFORMS[k].a},${PLATFORMS[k].b})`, color: "#15101B" } : {}}>
            <Icon p={k} size={16} color={platforms[k] ? "#15101B" : "var(--muted)"} />
            {PLATFORMS[k].name} <span style={{ opacity: .7, fontWeight: 400 }}>· {PLATFORMS[k].sub}</span>
            <span className="rc-switch"><span className="rc-knob" /></span>
          </button>
          {platforms[k] && (
            <div className="rc-sublink">
              <input className="rc-input" value={links[k]} onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))}
                placeholder={`Link to this clip on ${PLATFORMS[k].name} (optional)`} />
            </div>
          )}
        </div>
      ))}
      <div className="rc-formrow">
        <button className="rc-btn ghost" onClick={onCancel} style={{ flex: 0, minWidth: 0, padding: "11px 16px" }}><X size={15} /></button>
        <button className="rc-btn primary" onClick={submit}>{reel ? "Save changes" : "Add to rotation"}</button>
      </div>
    </div>
  );
}
