// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evo App",
  description: "EvoPlatform Next.js starter — multi-tenant, offline-first",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
