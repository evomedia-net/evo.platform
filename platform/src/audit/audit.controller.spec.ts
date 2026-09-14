// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Pure-delegation controllers: each test pins that a route reaches the right
// service method with the right arguments. The one that matters most here is
// that an app-pushed event goes through recordFromApp, which enforces the
// tenant relationship, and never through the trusting record() path (#154).

import { AuditController, EventsController } from './audit.controller';

const audit = {
  record: jest.fn().mockResolvedValue({ id: 'ev' }),
  recordFromApp: jest.fn().mockResolvedValue({ id: 'ev' }),
  list: jest.fn().mockResolvedValue([]),
};

beforeEach(() => jest.clearAllMocks());

describe('EventsController', () => {
  it('routes an app-pushed event through the gated path with the calling app', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = new EventsController(audit as any);
    const clientApp = { id: 'app-row-1', clientId: 'app_provensheet', name: 'provensheet' };
    const dto = { action: 'estimate.created', tenantId: 't1', userId: 'u1', detail: { n: 1 } };
    await ctrl.push(dto, { clientApp } as never);
    expect(audit.recordFromApp).toHaveBeenCalledWith(clientApp, dto);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AuditController.list', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrl = new AuditController(audit as any);

  it('passes filters through and treats a date-only "to" as the end of that day', async () => {
    await ctrl.list('t1', 'auth.login', '2026-07-01', '2026-07-31', '50');
    const args = audit.list.mock.calls[0][0];
    expect(args).toMatchObject({ tenantId: 't1', action: 'auth.login', take: 50 });
    expect(args.from.toISOString()).toBe(new Date('2026-07-01').toISOString());
    expect(args.to.getHours()).toBe(23);
    expect(args.to.getMinutes()).toBe(59);
  });

  it('drops an unparseable date rather than failing the whole query', async () => {
    await ctrl.list(undefined, undefined, 'not-a-date', undefined, undefined);
    expect(audit.list.mock.calls[0][0].from).toBeUndefined();
  });
});
