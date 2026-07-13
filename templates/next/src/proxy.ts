/**
 * Next 16 proxy (successor to middleware). Optimistic auth UX only:
 * cookie-presence redirects. Deliberately imports nothing from next-auth —
 * real enforcement lives in the DAL (src/lib/auth/dal.ts) and in each
 * route handler.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["evoapp.session-token", "__Secure-evoapp.session-token"];
const PUBLIC_PATHS = ["/login", "/signup"];

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
  if (hasSession && isPublic) {
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
