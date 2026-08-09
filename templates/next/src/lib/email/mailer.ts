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
