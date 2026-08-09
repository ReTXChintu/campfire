import { NextRequest, NextResponse } from "next/server";

// Deliberately does NOT import "@/auth" (or anything that touches the mongodb driver). Next.js 16
// declares proxy.ts as Node.js-runtime-only, but Netlify's current Next.js Runtime (v5.x) still
// bundles it as an Edge Function regardless — and the mongodb driver (pulled in transitively via
// @auth/mongodb-adapter, needed for this app's `session: { strategy: "database" }`) cannot run in
// an edge/non-Node bundle at all (no net/tls/dns, no native modules). Confirmed live: importing
// "@/auth" here made the Netlify build fail with "Failed to compile CJS module:
// .../mongodb/lib/index.js", and Netlify support has confirmed there's no config flag to force
// proxy.ts off the edge bundle for this adapter version.
//
// This only does a cheap cookie-presence check — enough to bounce the common case (no cookie at
// all) straight to /login without a round trip. It is NOT a substitute for real auth: every page
// and API route that actually serves content or performs an action independently calls the full,
// database-backed `auth()` (a normal Node.js function, where mongodb works fine) and enforces its
// own access control — see app/api/stream, /api/subtitle, /api/thumbnail, /api/progress, every
// /api/admin/* route, and the /admin pages. A forged or stale cookie can get past this proxy check,
// but can't stream a video, hit an admin endpoint, or do anything else that matters.
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => !!req.cookies.get(name)?.value);
}

export default function proxy(req: NextRequest) {
  const isLoggedIn = hasSessionCookie(req);
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  // api/admin/stage is excluded because Next.js buffers the entire proxied request body in memory
  // (capped at 10MB by default, see experimental.proxyClientMaxBodySize) before a matched route
  // ever sees it — that silently truncated large video uploads to 10MB. The route does its own
  // isAdminEmail check, so skipping the proxy-level redirect here doesn't weaken auth.
  matcher: ["/((?!api/auth|api/health|api/admin/stage|_next/static|_next/image|favicon.ico).*)"],
};
