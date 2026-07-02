// The app's public origin for building OAuth redirect URIs. APP_BASE_URL wins
// (set it in Vercel to pin OAuth to the production domain); otherwise derive
// from the proxied request headers.
export function originFrom(req: Request): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
