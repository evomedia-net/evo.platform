// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  defaultWorkspace,
  getPlatform,
  isPlatformMode,
  provisionFromPlatform,
} from "@/lib/platform";

/**
 * How long a session may keep a stale role before it is re-resolved from the
 * database. Bounds the window between a platform-side demotion and the app
 * noticing it; set to 0 to re-check on every call.
 */
const ROLE_REFRESH_MS = 60_000;

/**
 * Auth.js v5 config. JWT session strategy (credentials provider requires it;
 * also lets an already-issued session keep working while the user is
 * offline). The JWT carries the user's tenant context, resolved from their
 * first membership on sign-in.
 *
 * Standalone mode: local email/password. Platform mode (PLATFORM_URL set):
 * the platform owns credentials and passkeys; local rows are JIT-provisioned.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  pages: { signIn: "/login" },
  // App-specific cookie name so multiple Auth.js apps on localhost (or on
  // sibling subdomains) never fight over each other's sessions.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-evoapp.session-token"
          : "evoapp.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        workspace: { label: "Workspace", type: "text" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        if (isPlatformMode()) {
          const workspace =
            typeof credentials?.workspace === "string" && credentials.workspace.trim()
              ? credentials.workspace.trim().toLowerCase()
              : defaultWorkspace();
          try {
            const result = await getPlatform().login({ tenantSlug: workspace, email, password });
            const provisioned = await provisionFromPlatform(result);
            if (!provisioned) return null;
            const { user, tenantId } = provisioned;
            return { id: user.id, email: user.email, name: user.name, tenantId };
          } catch {
            return null; // invalid credentials / suspended tenant / platform unreachable
          }
        }

        // Standalone mode: local credentials.
        // Standalone accounts only — a platform-provisioned row has no
        // passwordHash and is identified by platformUserId, not by address.
        const user = await prisma.user.findFirst({ where: { email, platformUserId: null } });
        if (!user?.passwordHash) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    /** Passkey sign-in (platform mode only). */
    Credentials({
      id: "platform-passkey",
      credentials: {
        credential: { type: "text" },
        challengeToken: { type: "text" },
      },
      async authorize(credentials) {
        if (!isPlatformMode()) return null;
        try {
          const result = await getPlatform().passkeyLoginVerify({
            credential: JSON.parse(String(credentials?.credential ?? "")),
            challengeToken: String(credentials?.challengeToken ?? ""),
          });
          const provisioned = await provisionFromPlatform(result);
          if (!provisioned) return null;
          const { user, tenantId } = provisioned;
          return { id: user.id, email: user.email, name: user.name, tenantId };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: bind the session to the workspace that was actually
      // authenticated against. In platform mode authorize() carries it here,
      // because the user may belong to several and only one of them just
      // proved a password. Falling back to "their oldest membership" is what
      // let a sign-in to workspace B hand out a session scoped to workspace A.
      if (user?.id) {
        token.uid = user.id;
        const authenticatedTenantId = (user as { tenantId?: string }).tenantId;
        const membership = authenticatedTenantId
          ? await prisma.membership.findUnique({
              where: { userId_tenantId: { userId: user.id, tenantId: authenticatedTenantId } },
            })
          : // Standalone: a single implicit workspace, so there is nothing to
            // disambiguate and the sole membership is the right one.
            await prisma.membership.findFirst({
              where: { userId: user.id },
              orderBy: { createdAt: "asc" },
            });
        // No membership for the workspace just signed into means the session
        // has no legitimate scope — refuse rather than guess at another one.
        token.tenantId = membership?.tenantId ?? null;
        token.role = membership?.role ?? null;
        token.roleCheckedAt = Date.now();
        return token;
      }

      // Not a sign-in. Without this the role written above is frozen for the
      // full 30-day maxAge: demote someone, or remove them from the workspace
      // entirely, and their open session keeps the old access until the cookie
      // expires. Re-resolving bounds that to ROLE_REFRESH_MS instead.
      //
      // Not on every call: this callback runs on every auth() invocation, so
      // an unconditional query would add a database round-trip to each one.
      // A minute of staleness for one indexed lookup per minute per session is
      // the trade; drop it to 0 if you need immediate revocation.
      if (token.uid && token.tenantId) {
        const checkedAt = typeof token.roleCheckedAt === "number" ? token.roleCheckedAt : 0;
        if (Date.now() - checkedAt > ROLE_REFRESH_MS) {
          const membership = await prisma.membership.findUnique({
            where: {
              userId_tenantId: {
                userId: token.uid as string,
                tenantId: token.tenantId as string,
              },
            },
          });
          // Membership gone means removed from the workspace: drop the scope
          // rather than leave a session pointing at a tenant they are no
          // longer in.
          token.role = membership?.role ?? null;
          token.tenantId = membership?.tenantId ?? null;
          token.roleCheckedAt = Date.now();
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.tenantId = (token.tenantId as string | null) ?? null;
        session.user.role = (token.role as string | null) ?? null;
      }
      return session;
    },
  },
});
