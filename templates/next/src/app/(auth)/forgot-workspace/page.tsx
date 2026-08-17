// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { isPlatformMode } from "@/lib/platform";
import WorkspaceForm from "./WorkspaceForm";

export const dynamic = "force-dynamic";

export default function ForgotWorkspacePage() {
  return <WorkspaceForm platformMode={isPlatformMode()} />;
}
