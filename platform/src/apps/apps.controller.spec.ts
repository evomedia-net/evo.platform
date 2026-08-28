// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Pure-delegation controller: each test pins that a route reaches the right
// service method with the right arguments — the failure mode being a route
// quietly rewired (restore hitting remove, purge skipping its guard chain).

import { AppsController, BrandController } from './apps.controller';

const apps = Object.fromEntries(
  ['list', 'get', 'create', 'update', 'remove', 'restore', 'purge', 'rotateSecret',
   'listTenants', 'listPrices', 'addPrice', 'removePrice', 'listRoles', 'addRole',
   'updateRole', 'removeRole'].map((m) => [m, jest.fn().mockResolvedValue({ ok: m })]),
);
const brand = {
  get: jest.fn().mockResolvedValue({ brand: null }),
  set: jest.fn().mockResolvedValue({ ok: true }),
  forClient: jest.fn().mockResolvedValue({ name: 'evo.demo' }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctrl = new AppsController(apps as any, brand as any);

beforeEach(() => jest.clearAllMocks());

describe('AppsController delegation', () => {
  it('list parses includeDeleted from the query string', () => {
    ctrl.list('true');
    expect(apps.list).toHaveBeenCalledWith(true);
    ctrl.list(undefined);
    expect(apps.list).toHaveBeenLastCalledWith(false);
  });

  it('the lifecycle routes reach their service methods with the id', () => {
    ctrl.get('a1'); expect(apps.get).toHaveBeenCalledWith('a1');
    ctrl.create({ name: 'x' } as never); expect(apps.create).toHaveBeenCalled();
    ctrl.update('a1', { name: 'y' } as never); expect(apps.update).toHaveBeenCalledWith('a1', { name: 'y' });
    ctrl.remove('a1'); expect(apps.remove).toHaveBeenCalledWith('a1');
    ctrl.restore('a1'); expect(apps.restore).toHaveBeenCalledWith('a1');
    ctrl.purge('a1'); expect(apps.purge).toHaveBeenCalledWith('a1');
    ctrl.rotateSecret('a1'); expect(apps.rotateSecret).toHaveBeenCalledWith('a1');
    ctrl.listTenants('a1'); expect(apps.listTenants).toHaveBeenCalledWith('a1');
  });

  it('price and role routes carry both ids through', () => {
    ctrl.listPrices('a1'); expect(apps.listPrices).toHaveBeenCalledWith('a1');
    ctrl.addPrice('a1', { stripePriceId: 'p' } as never); expect(apps.addPrice).toHaveBeenCalledWith('a1', { stripePriceId: 'p' });
    ctrl.removePrice('a1', 'p1'); expect(apps.removePrice).toHaveBeenCalledWith('a1', 'p1');
    ctrl.listRoles('a1'); expect(apps.listRoles).toHaveBeenCalledWith('a1');
    ctrl.addRole('a1', { name: 'r' } as never); expect(apps.addRole).toHaveBeenCalledWith('a1', { name: 'r' });
    ctrl.updateRole('a1', 'r1', { name: 'z' } as never); expect(apps.updateRole).toHaveBeenCalledWith('a1', 'r1', { name: 'z' });
    ctrl.removeRole('a1', 'r1'); expect(apps.removeRole).toHaveBeenCalledWith('a1', 'r1');
  });

  it('brand read/write pass the app id, and set records who did it', () => {
    ctrl.getBrand('a1');
    expect(brand.get).toHaveBeenCalledWith('a1');
    ctrl.setBrand('a1', { brand: { name: 'N' } }, { user: { sub: 'u9' } });
    expect(brand.set).toHaveBeenCalledWith('a1', { name: 'N' }, 'u9');
    ctrl.setBrand('a1', {}, {});
    expect(brand.set).toHaveBeenLastCalledWith('a1', null, undefined);
  });
});

describe('BrandController', () => {
  it("serves the calling app's own brand, keyed by its client id", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new BrandController(brand as any).mine({ clientApp: { clientId: 'app_9' } } as any);
    expect(brand.forClient).toHaveBeenCalledWith('app_9');
  });
});
