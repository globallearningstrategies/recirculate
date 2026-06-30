import { NextResponse, type NextRequest } from "next/server";

// Lightweight, Edge-safe auth gate.
//
// We deliberately do NOT import the Supabase client here: bundling
// @supabase/ssr (and its supabase-js chain) into the Vercel Edge runtime drags
// in Node-only code that references `__dirname` and crashes the middleware.
// Instead this does a fast presence check on the Supabase auth cookie and
// redirects unauthenticated visitors to /login. Real validation — confirming
// the session is valid AND belongs to the owner — happens server-side in
// app/page.tsx (and the route handlers), and token refresh is handled by the
// browser client. So this is purely a UX redirect, not the security boundary.
function hasSupabaseSession(request: NextRequest): boolean {
  // @supabase/ssr stores the session in cookie(s) named sb-<ref>-auth-token
  // (sometimes chunked with .0/.1 suffixes).
  return request.cookies.getAll().some(
    (c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && !!c.value
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const signedIn = hasSupabaseSession(request);

  if (!signedIn && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets (incl. PWA files).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-192.png|icon-512.png|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
