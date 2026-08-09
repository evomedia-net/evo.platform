# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""The three ways a call goes wrong, mirrored from sdk-node.

The taxonomy is the API: callers branch on *which* of these they caught, so
the split is by who has to act — PlatformError means the service or the
network, TokenError means the credential, ConfigError means the calling code.
"""

from __future__ import annotations

from typing import Any


class PlatformError(Exception):
    """A non-2xx response from a platform service (the platform itself, or
    evo-ai). ``status`` 0 means the service could not be reached at all; 504
    is a client-side timeout rather than a response."""

    def __init__(self, status: int, message: str, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class TokenError(Exception):
    """Token failed local verification (bad signature, expired, wrong issuer,
    unknown kid, or minted for a different app)."""


class ConfigError(Exception):
    """SDK misconfiguration, e.g. calling a client-credential API without
    credentials. Raised before any network call, so the mistake is named
    instead of surfacing as a server 4xx."""
