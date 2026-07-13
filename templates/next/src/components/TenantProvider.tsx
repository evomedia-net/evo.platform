"use client";

import { createContext, useContext, useState } from "react";
import { setActiveTenantDb, type TenantDatabase } from "@/lib/offline/tenantDb";

export interface TenantContextValue {
  tenantId: string;
  role: string;
  email: string;
  userId: string;
  db: TenantDatabase;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: Omit<TenantContextValue, "db">;
  children: React.ReactNode;
}) {
  // useState initializer runs synchronously before children render, so the
  // data layer's activeDb() is always available underneath this provider.
  const [db] = useState<TenantDatabase>(() => setActiveTenantDb(value.tenantId));

  return <TenantContext.Provider value={{ ...value, db }}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside <TenantProvider>");
  return ctx;
}
