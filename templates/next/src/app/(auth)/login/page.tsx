// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { isPlatformMode } from "@/lib/platform";
import LoginForm from "./LoginForm";

/**
 * Server wrapper: resolves platform mode at request time so the form shows the
 * workspace field and passkey option exactly when logins are actually being
 * delegated to EvoPlatform.
 *
 * force-dynamic is load-bearing: reading process.env does NOT opt a page out
 * of build-time prerendering, and `next build` runs in Docker where
 * PLATFORM_URL is unset — so without this the standalone form is baked into
 * static HTML and served forever, whatever mode the runtime is in.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm platformMode={isPlatformMode()} />;
}
