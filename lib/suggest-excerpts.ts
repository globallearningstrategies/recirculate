// Browser-only energy suggestions. These are audition candidates, not a claim
// to identify the best chorus or lyric. No external AI service is called.
export function energyExcerpts(samples: Float32Array, sampleRate: number, count = 3, duration = 20): number[] {
  const total = samples.length / sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || total < duration) return [0];
  const hop = Math.max(1, Math.floor(sampleRate));
  const energy: number[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    let sum = 0, n = 0;
    for (let i = start; i < Math.min(samples.length, start + hop); i += 100) { sum += samples[i] ** 2; n++; }
    energy.push(n ? sum / n : 0);
  }
  const candidates = Array.from({ length: Math.max(1, Math.floor(total - duration) + 1) }, (_, start) => ({ start, score: energy.slice(start, start + duration).reduce((a, b) => a + b, 0) }));
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: number[] = [];
  for (const candidate of candidates) {
    if (chosen.every((start) => Math.abs(start - candidate.start) >= duration)) chosen.push(candidate.start);
    if (chosen.length >= count) break;
  }
  return chosen.sort((a, b) => a - b);
}
