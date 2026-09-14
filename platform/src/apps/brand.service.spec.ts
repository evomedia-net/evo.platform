// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BrandService } from './brand.service';
import { resolveProduct } from '../auth/product';

const svc = () => new BrandService({} as never, {} as never);

describe('BrandService.compose', () => {
  it('serves a stored record as authored', () => {
    const out = svc().compose(
      {
        product: { name: 'evo.ehs', tagline: 'Unified.', wordmark: { lead: 'evo.', accent: 'ehs' } },
        legal: { company: 'Evomedia.net LLC', copyright_since: 2024 },
      },
      'evo-ehs',
      'evo.ehs',
    );
    expect(out).toEqual({
      product: { name: 'evo.ehs', tagline: 'Unified.', wordmark: { lead: 'evo.', accent: 'ehs' } },
      legal: { company: 'Evomedia.net LLC', copyright_since: 2024 },
    });
  });

  // The whole point of serving this centrally: an app with no record still
  // gets a usable brand from the registry naming it already has.
  it('falls back to displayName when no record is stored', () => {
    expect(svc().compose(null, 'provensheet', 'ProvenSheet')?.product.name).toBe('ProvenSheet');
  });

  it('prefers the record over displayName, so the two cannot drift', () => {
    const out = svc().compose({ product: { name: 'Renamed' } }, 'provensheet', 'ProvenSheet');
    expect(out?.product.name).toBe('Renamed');
  });

  it('titleizes the slug rather than serving it raw', () => {
    const out = svc().compose({ product: {} }, 'acme-widgets', null);
    expect(out?.product.name).toBe('Acme Widgets');
  });

  // Null tells the SDK to stay on the local file. Answering a bare titleized
  // slug instead would overwrite a good local name with a worse one.
  it('answers null when the platform knows nothing the app does not', () => {
    expect(svc().compose(null, 'evo-ehs', null)).toBeNull();
    expect(svc().compose(null, 'evo-ehs', '   ')).toBeNull();
  });

  it('keeps whitespace inside a wordmark half', () => {
    const out = svc().compose(
      { product: { name: 'Acme EHS', wordmark: { lead: 'Acme', accent: ' EHS' } } },
      'acme',
      null,
    );
    expect(out?.product.wordmark).toEqual({ lead: 'Acme', accent: ' EHS' });
  });

  it('drops a wordmark that carries no word', () => {
    const out = svc().compose(
      { product: { name: 'Acme', wordmark: { lead: '  ', accent: '' } } },
      'acme',
      null,
    );
    expect(out?.product.wordmark).toBeUndefined();
  });

  // The column is operator-authored JSON, so every level can be the wrong
  // shape. None of it may throw on the path that renders someone's header.
  it.each([
    ['a JSON array', ['nope']],
    ['a JSON string', 'nope'],
    ['a number', 42],
    ['a product of the wrong type', { product: 'nope' }],
    ['a wordmark of the wrong type', { product: { name: 'X' }, wordmark: 7 }],
  ])('survives %s', (_label, stored) => {
    expect(() => svc().compose(stored as never, 'evo-ehs', 'evo.ehs')).not.toThrow();
  });

  it('ignores a section that is not an object', () => {
    const out = svc().compose({ product: { name: 'X' }, legal: 'nope' }, 'x', null);
    expect(out).toEqual({ product: { name: 'X' } });
  });

  it('omits sections the record does not mention, rather than blanking them', () => {
    const out = svc().compose({ product: { name: 'X' } }, 'x', null);
    expect(out).not.toHaveProperty('domains');
    expect(out).not.toHaveProperty('email');
  });
});

// #103 made displayName the name on password-reset email. Once a brand record
// can also name the product, an email subject could say one thing while the
// app's own header says another. Both must resolve the same way.
describe('resolveProduct agrees with the brand record', () => {
  const prismaWith = (app: Record<string, unknown>) =>
    ({ app: { findFirst: jest.fn().mockResolvedValue(app) } }) as never;

  it('names the product from the brand record when there is one', async () => {
    const p = await resolveProduct(
      prismaWith({
        name: 'evo-ehs',
        displayName: 'Old Name',
        callbackUrls: ['https://evoehs.com'],
        brand: { product: { name: 'evo.ehs' } },
      }),
      'app_1',
    );
    expect(p.name).toBe('evo.ehs');
  });

  it('still uses displayName when no record is stored', async () => {
    const p = await resolveProduct(
      prismaWith({
        name: 'evo-ehs',
        displayName: 'evo.ehs',
        callbackUrls: [],
        brand: null,
      }),
      'app_1',
    );
    expect(p.name).toBe('evo.ehs');
  });

  it('does not let malformed brand JSON break a password-reset email', async () => {
    const p = await resolveProduct(
      prismaWith({
        name: 'evo-ehs',
        displayName: 'evo.ehs',
        callbackUrls: [],
        brand: ['garbage'],
      }),
      'app_1',
    );
    expect(p.name).toBe('evo.ehs');
  });
});

// ── The database-facing half: forClient, get, set ───────────────────────────
//
// compose() above is pure; these three touch prisma and the audit log, and
// they carry the two behaviours the SDK depends on: null for "use your local
// file" (never a half-empty record), and clear-by-null in the console.

describe('BrandService against the registry', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const appRow = { name: 'provensheet', displayName: 'ProvenSheet', brand: null };
  const makePrisma = (row: unknown = appRow) => ({
    app: {
      findFirst: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({}),
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = (prisma: any) => new BrandService(prisma, audit as any);

  beforeEach(() => jest.clearAllMocks());

  it('forClient answers null for an unknown or deleted client id', async () => {
    const prisma = makePrisma(null);
    expect(await make(prisma).forClient('app_gone')).toBeNull();
    expect(prisma.app.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'app_gone', deletedAt: null } }),
    );
  });

  it('forClient composes from the registry row', async () => {
    const out = await make(makePrisma()).forClient('app_1');
    expect(out).toEqual({ product: { name: 'ProvenSheet' } });
  });

  it('get 404s on an unknown app and returns record + resolved otherwise', async () => {
    await expect(make(makePrisma(null)).get('nope')).rejects.toThrow('App not found');
    const out = await make(makePrisma()).get('a1');
    expect(out.brand).toBeNull();
    expect(out.resolved).toEqual({ product: { name: 'ProvenSheet' } });
  });

  it('set stores an object record and audits who did it', async () => {
    const prisma = makePrisma({ id: 'a1' });
    await make(prisma).set('a1', { product: { name: 'N' } }, 'u7');
    expect(prisma.app.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { brand: { product: { name: 'N' } } } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      'app.brand_updated',
      expect.objectContaining({ userId: 'u7', detail: expect.objectContaining({ cleared: false }) }),
    );
  });

  it('set with null clears the record back to the app’s local file', async () => {
    const prisma = makePrisma({ id: 'a1' });
    await make(prisma).set('a1', null);
    const evt = audit.record.mock.calls[0][1] as { detail: { cleared: boolean } };
    expect(evt.detail.cleared).toBe(true);
  });

  it('set refuses a non-object record — the reader indexes into product', async () => {
    const prisma = makePrisma({ id: 'a1' });
    await expect(make(prisma).set('a1', ['not', 'an', 'object'])).rejects.toThrow('JSON object');
    await expect(make(prisma).set('a1', 'nope')).rejects.toThrow('JSON object');
    expect(prisma.app.update).not.toHaveBeenCalled();
  });

  it('set 404s on an unknown app', async () => {
    await expect(make(makePrisma(null)).set('nope', {})).rejects.toThrow('App not found');
  });
});
