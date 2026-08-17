// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { isPlatformMode } from "@/lib/platform";
import ForgotPasswordForm from "./ForgotPasswordForm";

/**
 * force-dynamic for the same reason the login page needs it: reading
 * process.env does not opt a page out of build-time prerendering, and
 * `next build` runs where PLATFORM_URL is unset — so the standalone form
 * would be baked into static HTML and served forever, whatever mode the
 * runtime is actually in. Here that would hide the workspace field from
 * every platform-mode deployment.
 */
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm platformMode={isPlatformMode()} />;
}
