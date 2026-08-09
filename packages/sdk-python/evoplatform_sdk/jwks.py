# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Cached JWKS, so token verification is local.

No per-request platform call: the key set is fetched once and kept for a TTL.
An unknown ``kid`` triggers one refresh, which is what makes platform key
rotation need no app redeploys — the first token signed with a new key misses
the cache, the refresh picks the key up, verification proceeds.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import httpx
from jwt.algorithms import RSAAlgorithm

from .errors import TokenError

DEFAULT_TTL_SECONDS = 10 * 60


class JwksCache:
    def __init__(
        self,
        jwks_url: str,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = jwks_url
        self._ttl = ttl_seconds
        self._http = http or httpx.Client(timeout=10)
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None

    def get_key(self, kid: str):
        stale = (
            self._fetched_at is None or self._clock() - self._fetched_at > self._ttl
        )
        if stale or kid not in self._keys:
            self.refresh()
        key = self._keys.get(kid)
        if key is None:
            raise TokenError(f"Unknown signing key: {kid}")
        return key

    def refresh(self) -> None:
        try:
            res = self._http.get(self._url)
        except httpx.HTTPError as exc:
            raise TokenError(f"JWKS fetch failed: {exc}") from exc
        if res.status_code != 200:
            raise TokenError(f"JWKS fetch failed with status {res.status_code}")
        body = res.json()
        self._keys.clear()
        for jwk in body.get("keys", []):
            kid = jwk.get("kid")
            if not kid:
                continue
            self._keys[kid] = RSAAlgorithm.from_jwk(jwk)
        self._fetched_at = self._clock()
