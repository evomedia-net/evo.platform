// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * EvoPlatform integration. When PLATFORM_URL is set the app runs in
 * "platform mode": logins are delegated to the platform service (password or
 * passkey) and local Tenant/User/Membership rows are JIT-provisioned from the
 * verified claims so every downstream tenant-scoped query and the Auth.js
 * session machinery keep working unchanged. Without PLATFORM_URL the app is
 * fully standalone (local credentials, local SMTP, works offline).
 */
import "server-only";
import { EvoPlatform, type LoginResult } from "@evoplatform/sdk-node";
import { prisma } from "@/lib/prisma";

export function isPlatformMode(): boolean {
  return Boolean(process.env.PLATFORM_URL);
}

let client: EvoPlatform | null | undefined;

export function getPlatform(): EvoPlatform {
  if (client === undefined) {
    client = process.env.PLATFORM_URL
      ? new EvoPlatform({
          platformUrl: process.env.PLATFORM_URL,
          clientId: process.env.EVO_CLIENT_ID,
          clientSecret: process.env.EVO_CLIENT_SECRET,
        })
      : null;
  }
  if (!client) throw new Error("PLATFORM_URL is not configured");
  return client;
}

/** Workspace slug used when the login form leaves the field blank. */
export function defaultWorkspace(): string | undefined {
  return process.env.PLATFORM_DEFAULT_WORKSPACE || undefined;
}

/**
 * JIT-provision local rows from a platform login. The platform owns identity
 * (passwords, passkeys, tenant lifecycle); the local rows exist so domain
 * data can reference them. Claims are taken from the verified access token,
 * not the response body. Returns null for logins without a workspace (e.g.
 * platform global admins) — this app is strictly tenant-scoped.
 */
export async function provisionFromPlatform(result: LoginResult) {
  const claims = await getPlatform().verifyToken(result.accessToken);
  if (!claims.tenant_slug || !result.user.tenant) return null;

  const tenant = await prisma.tenant.upsert({
    where: { slug: claims.tenant_slug },
    update: { name: result.user.tenant.name },
    create: { slug: claims.tenant_slug, name: result.user.tenant.name },
  });

  const email = claims.email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: result.user.name ?? undefined },
    // No passwordHash: in platform mode the platform owns the password.
    create: { email, name: result.user.name },
  });

  const existing = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!existing) {
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: claims.roles.includes("admin") ? "ADMIN" : "MEMBER",
      },
    });
  }
  // An existing membership keeps its local role (never downgrade an OWNER).
  return user;
}
