/**
 * Data Access Layer for auth enforcement. The proxy only does optimistic
 * cookie-presence redirects — every server component and route handler that
 * touches data goes through here.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface SessionContext {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

/** For server components/pages: session context or redirect to /login. */
export const verifySession = cache(async (): Promise<SessionContext> => {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) redirect("/login");
  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role ?? "MEMBER",
    email: session.user.email ?? "",
  };
});

/** For route handlers: session context or a throwable 401 Response. */
export async function requireApiSession(): Promise<SessionContext> {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role ?? "MEMBER",
    email: session.user.email ?? "",
  };
}
