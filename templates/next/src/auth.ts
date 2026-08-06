// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
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
            const user = await provisionFromPlatform(result);
            return user ? { id: user.id, email: user.email, name: user.name } : null;
          } catch {
            return null; // invalid credentials / suspended tenant / platform unreachable
          }
        }

        // Standalone mode: local credentials.
        const user = await prisma.user.findUnique({ where: { email } });
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
          const user = await provisionFromPlatform(result);
          return user ? { id: user.id, email: user.email, name: user.name } : null;
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: resolve tenant context from the user's membership.
      if (user?.id) {
        token.uid = user.id;
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
        });
        token.tenantId = membership?.tenantId ?? null;
        token.role = membership?.role ?? null;
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
