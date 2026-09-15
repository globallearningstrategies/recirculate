"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import LyricEditor from "./lyric-editor";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Headphones, Music2, Sparkles, Upload, Volume2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { energyExcerpts } from "@/lib/suggest-excerpts";
import { ASSET_BUCKET, MAX_ASSET_BYTES, QUIET_DEFAULTS, TREATMENTS, validateExcerpts, type Excerpt, type Preferences, type StudioAsset, type StudioJob, type Treatment } from "@/lib/studio";

type Song = { id: string; title: string; slug: string };
type Connection = { platform: string; username: string; external_user_id: string };
type Scheduled = { id: string; studio_job_id: string; platform: string; run_at: string; status: string; error: string | null };
async function api(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
async function readWithDeadline<T>(work: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} took too long. Reload the studio to try again.`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

export default function Studio({ reloadHref = "/studio?reload=1" }: { reloadHref?: string }) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songId, setSongId] = useState("");
  const [title, setTitle] = useState("");
  const [asset, setAsset] = useState<StudioAsset | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const newSongId = useRef<string | null>(null);
  const previewEnd = useRef<number | null>(null);
  const [files, setFiles] = useState<{ audio?: File; artwork?: File; performance?: File }>({});
  const [duration, setDuration] = useState(0);
  const [masterLyrics, setMasterLyrics] = useState("");
  const [excerpts, setExcerpts] = useState<Excerpt[]>([{ start: 0, duration: 20, lyrics: "" }]);
  const [treatments, setTreatments] = useState<Treatment[]>(["cosmic"]);
  const [language, setLanguage] = useState("");
  const [editingJob, setEditingJob] = useState("");
  const [editedLyrics, setEditedLyrics] = useState("");
  const [editMedia, setEditMedia] = useState<{src: string; offset: number}>({src: "", offset: 0});
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [batch, setBatch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [destination, setDestination] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [firstDate, setFirstDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [preferences, setPreferences] = useState<Preferences>(QUIET_DEFAULTS);
  const [busy, setBusy] = useState("");
  const [rendering, setRendering] = useState(false);
  const stopRendering = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [step, setStep] = useState<"create" | "review">("create");

  const refreshJobs = useCallback(async () => {
    const data = await readWithDeadline(api("/api/studio/batches"), "Loading drafts");
    setJobs(data.jobs);
    return data.jobs as StudioJob[];
  }, []);
  const refreshSchedule = useCallback(async () => {
    const { data, error } = await readWithDeadline(supabase.from("scheduled_posts").select("id,studio_job_id,platform,run_at,status,error").not("studio_job_id", "is", null).order("run_at", { ascending: false }).limit(100), "Loading the schedule");
    if (error) throw error;
    setScheduled(data ?? []);
  }, [supabase]);
  useEffect(() => {
    let active = true;
    setInteractive(true);
    (async () => {
      // Load independently: inbox settings or scheduling must not hold up songs.
      const results = await Promise.allSettled([
        readWithDeadline(supabase.from("songs").select("id,title,slug").order("created_at", { ascending: false }), "Loading songs").then(({ data, error }) => {
          if (error) throw error;
          if (active) setSongs((current) => [...current.filter(song => !(data ?? []).some(row => row.id === song.id)), ...(data ?? [])]);
        }),
        readWithDeadline(supabase.from("social_connections").select("platform,username,external_user_id"), "Loading accounts").then(({ data, error }) => {
          if (error) throw error;
          if (active) setConnections(data ?? []);
        }),
        readWithDeadline(api("/api/studio/preferences"), "Loading notification settings").then(prefs => {
          if (active) { setPreferences(prefs); setPreferencesLoaded(true); }
        }),
        refreshJobs(), refreshSchedule(),
      ]);
      if (active) {
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failures.length) setError(failures.map(r => r.reason?.message || "Some studio data could not load.").join(" "));
        setLoaded(true);
      }
    })();
    return () => { active = false; stopRendering.current = true; };
  }, [supabase, refreshJobs, refreshSchedule]);
  useEffect(() => {
    let active = true;
    // Creating a song must not discard the file already chosen on the phone.
    if (newSongId.current === songId) { newSongId.current = null; return; }
    setAsset(null); setFiles({}); setDuration(0); setMasterLyrics(""); setAudioUrl(""); setExcerpts([{ start: 0, duration: 20, lyrics: "" }]);
    if (songId) (async () => {
      try {
      const { data, error } = await readWithDeadline(supabase.from("song_assets").select("*").eq("song_id", songId).maybeSingle(), "Loading this song");
      if (!active) return;
      if (error) { setError(error.message); return; }
      if (data) {
        setAsset(data); setDuration(data.duration); setMasterLyrics(data.lyrics);
        const { data: signed } = await readWithDeadline(supabase.storage.from(ASSET_BUCKET).createSignedUrl(data.audio_path, 3600), "Loading audio preview");
        if (active) setAudioUrl(signed?.signedUrl ?? "");
      }
      } catch (e: any) { if (active) setError(e.message); }
    })();
    return () => { active = false; };
  }, [songId, supabase]);
  useEffect(() => {
    if (!files.audio) return;
    const url = URL.createObjectURL(files.audio); setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [files.audio]);

  const action = async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(label); setError(""); setMessage("");
    try { await work(); } catch (e: any) { setError(e.message || "Please try again."); } finally { setBusy(""); }
  };
  const upload = async (kind: "audio" | "artwork" | "performance", file: File, userId: string) => {
    if (file.size > MAX_ASSET_BYTES) throw new Error(`${file.name} exceeds 50 MB. Export a smaller file.`);
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const path = `${userId}/${crypto.randomUUID()}/${kind}.${ext}`;
    const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (error) throw error;
    return path;
  };
  const saveAssets = () => action("Saving song…", async () => {
    if (!files.audio && !asset?.audio_path) throw new Error("Choose an audio file.");
    if (!Number.isFinite(duration) || duration < 10 || duration > 3600) throw new Error("Wait for the audio to load. Songs must be 10 seconds to one hour long.");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in again to save your song.");
    const selectedSongId = songId || (await createSong()).id;
    const next: StudioAsset = {
      song_id: selectedSongId, audio_path: files.audio ? await upload("audio", files.audio, user.id) : asset!.audio_path,
      audio_name: files.audio?.name ?? asset!.audio_name, duration,
      artwork_path: files.artwork ? await upload("artwork", files.artwork, user.id) : asset?.artwork_path ?? null,
      performance_path: files.performance ? await upload("performance", files.performance, user.id) : asset?.performance_path ?? null,
      lyrics: masterLyrics,
    };
    const { error } = await supabase.from("song_assets").upsert({ ...next, user_id: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
    setAsset(next); setFiles({});
    const signed = await supabase.storage.from(ASSET_BUCKET).createSignedUrl(next.audio_path, 3600);
    setAudioUrl(signed.data?.signedUrl ?? ""); setMessage("Song saved. Choose your excerpts below.");
  });
  const createSong = async () => {
    const songTitle = title.trim() || files.audio?.name.replace(/\.[^.]+$/, "").trim();
    if (!songTitle) throw new Error("Enter a song title or choose an audio file.");
    const slug = (songTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "song") + "-" + crypto.randomUUID().slice(0, 6);
    const { data, error } = await supabase.from("songs").insert({ title: songTitle, slug }).select("id,title,slug").single();
    if (error) throw error;
    newSongId.current = data.id; setAsset(null);
    if (!files.audio) { setAudioUrl(""); setDuration(0); setMasterLyrics(""); setExcerpts([{ start: 0, duration: 20, lyrics: "" }]); }
    setSongs((old) => [data, ...old]); setSongId(data.id); setTitle("");
    return data;
  };
  const addSong = () => action("Adding song…", async () => { await createSong(); });
  const updateExcerpt = (i: number, update: Partial<Excerpt>) => setExcerpts((old) => old.map((e, j) => i === j ? { ...e, ...update } : e));
  const suggest = () => action("Finding energetic moments…", async () => {
    if (!audioUrl) throw new Error("Save an audio file first.");
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("Reload the song to refresh its audio preview.");
    const context = new OfflineAudioContext(1, 1, 22050);
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    const length = Math.min(20, Math.floor(audio.duration));
    const starts = energyExcerpts(audio.getChannelData(0), audio.sampleRate, 3, length);
    setExcerpts(starts.map((start) => ({ start, duration: length, lyrics: "" })));
    setMessage("Suggested up to three energetic moments. Listen and adjust them before adding lyrics.");
  });
  const preview = (e: Excerpt) => {
    if (!audioRef.current) return;
    previewEnd.current = e.start + e.duration; audioRef.current.currentTime = e.start;
    audioRef.current.play().catch(() => setError("Tap the audio player to start playback."));
  };
  const transcribe = (i: number) => action(`Listening to excerpt ${i + 1}…`, async () => {
    if (!asset) throw new Error("Save your audio first.");
    validateExcerpts([{ ...excerpts[i], lyrics: "validate" }], asset.duration);
    const data = await api("/api/transcribe", { audioPath: asset.audio_path, studio: true, start: excerpts[i].start, duration: excerpts[i].duration, language });
    updateExcerpt(i, { lyrics: data.lyrics }); setMessage(data.timing === "words" ? "Phrase cards are ready. Listen, correct the words, and adjust their start and end times." : "Phrase cards are ready with estimated timing. Listen and adjust each card before rendering.");
  });
  const createBatch = () => action("Creating drafts…", async () => {
    if (!asset || Object.values(files).some(Boolean)) throw new Error("Save your song assets before creating a batch.");
    validateExcerpts(excerpts, asset.duration);
    const data = await api("/api/studio/batches", { songId, excerpts, treatments });
    await refreshJobs(); setBatch(data.batchId); setSelected([]); setStep("review"); setMessage(`${data.count} drafts queued. Start rendering when you’re ready.`);
  });
  const renderBatch = async () => {
    if (rendering) return;
    setRendering(true); stopRendering.current = false; setError("");
    try {
      const current = await refreshJobs();
      for (const job of current.filter((j) => j.batch_id === activeBatch && j.status !== "ready")) {
        if (stopRendering.current) break;
        setMessage(`Rendering ${job.title}…`);
        try { await api("/api/studio/render", { jobId: job.id }); } catch (e: any) { setError(e.message); }
        await refreshJobs();
      }
      setMessage(stopRendering.current ? "Paused. Your completed videos are saved." : "Render pass finished. Review the videos below; any failed drafts can be retried.");
    } catch (e: any) { setError(e.message); } finally { setRendering(false); }
  };
  const activeBatch = batch || jobs[0]?.batch_id || "";
  const saveRevision = () => action("Saving corrected lyrics…", async () => {
    await api("/api/studio/revisions", { jobId: editingJob, lyrics: editedLyrics });
    await refreshJobs(); setEditingJob("");
    setMessage("Corrected lyrics saved as a new draft. Tap Render / resume batch to make the updated video. Your previous video is kept.");
  });
  const batchJobs = jobs.filter((j) => j.batch_id === activeBatch).sort((a, b) => a.start_seconds - b.start_seconds || a.treatment.localeCompare(b.treatment));
  const ready = batchJobs.filter((j) => j.status === "ready");
  const batches = Array.from(new Set(jobs.map((j) => j.batch_id)));
  const account = connections.find((c) => `${c.platform}:${c.external_user_id}` === destination);
  const schedule = () => action("Scheduling…", async () => {
    if (!account || !confirmed) throw new Error("Choose and confirm the destination account.");
    const data = await api("/api/studio/schedule", { jobIds: selected, platform: account.platform, accountId: account.external_user_id, firstDate });
    await refreshSchedule(); setSelected([]); setConfirmed(false); setMessage(`${data.count} clips scheduled for ${data.destination}.`);
  });
  const draftBlocker = !asset ? "Choose your audio and tap Save song in step 1." : Object.values(files).some(Boolean) ? "Save your new song files in step 1." : !treatments.length ? "Choose a visual style below." : excerpts.some(e => !e.lyrics.trim()) ? "Add lyrics in step 2: tap Auto-transcribe or paste your lyrics." : "";
  const saveBlocker = !files.audio && !asset ? "Choose your MP3 above to get started." : !duration ? "Loading audio preview. If it stays here, reselect the file or reload the studio." : "";

  return <main className="studio-shell">
    <header className="studio-header"><Link href="/" className="studio-back"><ArrowLeft size={16} /> Library & accounts</Link><span className="studio-wordmark"><span className="studio-orbit">↻</span> recirculate <span>STUDIO</span></span><a href="#notifications" className="studio-quiet">Quiet by design</a></header>
    <section className="studio-hero"><div><div className="studio-eyebrow">YOUR MUSIC. MORE MOMENTS.</div><h1>One song.<br /><em>A whole new story.</em></h1><p>Turn the moments that matter into lyric videos worth watching. Upload once, explore a few looks, and choose what goes out.</p><div className="studio-pills"><span><Headphones size={14} /> Audio to video</span><span>9:16 · 1080p</span><span>Made for your clips channel</span></div></div><div className="studio-art" aria-hidden="true"><div className="studio-record"><div /></div><div className="studio-lyric">LET THE<br /><i>music</i><br />FIND YOU.</div><div className="studio-art-label"><Volume2 size={15} /> YOUR NEXT FAVORITE MOMENT</div></div></section>
    <nav className="studio-steps" aria-label="Studio steps"><button className={step === "create" ? "active" : ""} onClick={() => setStep("create")}><span>01</span> Song & excerpts</button><ArrowRight size={16} /><button className={step === "review" ? "active" : ""} onClick={() => setStep("review")}><span>02</span> Review & schedule <small>{jobs.length}</small></button></nav>
    {error && <div className="studio-message error" role="alert">{error}</div>}
    {message && <div className="studio-message" role="status">{message}</div>}
    {!interactive && <div className="studio-message" role="status">Starting your studio… If the buttons stay unresponsive, <a href={reloadHref} style={{ textDecoration: "underline" }}>reload the studio</a>. If this keeps happening in the home-screen app, open this page in Safari.<noscript> JavaScript must be enabled to make videos.</noscript></div>}
    {interactive && !loaded && <p role="status">Loading saved songs and drafts… You can choose your audio now.</p>}
    {error && <p className="studio-hint"><a href={reloadHref} style={{ textDecoration: "underline" }}>Reload the studio</a> to retry loading.</p>}
    {step === "create" ? <div className="studio-create">
      <section className="studio-panel"><div className="studio-section-heading"><span className="studio-number">01</span><div><h2>Start with a song</h2><p>Your original audio is all you need.</p></div></div>
        <label>Song<select value={songId} disabled={!!busy || rendering} onChange={(e) => setSongId(e.target.value)}><option value="">Choose a song</option>{songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>
        <div className="studio-inline"><input aria-label="New song title" placeholder="Or add a new song…" value={title} onChange={(e) => setTitle(e.target.value)} /><button onClick={addSong} disabled={!!busy || !title.trim()}>Add song</button></div>
        {/* Let Files select audio even when iOS reports a missing or generic media type. */}
        <label className="studio-upload"><Upload size={26} /><strong>{files.audio?.name || asset?.audio_name || "Drop into your next chapter"}</strong><span>Choose an MP3, WAV, M4A, or original video · up to 50 MB</span><input type="file" aria-label="Song audio or original video" disabled={!!busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) { setError(""); setMessage(""); if (file.size > MAX_ASSET_BYTES) { setError(`${file.name} exceeds 50 MB. Export a smaller file.`); e.target.value = ""; return; } if (!songId && !title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "")); previewEnd.current = null; setDuration(0); setFiles((old) => ({ ...old, audio: file })); } }} /></label>
        {audioUrl && <audio ref={audioRef} controls src={audioUrl} preload="metadata" onError={() => { setDuration(0); setError(files.audio ? "This file could not be played. Choose an MP3, WAV, M4A, or a compatible original video from Files." : "Could not load the saved audio. Reload the song and try again."); }} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }} onTimeUpdate={(e) => { if (previewEnd.current !== null && e.currentTarget.currentTime >= previewEnd.current) { e.currentTarget.pause(); previewEnd.current = null; } }} />}
        <div className="studio-asset-grid"><label>Artwork <small>optional{asset?.artwork_path ? " · saved" : ""}</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((old) => ({ ...old, artwork: e.target.files?.[0] }))} /></label><label>Performance footage <small>optional{asset?.performance_path ? " · saved" : ""}</small><input type="file" accept="video/mp4,video/quicktime" onChange={(e) => setFiles((old) => ({ ...old, performance: e.target.files?.[0] }))} /></label></div>
        <p className="studio-hint">Performance footage should start at the same point as your song. The original audio stays private; completed videos can be downloaded or published.</p>
        <details><summary>Keep the full lyrics with this song</summary><textarea aria-label="Full song lyrics" value={masterLyrics} onChange={(e) => setMasterLyrics(e.target.value)} placeholder="Paste your original lyrics for reference…" rows={5} /></details>
        {saveBlocker && <p className="studio-hint" id="save-help">{saveBlocker}</p>}
        <button className="studio-primary" onClick={saveAssets} disabled={!!busy || !!saveBlocker} aria-describedby={saveBlocker ? "save-help" : undefined}><Check size={16} /> Save song</button>
      </section>
      <section className="studio-panel"><div className="studio-section-heading"><span className="studio-number">02</span><div><h2>Find your moments</h2><p>Choose up to three excerpts, 10–45 seconds each.</p></div></div>
        <div className="studio-inline"><label>Lyrics language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="fr">French</option><option value="he">Hebrew</option><option value="">Mixed Hebrew + English / auto-detect</option></select></label><span className="studio-hint">Start with your chorus, a striking lyric, or a musical lift.</span></div>
        <button disabled={!!busy || !asset || excerpts.some((e) => !!e.lyrics)} onClick={suggest} style={{ marginBottom: 18 }}><Sparkles size={14} /> Suggest energetic moments</button>
        {excerpts.map((excerpt, i) => <div className="studio-excerpt" key={i}><div className="studio-inline spread"><strong>Moment {i + 1}</strong>{excerpts.length > 1 && <button className="studio-text-button" disabled={!!busy} onClick={() => setExcerpts((old) => old.filter((_, j) => j !== i))}>Remove</button>}</div><div className="studio-time-fields"><label>Start (seconds)<input type="number" min="0" step="0.1" value={excerpt.start} onChange={(e) => updateExcerpt(i, { start: Number(e.target.value) })} /></label><label>Length (seconds)<input type="number" min="10" max="45" value={excerpt.duration} onChange={(e) => updateExcerpt(i, { duration: Number(e.target.value) })} /></label><button onClick={() => preview(excerpt)} disabled={!audioUrl}><Headphones size={15} /> Listen</button></div><LyricEditor value={excerpt.lyrics} onChange={lyrics => updateExcerpt(i, { lyrics })} duration={excerpt.duration} src={audioUrl} offset={excerpt.start} disabled={!!busy} /><div className="studio-inline"><button onClick={() => transcribe(i)} disabled={!!busy || !asset}><Sparkles size={14} /> Auto-transcribe</button><span className="studio-hint">Edit the text above freely, including Hebrew script. Mixed-language singing may need manual corrections.</span></div></div>)}
        <p className="studio-hint">Use one short phrase per card. Set its start when singing begins and its end when singing stops. Add Hebrew phrases directly; use Split phrase if a card is too long.</p>
        <button disabled={excerpts.length >= 3 || !!busy} onClick={() => setExcerpts((old) => [...old, { start: Math.min(Math.max(0, duration - 20), old[old.length - 1].start + 30), duration: Math.min(20, duration || 20), lyrics: "" }])}>+ Add another moment</button>
      </section>
      <section className="studio-panel studio-full"><div className="studio-section-heading"><span className="studio-number">03</span><div><h2>Give it a look</h2><p>Choose up to four styles. Cosmic Dreamcore creates continuous animation: flying through luminous gates, rolling water, orbiting planets and flowing stars. No extra subscription needed.</p></div></div><div className="studio-treatments">{(Object.entries(TREATMENTS) as [Treatment, typeof TREATMENTS[Treatment]][]).map(([key, value]) => { const unavailable = (key === "artwork" && !asset?.artwork_path) || (key === "performance" && !asset?.performance_path); return <button key={key} className={`studio-treatment ${key} ${treatments.includes(key) ? "chosen" : ""}`} aria-pressed={treatments.includes(key)} disabled={unavailable || (!treatments.includes(key) && treatments.length >= 4)} onClick={() => setTreatments((old) => old.includes(key) ? old.filter((t) => t !== key) : [...old, key])}><span className="studio-treatment-art">{key === "cosmic" ? <><span>✧</span><i>Cosmic Dreamcore</i></> : key === "spiritual" ? <>✡<i>Light & wonder</i></> : key === "kinetic" ? <>MAKE<br /><i>it move.</i></> : key === "visualizer" ? "▂▅▃▇▅▂▆▇▃" : key === "artwork" ? "◉" : <Clapperboard size={42} />}</span><strong>{value.label}{treatments.includes(key) && <Check size={15} />}</strong><small>{unavailable ? `Save ${key === "artwork" ? "artwork" : "footage"} to unlock` : value.description}</small></button>; })}</div><div className="studio-generate"><div><strong>{excerpts.length * treatments.length} videos, one creative session.</strong><p>Drafts stay off your publishing schedule until you select them.</p>{draftBlocker && <p id="draft-help" role="status">{draftBlocker}</p>}</div><button className="studio-primary" disabled={!!busy || !!draftBlocker || rendering} aria-describedby={draftBlocker ? "draft-help" : undefined} onClick={createBatch}><Sparkles size={17} /> Create {excerpts.length * treatments.length} drafts <ArrowRight size={16} /></button></div></section>
    </div> : <section className="studio-panel"><div className="studio-section-heading"><span className="studio-number"><Clapperboard size={21} /></span><div><h2>Your next releases</h2><p>Preview the full video and choose the ones you love.</p></div></div>{jobs.length === 0 ? <div className="studio-empty"><Music2 size={36} /><h3>Your first batch starts with a song.</h3><p>Upload an audio file and choose your favorite moments.</p><button className="studio-primary" onClick={() => setStep("create")}>Create a batch</button></div> : <><div className="studio-inline spread"><label>Batch<select value={activeBatch} disabled={rendering} onChange={(e) => { setBatch(e.target.value); setSelected([]); }}>{batches.map((id) => { const job = jobs.find((j) => j.batch_id === id)!; return <option key={id} value={id}>{job.title.split(" · ")[0]} · {new Date(job.created_at).toLocaleString()}</option>; })}</select></label><div className="studio-inline"><span>{ready.length}/{batchJobs.length} ready</span>{rendering ? <button onClick={() => { stopRendering.current = true; }}>Pause after this video</button> : <button className="studio-primary" onClick={renderBatch} disabled={ready.length === batchJobs.length}>Render / resume batch</button>}</div></div><p className="studio-hint">Keep this page open while rendering. Completed videos and queued drafts are saved; return here to resume after an interruption.</p><div className="studio-review-grid">{batchJobs.map((job) => <article key={job.id} className={`studio-video-card ${selected.includes(job.id) ? "selected" : ""}`}>{job.video_url ? <video controls playsInline preload="none" poster={job.thumb_url} src={job.video_url} /> : <div className={`studio-video-placeholder ${job.treatment}`}><Clapperboard size={30} /><strong>{job.status === "queued" ? "Ready to render" : job.status === "rendering" ? "Rendering…" : "Needs another try"}</strong></div>}<div className="studio-video-info"><label><input type="checkbox" disabled={job.status !== "ready"} checked={selected.includes(job.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, job.id] : old.filter((id) => id !== job.id))} /><strong>{TREATMENTS[job.treatment].label}</strong></label><small>{time(job.start_seconds)} · {job.duration_seconds}s</small>{job.error && <p className="studio-card-error">{job.error}</p>}{job.video_url && <a href={job.video_url} target="_blank" rel="noreferrer">Open / download MP4 ↗</a>}<button className="studio-edit-lyrics" disabled={!!busy || rendering || job.status === "rendering"} onClick={() => action("Opening lyric editor…", async () => { const media = job.video_url ? { src: job.video_url, offset: 0 } : await api(`/api/studio/revisions?jobId=${encodeURIComponent(job.id)}`); setEditMedia(media); setEditingJob(job.id); setEditedLyrics(job.lyrics); })}>Edit lyrics / make new version</button>{editingJob === job.id && <div className="studio-lyrics-editor"><LyricEditor value={editedLyrics} onChange={setEditedLyrics} duration={job.duration_seconds} src={editMedia.src} offset={editMedia.offset} disabled={!!busy} /><p>This saves a new draft and keeps the previous video.</p><button className="studio-primary" disabled={!!busy || !editedLyrics.trim()} onClick={saveRevision}>Save corrected draft</button><button disabled={!!busy} onClick={() => setEditingJob("")}>Cancel editing</button></div>}</div></article>)}</div><div className="studio-scheduling"><h3>Make room for your favorites.</h3><p>Select videos above, then schedule one a day. To post to a new clips account, connect it from Library & accounts first.</p><div className="studio-time-fields"><label>Destination<select value={destination} onChange={(e) => { setDestination(e.target.value); setConfirmed(false); }}><option value="">Choose an account</option>{connections.filter((c) => ["instagram", "youtube"].includes(c.platform)).map((c) => <option key={c.platform} value={`${c.platform}:${c.external_user_id}`}>{c.platform} · {c.username}</option>)}</select></label><label>First posting day<input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} /></label></div><p className="studio-hint">Publishing runs daily around 14:00 UTC ({new Date("2026-09-15T14:00:00Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })} at this time of year). TikTok and other accounts can use downloaded videos.</p>{account && <label className="studio-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Publish these clips to {account.username} on {account.platform}.</label>}<button className="studio-primary" disabled={!selected.length || !confirmed || !!busy} onClick={schedule}>Schedule {selected.length} selected {selected.length === 1 ? "clip" : "clips"}</button></div></>}
      {scheduled.length > 0 && <div className="studio-schedule-list"><h3>Publishing schedule</h3>{scheduled.map((post) => <div key={post.id}><span>{new Date(post.run_at).toLocaleDateString()} · {post.platform} <small>{post.status}</small>{post.error && <p>{post.error}</p>}</span>{post.status === "pending" && <button disabled={!!busy} onClick={() => action("Canceling…", async () => { const { error } = await supabase.from("scheduled_posts").update({ status: "canceled" }).eq("id", post.id).eq("status", "pending"); if (error) throw error; await refreshSchedule(); })}>Cancel</button>}</div>)}</div>}
    </section>}
    <section className="studio-notifications" id="notifications"><div><div className="studio-eyebrow">LESS NOISE. MORE MUSIC.</div><h2>Your inbox, your choice.</h2><p>Routine emails and push reminders start off. Scheduled posts keep running.</p></div><div>{([["daily_reminders", "Daily posting reminders"], ["weekly_summary", "Weekly performance email"], ["failure_alerts", "Failed posts & connection alerts"]] as [keyof Preferences, string][]).map(([key, label]) => <label className="studio-toggle" key={key}>{label}<input type="checkbox" checked={preferences[key]} disabled={!!busy || !preferencesLoaded} onChange={(e) => { const next = { ...preferences, [key]: e.target.checked }; action("Saving preferences…", async () => { await api("/api/studio/preferences", next, "PUT"); setPreferences(next); setMessage("Notification preferences saved."); }); }} /></label>)}</div></section>
    {busy && <div className="studio-working" role="status">{busy}</div>}
    <footer className="studio-footer">A little less admin. A lot more music. <span>RECIRCULATE STUDIO</span></footer>
  </main>;
}
