// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Per-tenant Dexie databases. The instance registry and the active pointer
 * are module state, so each case loads the module fresh. The property that
 * matters most is deleteTenantDb: sign-out must take the data with it, or the
 * next person at a shared keyboard reads the previous tenant's projects.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./tenantDb");
}

const tenant = () => `t-${crypto.randomUUID()}`;

beforeEach(() => vi.clearAllMocks());

describe("getTenantDb", () => {
  it("names the database after the tenant and returns the same instance for the same tenant", async () => {
    const m = await load();
    const id = tenant();
    const a = m.getTenantDb(id);
    expect(a.name).toBe(`EVOAPP_${id}`);
    expect(a.tenantId).toBe(id);
    expect(m.getTenantDb(id)).toBe(a);
    expect(m.getTenantDb(tenant())).not.toBe(a);
  });
});

describe("activeDb", () => {
  it("refuses until a tenant has been installed, then returns it", async () => {
    const m = await load();
    expect(() => m.activeDb()).toThrow(/No active tenant DB/);
    const db = m.setActiveTenantDb(tenant());
    expect(m.activeDb()).toBe(db);
  });
});

describe("deleteTenantDb", () => {
  it("closes and forgets the instance, clears the active pointer, and drops the database", async () => {
    const m = await load();
    const id = tenant();
    const db = m.setActiveTenantDb(id);
    await db.projects.put({ id: "p1", name: "Secret project", status: "Active", updatedAt: "now" });
    await m.setMeta(db, "cursor", "42");
    expect(await Dexie.exists(`EVOAPP_${id}`)).toBe(true);
    const remove = vi.spyOn(Dexie, "delete");

    await m.deleteTenantDb(id);

    expect(remove).toHaveBeenCalledWith(`EVOAPP_${id}`);
    expect(await Dexie.exists(`EVOAPP_${id}`)).toBe(false); // the data, not just the handle
    expect(() => m.activeDb()).toThrow(/No active tenant DB/);
    // A fresh handle for the same tenant starts empty.
    const again = m.getTenantDb(id);
    expect(again).not.toBe(db);
    expect(await again.projects.count()).toBe(0);
    expect(await m.getMeta(again, "cursor")).toBeNull();
  });

  it("is a no-op for a tenant that was never opened", async () => {
    const m = await load();
    await expect(m.deleteTenantDb("never-opened")).resolves.toBeUndefined();
  });

  it("leaves another tenant's active database alone", async () => {
    const m = await load();
    const keep = m.setActiveTenantDb(tenant());
    await m.deleteTenantDb(tenant()); // never opened, never active
    expect(m.activeDb()).toBe(keep);
  });
});

describe("meta", () => {
  it("round-trips a value and is null for a missing key", async () => {
    const m = await load();
    const db = m.getTenantDb(tenant());
    await db.open();
    expect(await m.getMeta(db, "missing")).toBeNull();
    await m.setMeta(db, "cursor", "7");
    await m.setMeta(db, "cursor", "8");
    expect(await m.getMeta(db, "cursor")).toBe("8");
  });
});
