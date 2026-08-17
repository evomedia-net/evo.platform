// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Transactional email. Platform mode: sent through the platform service
 * (tenant SMTP → platform default → its fallback). Standalone: local SMTP_*
 * env; when unset, sending is a logged no-op so dev machines work without
 * credentials.
 */
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getPlatform, isPlatformMode } from "@/lib/platform";
import { PRODUCT_NAME } from "@/lib/product";

let transport: Transporter | null | undefined;

export function isEmailEnabled(): boolean {
  if (isPlatformMode()) return true;
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  if (!isEmailEnabled()) {
    transport = null;
    return transport;
  }
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Send a mail. Returns false (and logs) when email is not configured. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (isPlatformMode()) {
    try {
      await getPlatform().sendEmail({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return true;
    } catch (err) {
      console.error("[mailer] platform send failed", err);
      return false;
    }
  }

  const t = getTransport();
  if (!t) {
    console.warn(`[mailer] SMTP not configured — would have sent "${mail.subject}" to ${mail.to}`);
    return false;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
    ...mail,
  });
  return true;
}

/** Base URL for links in emails. */
export function appBaseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, "") ?? "http://localhost:4180";
}

/**
 * The shell around a transactional message.
 *
 * Table-based with inline styles on purpose: mail clients are not browsers.
 * Outlook ignores most of flexbox and grid, Gmail strips <style> blocks in
 * some contexts, and a <div> styled as a button collapses in several. This is
 * the layout that survives all of them — the same reasoning as the platform's
 * own email shell.
 */
function wrap(inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${PRODUCT_NAME}</title></head>
<body style="margin:0;padding:0;background:#f4f7fb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7fb">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;background:#ffffff;border:1px solid #dbe3ec;border-radius:12px">
      <tr><td style="padding:22px 28px 0;font-family:Helvetica,Arial,sans-serif">
        <span style="font-size:17px;font-weight:700;color:#2563eb">${PRODUCT_NAME}</span>
      </td></tr>
      <tr><td style="padding:20px 28px 26px;font-family:Helvetica,Arial,sans-serif;color:#14304a">
        ${inner}
      </td></tr>
      <tr><td style="padding:0 28px 22px;font-family:Helvetica,Arial,sans-serif">
        <hr style="border:0;border-top:1px solid #dbe3ec;margin:0 0 14px"/>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#5b6b7d">
          Sent by ${PRODUCT_NAME}. This is an automated message about your
          account — you cannot reply to it.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Password reset link (standalone mode only — in platform mode the platform
 * sends this itself, from its own templates, to its own hosted page).
 *
 * The URL is repeated as text below the button because every client that
 * blocks or mangles the button still has to leave the destination reachable.
 */
export function passwordResetEmail(to: string, link: string): Mail {
  return {
    to,
    subject: `Reset your ${PRODUCT_NAME} password`,
    text:
      `${PRODUCT_NAME}\n\nSomeone asked to reset the password for ${to}.\n\n` +
      `Reset your password: ${link}\n\n` +
      `This link expires in 1 hour and can be used once. If you didn't ask ` +
      `for it, you can ignore this email — nothing has changed.\n`,
    html: wrap(`
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3">Reset your password</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55">
        Someone (hopefully you) asked to reset the password for
        <strong>${to}</strong>.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0">
        <tr><td align="center" bgcolor="#2563eb" style="border-radius:8px">
          <a href="${link}" style="display:inline-block;padding:12px 26px;font-size:15px;
             font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Reset password</a>
        </td></tr>
      </table>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#5b6b7d;word-break:break-all">
        If the button does not work, paste this into your browser:<br/>
        <span style="color:#5b6b7d">${link}</span>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#5b6b7d">
        This link expires in 1 hour and can be used once. If you didn't ask for
        it, you can ignore this email — nothing has changed.
      </p>`),
  };
}
