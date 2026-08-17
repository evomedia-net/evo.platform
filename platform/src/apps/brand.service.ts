// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Brand identity, served to an app (#91 stage 3).
 *
 * Stage 2 put each product's identity in a `brand.json` it ships with. That
 * works, but a fleet rename is then N files, N deploys and N chances to miss
 * one. Here the record lives with the app registration, so a rename is one
 * edit — and the file each app already ships becomes its offline fallback,
 * which is the same standalone/platform split the templates use everywhere
 * else.
 *
 * **The precedence an app applies is unchanged and still ends at its own
 * code default**: operator override → platform → local file → constant. This
 * service only supplies the middle layer; nothing here can prevent an app
 * from starting when the platform is unreachable.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';

/** The wire shape. Matches brand.json field for field, deliberately. */
export interface BrandRecord {
  product: {
    name: string;
    tagline?: string;
    wordmark?: { lead: string; accent: string };
  };
  domains?: { primary?: string; docs?: string };
  email?: { support?: string; contact?: string; sender?: string };
  repo?: { feedback_issues?: string };
  legal?: { company?: string; copyright_since?: number };
}

/** Title-case a registry slug: "swag-estimates" -> "Swag Estimates". */
function titleize(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

@Injectable()
export class BrandService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * The brand for a client id, or null when the app has none configured.
   *
   * Null is the important case, not an error: it tells the SDK to leave the
   * app on its local file rather than handing it a half-empty record that
   * would blank fields the file had filled.
   */
  async forClient(clientId: string): Promise<BrandRecord | null> {
    const app = await this.prisma.app.findFirst({
      where: { clientId, deletedAt: null },
      select: { name: true, displayName: true, brand: true },
    });
    if (!app) return null;
    return this.compose(app.brand, app.name, app.displayName);
  }

  /**
   * Merge the stored record with the registry's own naming.
   *
   * `displayName` already exists and already drives email subjects and the
   * recovery pages (#103). Two fields naming the same product is precisely
   * the two-sources-of-truth problem this plan exists to remove, so the name
   * is resolved once, here: the brand record wins, then displayName, then the
   * titleized slug. An app that only ever sets displayName still gets a
   * usable brand without anyone authoring JSON.
   */
  compose(
    stored: Prisma.JsonValue | null | undefined,
    slug: string,
    displayName?: string | null,
  ): BrandRecord | null {
    const raw =
      stored && typeof stored === 'object' && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : null;

    const product =
      raw && typeof raw.product === 'object' && raw.product !== null && !Array.isArray(raw.product)
        ? (raw.product as Record<string, unknown>)
        : {};

    const name = str(product.name) ?? str(displayName) ?? titleize(slug);

    // Nothing stored and nothing but a slug to go on: the app's own file
    // knows more than we do, so say so by answering null.
    if (!raw && !str(displayName)) return null;

    const record: BrandRecord = { product: { name } };

    const tagline = str(product.tagline);
    if (tagline) record.product.tagline = tagline;

    const wordmark = product.wordmark;
    if (wordmark && typeof wordmark === 'object' && !Array.isArray(wordmark)) {
      const w = wordmark as Record<string, unknown>;
      // Not str(): the halves render in a zero-gap box, so a two-word brand
      // carries its space inside one of them ("Acme" + " EHS") and trimming
      // would join the words. Same rule the local loader follows.
      const lead = typeof w.lead === 'string' ? w.lead : '';
      const accent = typeof w.accent === 'string' ? w.accent : '';
      if (lead.trim() || accent.trim()) record.product.wordmark = { lead, accent };
    }

    for (const key of ['domains', 'email', 'repo', 'legal'] as const) {
      const section = raw?.[key];
      if (section && typeof section === 'object' && !Array.isArray(section)) {
        Object.assign(record, { [key]: section });
      }
    }
    return record;
  }

  // ---- console ----

  /** The stored record as authored, for the editor. */
  async get(appId: string): Promise<{ brand: Prisma.JsonValue | null; resolved: BrandRecord | null }> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { name: true, displayName: true, brand: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return {
      brand: app.brand ?? null,
      resolved: this.compose(app.brand, app.name, app.displayName),
    };
  }

  /**
   * Store a record. Passing null clears it, returning the app to its file.
   *
   * Validation is deliberately thin — a brand is copy, and refusing to save
   * an unusual one helps nobody. The one rule enforced is that `product` is
   * an object if present, because the reader indexes into it.
   */
  async set(appId: string, brand: unknown, actorId?: string): Promise<{ ok: true }> {
    const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } });
    if (!app) throw new NotFoundException('App not found');

    let value: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    if (brand !== null && brand !== undefined) {
      if (typeof brand !== 'object' || Array.isArray(brand)) {
        throw new BadRequestException('Brand must be a JSON object');
      }
      value = brand as Prisma.InputJsonValue;
    }

    await this.prisma.app.update({ where: { id: appId }, data: { brand: value } });
    await this.audit.record('app.brand_updated', {
      userId: actorId,
      detail: { appId, cleared: value === Prisma.JsonNull },
    });
    return { ok: true };
  }
}
