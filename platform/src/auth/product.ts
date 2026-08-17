// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Who a message is from, and where it sends someone afterwards.
 *
 * A caller identifies itself with a clientId and nothing else. The display
 * name and the return URL are both read from the app registry here, never
 * taken from the request — a caller-supplied return URL would be an open
 * redirect inside a password-reset email, which is the most trusted message
 * the platform sends and therefore the worst possible place for one. This is
 * the same rule the billing redirects follow (#94), applied to recovery.
 *
 * An unknown or absent clientId falls back to the platform's own identity
 * rather than failing: recovery must keep working for a platform admin who
 * has no product, and for an app registered without callback URLs.
 */
import { PrismaService } from '../core/prisma.service';
import { config } from '../config';

export interface Product {
  /** Display name for subject lines, headings and the sender name. */
  name: string;
  /** Where "sign in" goes when the flow finishes. Always registry-owned. */
  signInUrl: string;
}

const PLATFORM: Product = {
  name: config.brand.platformName,
  signInUrl: `${config.publicBaseUrl}/`,
};

/**
 * The product name inside a stored brand record, if it has one.
 *
 * Read defensively rather than through a type: the column is operator-authored
 * JSON, so every level of it can be missing or the wrong shape, and an email
 * must still go out.
 */
function brandName(brand: unknown): string {
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) return '';
  const product = (brand as Record<string, unknown>).product;
  if (!product || typeof product !== 'object' || Array.isArray(product)) return '';
  const name = (product as Record<string, unknown>).name;
  return typeof name === 'string' ? name.trim() : '';
}

/** Title-case a registry slug: "swag-estimates" -> "Swag Estimates". */
function titleize(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function resolveProduct(
  prisma: PrismaService,
  clientId?: string | null,
): Promise<Product> {
  if (!clientId) return PLATFORM;
  const app = await prisma.app.findFirst({
    where: { clientId, deletedAt: null },
    select: { name: true, displayName: true, callbackUrls: true, brand: true },
  });
  if (!app) return PLATFORM;

  // Order matters, and it is the same order the brand service composes with
  // (#91 stage 3). Once an app can carry a brand record, that record and
  // displayName both name the product — so the name is resolved in one place
  // or an email subject drifts from what the app's own header renders.
  //
  // displayName is what a customer should read ("SWAG Estimates"); name is the
  // registry slug. Falling back to a titleized slug beats showing "swag-estimates"
  // to someone deciding whether this email is genuine.
  const name = brandName(app.brand) || app.displayName?.trim() || titleize(app.name);
  const url = app.callbackUrls.find((u) => /^https?:\/\//i.test(u));
  return { name, signInUrl: url ?? PLATFORM.signInUrl };
}
