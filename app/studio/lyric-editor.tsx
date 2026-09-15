"use client";
import { useMemo, useRef, useState } from "react";
import { parseCues, serializeCues, validateCues, type Line } from "@/lib/lyric-cues";

export default function LyricEditor({ value, onChange, duration, src, offset = 0, disabled = false }: { value: string; onChange: (s: string) => void; duration: number; src?: string; offset?: number; disabled?: boolean }) {
  const cues = useMemo(() => parseCues(value, duration), [value, duration]);
  const player = useRef<HTMLAudioElement>(null), stopAt = useRef<number | null>(null);
  const [playhead, setPlayhead] = useState(0), [pasted, setPasted] = useState(""), [notice, setNotice] = useState("");
  let problem = ""; try { if (cues.length) validateCues(cues, duration); } catch (e: any) { problem = e.message; }
  const update = (i: number, change: Partial<Line>) => onChange(serializeCues(cues.map((c, j) => j === i ? { ...c, ...change } : c)));
  const listen = (cue: Line) => {
    if (!player.current) return;
    player.current.currentTime = offset + cue.start; stopAt.current = cue.end;
    setPlayhead(cue.start); player.current.play().catch(() => setNotice("Tap the audio player to start listening."));
  };
  const active = cues.find(c => c.start <= playhead && c.end > playhead);
  return <div className="phrase-editor">
    <h3>One phrase at a time</h3>
    <p>Each card appears, then disappears at its end time. Type Hebrew or English directly. Listen and use “Set start here” and “Set end here” to match the singing.</p>
    {src && <audio ref={player} src={src} controls preload="metadata" onPlay={() => { if (player.current && player.current.currentTime < offset) player.current.currentTime = offset; }} onTimeUpdate={e => {
      const at = e.currentTarget.currentTime - offset; setPlayhead(Math.max(0, at));
      if (at >= (stopAt.current ?? duration)) { e.currentTarget.pause(); stopAt.current = null; }
    }} />}
    <div className="phrase-preview" aria-label="Caption preview" dir="auto">{active?.text || <span>No lyric at this moment</span>}</div>
    <div className="phrase-clock">{playhead.toFixed(2)} / {duration.toFixed(2)} seconds</div>
    {!value.includes(" --> ") && cues.length > 0 && <p className="studio-hint">These older or pasted lyrics have estimated phrase timing. Listen and adjust before rendering.</p>}
    {notice && <p role="status">{notice}</p>}{problem && <p role="alert">{problem}</p>}
    {cues.map((cue, i) => <fieldset key={i} className={`phrase-card ${active === cue ? "active" : ""}`} disabled={disabled}>
      <legend>Phrase {i + 1}</legend>
      <textarea aria-label={`Phrase ${i + 1} text`} dir="auto" rows={2} value={cue.text} onChange={e => update(i, { text: e.target.value })} />
      <div className="phrase-times"><label>Appears<input aria-label={`Phrase ${i + 1} start`} type="number" min={0} max={duration} step="0.05" value={Number(cue.start.toFixed(3))} onChange={e => update(i, { start: Number(e.target.value) })} /></label><label>Disappears<input aria-label={`Phrase ${i + 1} end`} type="number" min={0} max={duration} step="0.05" value={Number(cue.end.toFixed(3))} onChange={e => update(i, { end: Number(e.target.value) })} /></label></div>
      <div className="phrase-tools"><button disabled={!src} onClick={() => listen(cue)}>▶ Listen</button><button disabled={!src} onClick={() => update(i, { start: Math.min(playhead, duration) })}>Set start here</button><button disabled={!src} onClick={() => update(i, { end: Math.min(playhead, duration) })}>Set end here</button><button disabled={cue.text.trim().split(/\s+/).length < 2} onClick={() => {
        const words = cue.text.trim().split(/\s+/), mid = Math.ceil(words.length / 2), at = cue.start + (cue.end - cue.start) * mid / words.length;
        onChange(serializeCues([...cues.slice(0, i), { ...cue, text: words.slice(0, mid).join(" "), end: at }, { ...cue, text: words.slice(mid).join(" "), start: at }, ...cues.slice(i + 1)]));
      }}>Split phrase</button><button onClick={() => onChange(serializeCues(cues.filter((_, j) => j !== i)))}>Remove</button></div>
    </fieldset>)}
    <button disabled={disabled || cues.length >= 100 || (cues.at(-1)?.end || 0) >= duration} onClick={() => {
      const start = cues.at(-1)?.end || 0;
      onChange(serializeCues([...cues, { text: "Your next lyric", start, end: Math.min(duration, start + 2) }]));
    }}>+ Add phrase</button>
    <details><summary>Paste lyrics to create phrase cards</summary><textarea aria-label="Paste lyrics" dir="auto" rows={4} value={pasted} onChange={e => setPasted(e.target.value)} placeholder="Paste English or Hebrew lyrics here…" /><button disabled={disabled || !pasted.trim()} onClick={() => { onChange(serializeCues(parseCues(pasted, duration))); setNotice("Phrase cards created with estimated timing. Listen and adjust their start and end times."); }}>Replace cards with pasted lyrics</button></details>
  </div>;
}
