// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Pure-delegation controller, same contract as apps.controller.spec.ts:
// every route reaches the right TenantsService method with the right ids.

import { TenantsController } from './tenants.controller';

const tenants = Object.fromEntries(
  ['list', 'get', 'create', 'update', 'remove', 'restore', 'suspend', 'activate',
   'listApps', 'setAppAccess', 'removeAppAccess', 'exportTenant', 'purge']
    .map((m) => [m, jest.fn().mockResolvedValue({ ok: m })]),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctrl = new TenantsController(tenants as any);

beforeEach(() => jest.clearAllMocks());

describe('TenantsController delegation', () => {
  it('list parses includeDeleted from the query string', () => {
    ctrl.list('true');
    expect(tenants.list).toHaveBeenCalledWith(true);
    ctrl.list(undefined);
    expect(tenants.list).toHaveBeenLastCalledWith(false);
  });

  it('lifecycle and state routes carry the id', () => {
    ctrl.get('t1'); expect(tenants.get).toHaveBeenCalledWith('t1');
    ctrl.create({ slug: 's' } as never); expect(tenants.create).toHaveBeenCalled();
    ctrl.update('t1', { name: 'n' } as never); expect(tenants.update).toHaveBeenCalledWith('t1', { name: 'n' });
    ctrl.remove('t1'); expect(tenants.remove).toHaveBeenCalledWith('t1');
    ctrl.restore('t1'); expect(tenants.restore).toHaveBeenCalledWith('t1');
    ctrl.suspend('t1'); expect(tenants.suspend).toHaveBeenCalledWith('t1');
    ctrl.activate('t1'); expect(tenants.activate).toHaveBeenCalledWith('t1');
    ctrl.purge('t1'); expect(tenants.purge).toHaveBeenCalledWith('t1');
    ctrl.exportTenant('t1'); expect(tenants.exportTenant).toHaveBeenCalledWith('t1');
  });

  it('app-access routes carry tenant and app ids through', () => {
    ctrl.listApps('t1'); expect(tenants.listApps).toHaveBeenCalledWith('t1');
    ctrl.setAppAccess('t1', 'a1', { enabled: true } as never);
    expect(tenants.setAppAccess).toHaveBeenCalledWith('t1', 'a1', { enabled: true });
    ctrl.removeAppAccess('t1', 'a1');
    expect(tenants.removeAppAccess).toHaveBeenCalledWith('t1', 'a1');
  });
});
