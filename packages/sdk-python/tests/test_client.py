# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""The wire contract: what this SDK actually sends.

The platform's DTOs validate camelCase keys, so the renaming at the boundary
is the part that breaks silently — a snake_case key that slips through is
just ignored by class-validator's whitelist and the field quietly never
arrives. These tests capture the real request and assert on its bytes.
"""

from __future__ import annotations

import json

import httpx
import pytest

from evoplatform_sdk import ConfigError, EvoPlatform, PlatformError


class Capture:
    def __init__(self, respond=None, status=200):
        self.requests: list[httpx.Request] = []
        self._respond = respond if respond is not None else {"ok": True}
        self._status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self._status, json=self._respond)

    @property
    def last_body(self) -> dict:
        return json.loads(self.requests[-1].content)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]


def platform(cap: Capture, **kw) -> EvoPlatform:
    kw.setdefault("client_id", "app_sp")
    return EvoPlatform(
        "https://platform.example/",
        transport=httpx.MockTransport(cap.handler),
        **kw,
    )


# ── the boundary renames, and sends what the DTOs validate ───────────────

def test_login_sends_the_camel_case_the_platform_validates():
    cap = Capture()
    platform(cap).login(email="a@b.c", password="pw", tenant_slug="acme")
    assert cap.last.url.path == "/auth/login"
    assert cap.last_body == {
        "tenantSlug": "acme",
        "email": "a@b.c",
        "password": "pw",
        "clientId": "app_sp",
    }


def test_checkout_carries_client_credentials_and_camel_case():
    cap = Capture(respond={"url": "https://checkout.stripe.com/x"})
    out = platform(cap, client_secret="sec").create_checkout(
        tenant_id="t1",
        success_url="https://app/s",
        cancel_url="https://app/c",
    )
    assert out["url"].startswith("https://checkout")
    assert cap.last.headers["x-client-id"] == "app_sp"
    assert cap.last.headers["x-client-secret"] == "sec"
    body = cap.last_body
    assert body["tenantId"] == "t1" and body["successUrl"] == "https://app/s"
    assert "priceId" not in body  # omitted, not null — DTO whitelists differ


def test_client_credential_calls_refuse_to_run_without_credentials():
    """Named at the call site, not discovered as a server 401."""
    with pytest.raises(ConfigError, match="client_id and client_secret"):
        platform(Capture()).create_checkout(
            tenant_id="t1", success_url="s", cancel_url="c"
        )


def test_generic_kwargs_are_renamed_mechanically():
    cap = Capture()
    platform(cap, client_secret="sec").send_email(
        tenant_id="t1", to="a@b.c", subject="hi", html="<p>x</p>"
    )
    assert set(cap.last_body) == {"tenantId", "to", "subject", "html"}


def test_bearer_calls_carry_the_token_and_nothing_else():
    cap = Capture(respond=[])
    platform(cap).list_tenant_members("tok-123")
    assert cap.last.headers["authorization"] == "Bearer tok-123"
    assert "x-client-secret" not in cap.last.headers


def test_member_roles_put_the_exact_shape():
    cap = Capture()
    platform(cap).set_tenant_member_roles("tok", "u1", ["r1", "r2"])
    assert cap.last.method == "PUT"
    assert cap.last.url.path == "/tenant/users/u1/roles"
    assert cap.last_body == {"roleIds": ["r1", "r2"]}


# ── failures are typed, with the platform's own message ──────────────────

def test_a_platform_error_carries_status_and_the_servers_message():
    cap = Capture(respond={"message": "Invalid credentials"}, status=401)
    with pytest.raises(PlatformError) as caught:
        platform(cap).login(email="a@b.c", password="wrong")
    assert caught.value.status == 401
    assert "Invalid credentials" in str(caught.value)


def test_unreachable_is_status_zero():
    def die(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    p = EvoPlatform("https://platform.example", transport=httpx.MockTransport(die))
    with pytest.raises(PlatformError) as caught:
        p.refresh("rt")
    assert caught.value.status == 0


def test_a_timeout_is_504_not_a_bare_exception():
    def hang(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    p = EvoPlatform("https://platform.example", transport=httpx.MockTransport(hang))
    with pytest.raises(PlatformError) as caught:
        p.refresh("rt")
    assert caught.value.status == 504


def test_a_missing_platform_url_fails_at_construction():
    with pytest.raises(ConfigError):
        EvoPlatform("")


def test_entitlement_is_a_get_with_the_tenant_in_the_query():
    cap = Capture(respond={"enabled": True, "status": "TRIAL", "daysLeft": 5})
    out = platform(cap, client_secret="sec").get_entitlement(tenant_id="t 1/x")
    assert out["enabled"] is True
    assert cap.last.method == "GET"
    assert cap.last.url.path == "/billing/entitlement"
    # The id is URL-encoded, not interpolated raw — slashes must not make paths.
    assert cap.last.url.params["tenantId"] == "t 1/x"
    assert cap.last.headers["x-client-id"] == "app_sp"
    assert not cap.last.content  # a GET carries no body
