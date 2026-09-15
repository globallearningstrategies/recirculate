// Shared, browser-safe studio types and validation. No server credentials here.
import { parseCues, serializeCues, validateCues } from "./lyric-cues";
export const TREATMENTS = {
  cosmic: { label: "Cosmic Dreamcore", description: "Continuous animated gates, rolling water, orbiting planets and flowing stars · no extra subscription" },
  spiritual: { label: "Spiritual journey", description: "Stars, golden light, Jerusalem silhouettes and flowing water · no AI subscription" },
  kinetic: { label: "Bold lyrics", description: "Animated type over a flowing midnight gradient" },
  visualizer: { label: "Sound waves", description: "Your music drives a luminous waveform" },
  artwork: { label: "Cover motion", description: "Slow camera movement over your artwork" },
  performance: { label: "Performance", description: "Your original footage with lyric overlays" },
} as const;
export type Treatment = keyof typeof TREATMENTS;
export type Excerpt = { start: number; duration: number; lyrics: string };
export type StudioAsset = { song_id: string; audio_path: string; audio_name: string; duration: number; artwork_path: string | null; performance_path: string | null; lyrics: string };
export type StudioJob = { id: string; batch_id: string; song_id: string; title: string; treatment: Treatment; start_seconds: number; duration_seconds: number; lyrics: string; status: "queued" | "rendering" | "ready" | "error"; error: string | null; clip_id: string | null; video_url?: string; thumb_url?: string; created_at: string; updated_at: string };
export type Preferences = { daily_reminders: boolean; weekly_summary: boolean; failure_alerts: boolean };
export const QUIET_DEFAULTS: Preferences = { daily_reminders: false, weekly_summary: false, failure_alerts: true };
export const ASSET_BUCKET = "song-assets";
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

export function validateExcerpts(value: unknown, audioDuration: number): Excerpt[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error("Choose between one and three excerpts.");
  return value.map((item) => {
    const start = Number(item?.start), duration = Number(item?.duration);
    const lyrics = typeof item?.lyrics === "string" ? item.lyrics.trim() : "";
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration < 10 || duration > 45 || start + duration > audioDuration + 0.1) throw new Error("Each excerpt must be 10–45 seconds and fit inside the audio.");
    if (!lyrics || lyrics.length > 8000) throw new Error("Add lyrics for every excerpt (up to 8,000 characters).");
    const cues = parseCues(lyrics, duration); validateCues(cues, duration);
    return { start, duration, lyrics: serializeCues(cues) };
  });
}

export function validateTreatments(value: unknown, asset: Pick<StudioAsset, "artwork_path" | "performance_path">): Treatment[] {
  if (!Array.isArray(value) || !value.length || value.length > 4 || value.some((v) => typeof v !== "string" || !Object.hasOwn(TREATMENTS, v))) throw new Error("Choose between one and four visual treatments.");
  const treatments = Array.from(new Set(value)) as Treatment[];
  if (treatments.includes("artwork") && !asset.artwork_path) throw new Error("Upload artwork for Cover motion.");
  if (treatments.includes("performance") && !asset.performance_path) throw new Error("Upload a performance video first.");
  return treatments;
}

// The current Vercel job runs once daily at 14:00 UTC. Schedule against that
// actual cadence rather than promising arbitrary minute-level publishing.
export function dailySchedule(firstDate: string, count: number, now = Date.now()): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate) || count < 1 || count > 12) throw new Error("Choose a valid first posting date.");
  const first = new Date(`${firstDate}T14:00:00.000Z`);
  if (!Number.isFinite(+first) || first.toISOString().slice(0, 10) !== firstDate || +first <= now) throw new Error("Choose a future posting date.");
  return Array.from({ length: count }, (_, i) => new Date(+first + i * 86400000).toISOString());
}
