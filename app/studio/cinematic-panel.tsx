"use client";
import { useEffect, useRef, useState } from "react";
import { cinematicPlan, type CinematicPlan } from "@/lib/cinematic";
import type { StudioJob } from "@/lib/studio";

type Run = { id: string; title: string; status: string; error?: string; plan: CinematicPlan; done: number; preview?: string; jobId?: string; batchId?: string };
async function request(body?: unknown) {
  const res = await fetch("/api/studio/cinematic", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json(); if (!res.ok) throw new Error(json.error || "Could not contact the cinematic studio."); return json;
}
export default function CinematicPanel({ jobs, onDraft }: { jobs: StudioJob[]; onDraft: (batch: string) => Promise<void> }) {
  const [runs, setRuns] = useState<Run[]>([]), [connection, setConnection] = useState("Checking Runway…"), [credits, setCredits] = useState<number | null>(null);
  const [selected, setSelected] = useState(""), [quote, setQuote] = useState<{ id: string; jobId: string; plan: CinematicPlan } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), locked = useRef(false), pause = useRef(false);
  const refresh = async () => {
    const data = await request();
    if (alive.current) { setRuns(data.runs); setConnection(data.connection); setCredits(data.credits); }
    return data.runs as Run[];
  };
  useEffect(() => { alive.current = true; refresh().catch(e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; pause.current = true; }; }, []);
  const processRun = async (id: string) => {
    for (;;) {
      if (!alive.current || pause.current) break;
      const result = await request({ action: "advance", id });
      const updated = await refresh();
      if (result.status !== "active") {
        const run = updated.find(r => r.id === id);
        if (result.jobId && run?.batchId) await onDraft(run.batchId);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5500));
    }
  };
  const start = async (resume?: string) => {
    if (locked.current) return;
    locked.current = true; pause.current = false; setBusy(true); setError("");
    try {
      let id = resume;
      if (!id) {
        if (!quote || !confirmed) throw new Error("Review and confirm the price first.");
        const result = await request({ action: "create", id: quote.id, jobId: quote.jobId || undefined, confirmed: true, version: quote.plan.version, credits: quote.plan.credits });
        id = result.id; setQuote(null); setConfirmed(false);
      }
      await refresh(); await processRun(id!);
    } catch (e: any) { if (alive.current) setError(e.message); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const review = (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    setQuote({ id: crypto.randomUUID(), jobId, plan: cinematicPlan(job?.duration_seconds || 5) }); setConfirmed(false); setError("");
  };
  const active = runs.some(r => r.status === "active");
  return <section className="studio-panel cinematic-panel" id="cinematic">
    <div className="studio-eyebrow">REAL SCENES. YOUR MUSIC.</div>
    <h2>Cinematic AI</h2><p>Cosmic oceans, ancient Jerusalem, waterfalls and skies in motion. Start with a five-second visual test, then turn a saved draft into a sequence of changing scenes.</p>
    <p className="cinematic-connection" role="status">Runway: {connection}{credits !== null && ` · ${credits} API credits`}</p>
    {error && <p className="studio-card-error" role="alert">{error}</p>}
    <div className="cinematic-actions"><button disabled={busy || active || credits === null} onClick={() => review("")}>Preview price: 5-second test · $0.60</button>
      <label>Make a cinematic version of<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Choose a saved draft</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title} · {j.duration_seconds}s · {j.id.slice(0, 6)}</option>)}</select></label>
      <button disabled={!selected || busy || active || credits === null} onClick={() => review(selected)}>Review scenes & price</button></div>
    {!jobs.length && <p className="studio-hint">Save your song, add lyrics and create a draft above. You can generate the cinematic version before rendering the draft’s original style.</p>}
    {quote && <div className="cinematic-quote" role="region" aria-label="Generation price confirmation">
      <h3>{quote.jobId ? "Your cinematic storyboard" : "Your five-second visual test"}</h3>
      <ol>{quote.plan.scenes.map(s => <li key={s.title}>{s.title} <small>5 seconds</small></li>)}</ol>
      <p><strong>{quote.plan.credits} credits · ${(quote.plan.credits / 100).toFixed(2)} before tax</strong></p>
      <p>Gen-4.5 · vertical 720p footage, exported with lyrics at 1080p. One attempt per scene. {quote.plan.scenes.length * 5 !== quote.plan.duration && `Generates ${quote.plan.scenes.length * 5}s, trimmed to your ${quote.plan.duration}s excerpt. `}Results vary; review the test before a full project. Additional generations cost extra.</p>
      <p>{quote.jobId ? "Your song and captions are added afterward. Only the visual prompts are sent to Runway." : "This test contains visuals only, without music or lyrics."} <a href="https://docs.dev.runwayml.com/guides/pricing/" target="_blank" rel="noreferrer">Runway pricing ↗</a></p>
      <label className="studio-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> Use {quote.plan.credits} of my Runway credits for this project.</label>
      <div className="cinematic-actions"><button className="studio-primary" disabled={!confirmed || busy || credits === null || credits < quote.plan.credits} onClick={() => start()}>Generate · ${(quote.plan.credits / 100).toFixed(2)}</button><button disabled={busy} onClick={() => setQuote(null)}>Cancel</button></div>
      {credits !== null && credits < quote.plan.credits && <p>You need more API credits for this project.</p>}
    </div>}
    {busy && <p role="status">Generating and saving scenes… This may take several minutes. <button onClick={() => { pause.current = true; }}>Pause after current step</button></p>}
    <p className="studio-hint">Keep this page open to progress through the scenes. If you leave, return and tap Resume. Completed scenes are saved; resuming does not regenerate them. Editing captions later reuses the footage.</p>
    <div className="cinematic-runs">{runs.map(r => <article key={r.id}>
      <h3>{r.title}</h3><p>{r.done}/{r.plan.scenes.length} scenes saved · {r.status === "ready" ? "Footage ready" : r.status === "attention" ? "Needs attention" : "In progress"}</p>
      {r.error && <p className="studio-card-error">{r.error}</p>}
      {r.preview && <video controls playsInline preload="none" src={r.preview} aria-label={`${r.title} footage preview`} />}
      {r.status === "active" && <button disabled={busy} onClick={() => start(r.id)}>Resume project</button>}
      {r.jobId && <button disabled={busy} onClick={() => onDraft(r.batchId!).catch(e => setError(e.message))}>Open lyric-video draft</button>}
      {r.preview && <a href={r.preview} target="_blank" rel="noreferrer">Download footage ↗</a>}
      {r.status === "attention" && <a href="https://dev.runwayml.com/" target="_blank" rel="noreferrer">Check Runway task history ↗</a>}
    </article>)}</div>
    <small>Powered by Runway</small>
  </section>;
}
