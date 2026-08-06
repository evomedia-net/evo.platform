// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { hashPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";

export interface AuthFormState {
  error: string | null;
  /** Success message (platform signup: "check your email"). */
  notice?: string | null;
  /** When set, the UI offers a "re-send verification email" action. */
  canResend?: boolean;
  resendEmail?: string;
  resendWorkspace?: string;
}

const signupSchema = z.object({
  company: z.string().trim().min(2, "Company name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  workspace: z.string().trim().toLowerCase().optional(),
});

function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/** Standalone: create User + Tenant + OWNER Membership locally, then sign in.
 *  Platform mode: delegate to the platform's self-service signup — the
 *  workspace + first tenant admin + this app's trial are created there, and
 *  the user must click the verification email before their first login. */
export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    company: formData.get("company"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { company, email, password } = parsed.data;

  if (!rateLimit(`signup:${email}`, 5, 15 * 60_000)) {
    return { error: "Too many attempts — try again in a few minutes" };
  }

  if (isPlatformMode()) {
    try {
      const out = await getPlatform().signup({ company, email, password });
      return {
        error: null,
        notice: `Workspace "${out.tenantSlug}" created. Check your inbox for the verification link, then sign in.`,
        canResend: true,
        resendEmail: email,
        resendWorkspace: out.tenantSlug,
      };
    } catch (err) {
      // Platform messages are user-appropriate (signups closed, slug taken,
      // password policy) — pass them through.
      return { error: err instanceof Error ? err.message : "Signup failed" };
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists" };
  }

  const passwordHash = await hashPassword(password);
  const tenantId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name: email.split("@")[0] },
    });
    const tenant = await tx.tenant.create({
      data: { name: company, slug: slugify(company) },
    });
    await tx.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: "OWNER" },
    });
    return tenant.id;
  });
  await audit("auth.signup", { tenantId, detail: { email } });

  // signIn throws NEXT_REDIRECT on success — let it propagate.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: null };
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    workspace: formData.get("workspace") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (!rateLimit(`login:${parsed.data.email}`, 10, 15 * 60_000)) {
    return { error: "Too many attempts — try again in a few minutes" };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      workspace: parsed.data.workspace ?? "",
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // authorize() swallows the reason; in platform mode, probe once to
      // distinguish "email not verified" (fixable by the user) from bad
      // credentials, so the form can offer a re-send action.
      if (isPlatformMode()) {
        const workspace = parsed.data.workspace || defaultWorkspace();
        try {
          await getPlatform().login({
            tenantSlug: workspace,
            email: parsed.data.email,
            password: parsed.data.password,
          });
        } catch (probe) {
          if (probe instanceof Error && probe.message === "Email not verified") {
            return {
              error: "Email not verified — click the link we sent you, then try again.",
              canResend: true,
              resendEmail: parsed.data.email,
              resendWorkspace: workspace ?? "",
            };
          }
        }
      }
      return { error: "Invalid email or password" };
    }
    throw err; // NEXT_REDIRECT on success
  }
  return { error: null };
}

/** Re-send the verification email (platform mode). Always answers ok. */
export async function resendVerification(
  email: string,
  workspace?: string,
): Promise<{ ok: boolean }> {
  if (!isPlatformMode() || !email) return { ok: true };
  if (!rateLimit(`resend:${email}`, 3, 15 * 60_000)) return { ok: true };
  try {
    await getPlatform().sendVerificationEmail({
      tenantSlug: workspace || defaultWorkspace(),
      email,
    });
  } catch {
    // deliberate: same answer whether or not the account exists
  }
  return { ok: true };
}
