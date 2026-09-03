// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Where a reset page finds its address and token.
 *
 * The emailed link carries both in the URL fragment, so they never reach a
 * server log on the way in (#163). Links minted before that change carried
 * them in the query string; those are honoured until they expire, which is
 * why the fallback exists and why it is second.
 */
export interface ResetLink {
  email: string;
  token: string;
}

export function parseResetLink(
  hash: string,
  fallback: { email?: string; token?: string } = {},
): ResetLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const email = params.get("email") ?? fallback.email ?? "";
  const token = params.get("token") ?? fallback.token ?? "";
  return email && token ? { email, token } : null;
}
