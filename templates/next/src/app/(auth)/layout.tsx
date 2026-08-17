// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { PRODUCT_NAME } from "@/lib/product";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-6">{PRODUCT_NAME}</h1>
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6">{children}</div>
      </div>
    </div>
  );
}
