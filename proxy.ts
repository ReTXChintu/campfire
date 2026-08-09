import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
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
});

export const config = {
  // api/admin/stage is excluded because Next.js buffers the entire proxied request body in memory
  // (capped at 10MB by default, see experimental.proxyClientMaxBodySize) before a matched route
  // ever sees it — that silently truncated large video uploads to 10MB. The route does its own
  // isAdminEmail check, so skipping the proxy-level redirect here doesn't weaken auth.
  matcher: ["/((?!api/auth|api/health|api/admin/stage|_next/static|_next/image|favicon.ico).*)"],
};
