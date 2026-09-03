// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { hashPassword, newPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";
import { appBaseUrl, passwordResetEmail, sendMail } from "@/lib/email/mailer";
import { consumeToken, createToken, RESET_TTL_MS } from "@/lib/auth/tokens";
import { PRODUCT_NAME } from "@/lib/product";

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
  // NIST/OWASP Standard — same policy in platform mode, enforced server-side
  // by the platform's DTOs; this keeps the standalone path identical.
  password: newPassword(),
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

  const existing = await prisma.user.findFirst({ where: { email, platformUserId: null } });
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

/**
 * Ask for a password reset link.
 *
 * Always answers the same way whether or not the address has an account —
 * a different response for a known address turns this form into a way to
 * enumerate your users.
 *
 * The two modes are genuinely different flows, not one flow with a flag:
 * in platform mode the platform owns the password, so it mints the token,
 * sends the mail and hosts the page that completes the reset; this app never
 * sees any of it. Standalone runs the whole thing locally.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!z.string().email().safeParse(email).success) {
    return { error: "Enter a valid email address" };
  }

  if (!rateLimit(`pwreset:${email}`, 3, 15 * 60_000)) {
    return { error: "Too many reset requests — try again in a few minutes" };
  }

  if (isPlatformMode()) {
    // The workspace is required for the lookup: without it the platform
    // searches platform-level accounts only, and tenant users — which is
    // everyone using this app — silently never get mail.
    const workspace =
      String(formData.get("workspace") ?? "")
        .trim()
        .toLowerCase() || defaultWorkspace();
    try {
      await getPlatform().forgotPassword({ tenantSlug: workspace, email });
    } catch {
      // The platform answers ok whether or not the account exists, so a
      // failure here is transport, not "no such user" — saying so leaks
      // nothing and is more useful than a false confirmation.
      return { error: "Couldn't reach the sign-in service — try again in a few minutes" };
    }
    return { error: null };
  }

  const user = await prisma.user.findFirst({ where: { email, platformUserId: null } });
  if (user) {
    const raw = await createToken("reset", email, RESET_TTL_MS);
    // In the fragment, not the query string: a browser never sends the part
    // after # to the server, so the single-use token reaches no access log,
    // proxy log or Referer header on its way to the page (#163).
    const link = `${appBaseUrl()}/reset-password#email=${encodeURIComponent(email)}&token=${raw}`;
    await sendMail(passwordResetEmail(email, link));
  }
  // Success is signalled by error:null; the page shows the same confirmation
  // either way.
  return { error: null };
}

const resetSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    token: z.string().min(10),
    // Same NIST/OWASP Standard as signup — the policy's own rule is
    // "validate on every set/change path".
    password: newPassword(),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

/** Complete a reset using an emailed token. Standalone only. */
export async function resetPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, token, password } = parsed.data;

  if (isPlatformMode()) {
    // Platform mode never mints local reset links, so nothing legitimate
    // arrives here — the platform's own hosted page completes those resets.
    return { error: "This link is no longer valid — request a new reset link" };
  }

  if (!(await consumeToken("reset", email, token))) {
    return { error: "This link is invalid or has expired — request a new one" };
  }

  const passwordHash = await hashPassword(password);
  const updated = await prisma.user.updateMany({
    where: { email, platformUserId: null },
    data: { passwordHash },
  });
  if (updated.count === 0) return { error: "Account not found" };
  await audit("auth.password_reset", { detail: { email } });

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (err) {
    if (err instanceof AuthError) {
      // The password IS already changed here. A failed auto-sign-in must
      // render as a message on the form, never as a 500 on a reset that
      // actually succeeded — that combination makes people reset twice.
      return {
        error:
          "Your password was updated, but automatic sign-in failed — sign in with your new password.",
      };
    }
    throw err; // NEXT_REDIRECT on success
  }
  return { error: null };
}

/**
 * "Which workspace am I in?" — platform mode only.
 *
 * The platform owns the answer. This app only knows the workspaces someone
 * has already signed into *here*, which omits exactly the one they have
 * forgotten. The reply goes by email and never in the response, so the
 * mapping from an address to its workspaces isn't readable by whoever typed
 * the address.
 */
export async function requestWorkspaceList(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!z.string().email().safeParse(email).success) {
    return { error: "Enter a valid email address" };
  }

  if (!rateLimit(`workspaces:${email}`, 3, 15 * 60_000)) {
    return { error: "Too many requests — try again in a few minutes" };
  }
  if (!isPlatformMode()) {
    // Standalone has one implicit workspace, so there is nothing to look up.
    // Saying so beats a confirmation for mail that will never arrive.
    return { error: "This deployment has a single workspace — leave it blank when signing in" };
  }
  try {
    // No product name or URL: the platform resolves both from the app
    // registry using the SDK's configured client id. A caller-supplied pair
    // let anyone put their own sender name and link into platform mail.
    await getPlatform().forgotWorkspace({ email });
  } catch {
    return { error: "Couldn't reach the sign-in service — try again in a few minutes" };
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
