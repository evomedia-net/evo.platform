# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Token verification: the security half of the SDK.

Every test signs real RS256 tokens against a real generated key and serves a
real JWKS through httpx's mock transport — no verification step is stubbed,
because the stub is where a signature bug would hide.
"""

from __future__ import annotations

import time
import uuid

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from evoplatform_sdk import ConfigError, EvoPlatform, TokenError

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "key-1"
ROTATED_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ROTATED_KID = "key-2"


def _jwk(key, kid: str) -> dict:
    import json

    jwk = json.loads(pyjwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = kid
    return jwk


def _sign(key=KEY, kid: str = KID, **claims) -> str:
    payload = {
        "iss": "evoplatform",
        "sub": str(uuid.uuid4()),
        "exp": int(time.time()) + 300,
        "tenant_id": "t1",
        "tenant_slug": "acme",
        "app": "app_sp",
        "roles": ["admin"],
        **claims,
    }
    # exp=None means "mint an already-expired token"
    if payload["exp"] is None:
        payload["exp"] = int(time.time()) - 10
    return pyjwt.encode(payload, key, algorithm="RS256", headers={"kid": kid})


class JwksServer:
    """Serves the JWKS and counts fetches, so rotation behaviour is provable."""

    def __init__(self):
        self.keys = [_jwk(KEY, KID)]
        self.fetches = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/jwks.json":
            self.fetches += 1
            return httpx.Response(200, json={"keys": self.keys})
        return httpx.Response(404, json={"message": "not found"})


def make_platform(server: JwksServer, **kw) -> EvoPlatform:
    return EvoPlatform(
        "https://platform.example",
        client_id=kw.pop("client_id", "app_sp"),
        transport=httpx.MockTransport(server.handler),
        **kw,
    )


def test_a_valid_token_yields_its_claims():
    p = make_platform(JwksServer())
    claims = p.verify_token(_sign())
    assert claims["tenant_id"] == "t1"
    assert claims["tenant_slug"] == "acme"
    assert claims["roles"] == ["admin"]


def test_the_jwks_is_fetched_once_not_per_request():
    server = JwksServer()
    p = make_platform(server)
    for _ in range(5):
        p.verify_token(_sign())
    assert server.fetches == 1


def test_a_token_for_a_different_app_is_rejected():
    """The audience check. A perfectly valid token minted for another app,
    however obtained, must not authenticate here."""
    p = make_platform(JwksServer())
    with pytest.raises(TokenError, match='issued for app "app_other"'):
        p.verify_token(_sign(app="app_other"))
    # ...unless deliberately inspecting foreign tokens.
    assert p.verify_token(_sign(app="app_other"), audience=False)["app"] == "app_other"


# Single-purpose tokens are signed with the SAME key and kid as access tokens.
# The platform refuses them for itself (auth/jwt.guard.ts); the SDK did not, so
# every app built on it was missing that guard. The passkey login-options
# endpoint is unauthenticated and hands one to any caller (security #126).
@pytest.mark.parametrize(
    "purpose",
    ["email_verify", "password_reset", "signup_link", "webauthn_auth", "webauthn_reg"],
)
def test_a_single_purpose_token_is_not_an_access_token(purpose):
    p = make_platform(JwksServer())
    with pytest.raises(TokenError, match="single-purpose"):
        p.verify_token(_sign(purpose=purpose))


def test_the_audience_opt_out_does_not_admit_a_purpose_token():
    """audience=False is for foreign AUDIENCE, not for a different token type."""
    p = make_platform(JwksServer())
    with pytest.raises(TokenError, match="single-purpose"):
        p.verify_token(_sign(purpose="webauthn_auth"), audience=False)


def test_verifying_without_a_client_id_refuses_rather_than_skipping():
    """Silently skipping degraded verification to "any token this platform ever
    issued", with no way for a caller to notice. Role names are unique only per
    app, so a token minted for app A carrying roles:['admin'] then granted admin
    in app B. Opting out has to be deliberate."""
    p = make_platform(JwksServer(), client_id=None)
    with pytest.raises(ConfigError, match="client_id"):
        p.verify_token(_sign(app="app_any"))
    # The explicit opt-out still works.
    assert p.verify_token(_sign(app="app_any"), audience=False)["app"] == "app_any"


def test_a_tampered_token_is_rejected():
    token = _sign()
    header, payload, sig = token.split(".")
    import base64
    import json

    raw = json.loads(base64.urlsafe_b64decode(payload + "=="))
    raw["platform_admin"] = True
    forged = (
        header
        + "."
        + base64.urlsafe_b64encode(json.dumps(raw).encode()).rstrip(b"=").decode()
        + "."
        + sig
    )
    with pytest.raises(TokenError):
        make_platform(JwksServer()).verify_token(forged)


def test_an_expired_token_is_rejected():
    with pytest.raises(TokenError, match="expired"):
        make_platform(JwksServer()).verify_token(_sign(exp=None))


def test_a_wrong_issuer_is_rejected():
    with pytest.raises(TokenError):
        make_platform(JwksServer()).verify_token(_sign(iss="someone-else"))


def test_key_rotation_needs_no_redeploy():
    """An unknown kid triggers one JWKS re-fetch. The first token signed with
    the rotated key misses the cache, the refresh picks the new key up, and
    verification proceeds — no app restart."""
    server = JwksServer()
    p = make_platform(server)
    p.verify_token(_sign())
    assert server.fetches == 1

    server.keys = [_jwk(KEY, KID), _jwk(ROTATED_KEY, ROTATED_KID)]
    claims = p.verify_token(_sign(key=ROTATED_KEY, kid=ROTATED_KID))
    assert claims["tenant_id"] == "t1"
    assert server.fetches == 2


def test_a_kid_the_platform_never_published_fails_after_one_refresh():
    server = JwksServer()
    p = make_platform(server)
    with pytest.raises(TokenError, match="Unknown signing key"):
        p.verify_token(_sign(kid="key-nobody-published"))


def test_a_malformed_token_is_a_token_error_not_a_crash():
    with pytest.raises(TokenError):
        make_platform(JwksServer()).verify_token("not-a-jwt")


# An unknown kid used to force a JWKS fetch on every token, and the JWKS
# endpoint is deliberately unthrottled: forged tokens against any app became
# requests against the platform, one for one (#162).
def test_unknown_kid_refetches_at_most_once_per_interval():
    from evoplatform_sdk import JwksCache

    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"keys": [_jwk(KEY, KID)]})

    now = {"t": 1000.0}
    cache = JwksCache(
        "http://platform.test/.well-known/jwks.json",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        clock=lambda: now["t"],
        min_refresh_seconds=30.0,
    )
    cache.get_key(KID)
    assert calls["n"] == 1
    for i in range(5):
        with pytest.raises(TokenError):
            cache.get_key(f"forged-{i}")
    # One fetch wasted on the first forged kid, none on the other four.
    assert calls["n"] == 2

    # Once the quiet interval has passed, an unknown kid fetches again.
    now["t"] += 31
    with pytest.raises(TokenError):
        cache.get_key("rotated")
    assert calls["n"] == 3
