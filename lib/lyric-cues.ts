export type Line = { text: string; start: number; end: number };
export function phraseParts(text: string): string[] {
  const parts: string[] = []; let current = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (current && (current.length + word.length > 42 || current.split(" ").length >= 7)) { parts.push(current); current = ""; }
    current += (current ? " " : "") + word;
    if (/[.!?;,׃]$/.test(word)) { parts.push(current); current = ""; }
  }
  if (current) parts.push(current);
  return parts;
}
const stamp = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, "0")}`;
export const serializeCues = (cues: Line[]) => cues.map(c => `[${stamp(c.start)} --> ${stamp(c.end)}] ${c.text.replace(/\n/g, " ")}`).join("\n");
export function parseCues(raw: string, duration: number): Line[] {
  const explicit = /^\[(\d+):(\d+(?:\.\d+)?) --> (\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/;
  const rows = raw.trim().split("\n").filter(Boolean);
  if (rows.length && rows.every(r => explicit.test(r))) return rows.map(r => {
    const m = r.match(explicit)!;
    return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]), text: m[5] };
  });
  // Old transcripts have only segment start times. Split them into editable
  // phrases using estimated timing; the editor lets the owner correct by ear.
  return parseLegacy(raw, duration).flatMap(line => {
    const parts = phraseParts(line.text), count = parts.reduce((n, p) => n + p.length, 0); let at = line.start;
    return parts.map(text => {
      const end = at + (line.end - line.start) * text.length / Math.max(1, count);
      const cue = { text, start: at, end: Math.max(at + .01, end - .08) }; at = end; return cue;
    });
  });
}
export function validateCues(cues: Line[], duration: number) {
  if (!cues.length || cues.length > 100) throw new Error("Add between 1 and 100 lyric phrases.");
  let end = 0;
  for (const cue of cues) {
    if (!cue.text.trim() || cue.text.length > 64) throw new Error("Keep each phrase under 65 characters; use Split phrase for longer sentences.");
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < end - .002 || cue.end <= cue.start || cue.end > duration + .001) throw new Error("Phrase times must be in order, inside the excerpt, and not overlap.");
    end = cue.end;
  }
}
export function wordCues(words: { word: string; start: number; end: number }[], duration: number): Line[] {
  const cues: Line[] = []; let cue: Line | undefined;
  for (const word of words) {
    const text = String(word.word || "").trim();
    if (!text || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start || word.start >= duration) continue;
    if (cue && (word.start - cue.end > .5 || cue.text.length + text.length > 42 || cue.text.split(" ").length >= 7 || /[.!?;,׃]$/.test(cue.text))) { cues.push(cue); cue = undefined; }
    if (!cue) cue = { text, start: Math.max(0, word.start, cues.at(-1)?.end || 0), end: Math.min(duration, word.end) };
    else { cue.text += " " + text; cue.end = Math.min(duration, Math.max(cue.end, word.end)); }
  }
  if (cue) cues.push(cue);
  return cues;
}
function parseLegacy(raw: string, duration: number): Line[] {
  const rows = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (rows.length === 0) return [];

  // Parse rows into {at, text}. A stamp-only row ("[0:12]") carries its time
  // forward to the next unstamped line instead of becoming a phantom entry.
  const items: { at: number | null; text: string }[] = [];
  let carryAt: number | null = null;
  for (const r of rows) {
    const m = r.match(/^\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    const at = m ? Number(m[1]) * 60 + Number(m[2]) : null;
    const text = m ? m[3].trim() : r;
    if (!text) {
      if (at != null) carryAt = at;
      continue;
    }
    items.push({ at: at ?? carryAt, text });
    carryAt = null;
  }
  if (items.length === 0) return [];

  // Walk runs of lines between stamps: each run splits its interval evenly.
  // With no stamps at all, the whole lyric is one run across the duration.
  const lines: Line[] = [];
  let i = 0;
  while (i < items.length) {
    const segStart = Math.min(items[i].at ?? (lines.length ? lines[lines.length - 1].end : 0), duration);
    let j = i + 1;
    while (j < items.length && items[j].at == null) j++;
    const segEnd = Math.min(j < items.length ? Math.max(items[j].at!, segStart) : duration, duration);
    const slot = (segEnd - segStart) / (j - i);
    for (let k = i; k < j; k++) {
      lines.push({
        text: items[k].text,
        start: segStart + (k - i) * slot,
        end: k === j - 1 ? segEnd : segStart + (k - i + 1) * slot,
      });
    }
    i = j;
  }
  return lines.filter((l) => l.end > l.start);
}

