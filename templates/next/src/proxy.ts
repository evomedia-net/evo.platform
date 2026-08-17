// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Next 16 proxy (successor to middleware). Optimistic auth UX only:
 * cookie-presence redirects. Deliberately imports nothing from next-auth —
 * real enforcement lives in the DAL (src/lib/auth/dal.ts) and in each
 * route handler.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["evoapp.session-token", "__Secure-evoapp.session-token"];

/**
 * Reachable without a session. Account recovery belongs here for the obvious
 * reason: everyone who needs it is by definition signed out, and a recovery
 * page behind the sign-in redirect is a page nobody can ever reach.
 */
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/forgot-workspace",
  "/reset-password",
];

/**
 * Public pages that a signed-in user is still allowed to open.
 *
 * Bouncing them to "/" also strips the query string, which would swallow the
 * token on a reset link — and a stale session cookie is common in exactly the
 * situation that produced the reset request. Completing the reset has to win
 * over the tidiness of redirecting a signed-in user away from an auth page.
 */
const PUBLIC_WITH_SESSION = ["/reset-password"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const keepsSession = PUBLIC_WITH_SESSION.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (hasSession && isPublic && !keepsSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except API routes (they enforce auth themselves and must
  // return 401 JSON, not a redirect), Next internals, and static assets.
  matcher: ["/((?!api|_next|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
