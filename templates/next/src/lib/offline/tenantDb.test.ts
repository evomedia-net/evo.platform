// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { deleteTenantDb, getTenantDb, setActiveTenantDb } from "./tenantDb";

// The per-tenant name kept one tenant's data out of another's session, but
// the data itself outlived sign-out in IndexedDB on a shared machine (#167).
describe("deleteTenantDb", () => {
  it("removes the tenant database and forgets the active handle", async () => {
    const tenantId = `t-${crypto.randomUUID()}`;
    const db = setActiveTenantDb(tenantId);
    await db.projects.put({ id: "p1", name: "Secret project", status: "Active", updatedAt: "now" });
    expect(await Dexie.exists(`EVOAPP_${tenantId}`)).toBe(true);

    await deleteTenantDb(tenantId);

    expect(await Dexie.exists(`EVOAPP_${tenantId}`)).toBe(false);
    // A fresh handle for the same tenant starts empty.
    const again = getTenantDb(tenantId);
    expect(await again.projects.count()).toBe(0);
    await deleteTenantDb(tenantId);
  });

  it("is a no-op for a tenant that was never opened", async () => {
    await expect(deleteTenantDb("never-opened")).resolves.toBeUndefined();
  });
});
