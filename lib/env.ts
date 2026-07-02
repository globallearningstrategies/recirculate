// OAuth credentials pasted into Vercel sometimes arrive with a stray newline
// or space (copy buttons love doing this), which providers reject with cryptic
// errors. Always read credentials through this trim.
export function cred(name: string): string {
  return (process.env[name] ?? "").trim();
}
