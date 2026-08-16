# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""The EvoPlatform client, mirrored method-for-method with sdk-node.

Same surface, same wire: the platform speaks camelCase JSON, so parameters
here are Python snake_case and this module does the renaming at the boundary.
Anything sdk-node sends, this sends byte-for-byte the same — the two SDKs are
one contract in two languages, and the platform test suite is the referee.

Synchronous by design. The first consumer is SmartPlant EHS, whose service
code runs sync (NiceGUI hands blocking work to run.io_bound); an async client
can wrap this later without changing the wire.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx
import jwt as pyjwt

from .errors import ConfigError, PlatformError, TokenError
from .jwks import JwksCache

DEFAULT_TIMEOUT_SECONDS = 15.0


class EvoPlatform:
    def __init__(
        self,
        platform_url: str,
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        issuer: str = "evoplatform",
        jwks_ttl_seconds: float | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not platform_url:
            raise ConfigError("EvoPlatform requires a platform_url")
        self._base = platform_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._issuer = issuer
        self._http = httpx.Client(timeout=timeout_seconds, transport=transport)
        self._jwks = JwksCache(
            f"{self._base}/.well-known/jwks.json",
            **({"ttl_seconds": jwks_ttl_seconds} if jwks_ttl_seconds is not None else {}),
            http=self._http,
        )

    # ---- token verification (local; no platform call) ----

    def verify_token(self, token: str, *, audience: bool = True) -> dict[str, Any]:
        """Verify a platform-issued access token against the cached JWKS.

        When this client is configured with a ``client_id``, the token's
        ``app`` claim must match it — a token minted for a different app,
        however obtained, is rejected. Pass ``audience=False`` to opt out for
        the rare case of deliberately inspecting foreign tokens.
        """
        try:
            header = pyjwt.get_unverified_header(token)
        except pyjwt.PyJWTError as exc:
            raise TokenError(f"Malformed token: {exc}") from exc
        kid = header.get("kid")
        if not kid:
            raise TokenError("Token has no kid header")
        key = self._jwks.get_key(kid)
        try:
            claims: dict[str, Any] = pyjwt.decode(
                token, key=key, algorithms=["RS256"], issuer=self._issuer
            )
        except pyjwt.PyJWTError as exc:
            raise TokenError(str(exc)) from exc
        if audience and self._client_id and claims.get("app") != self._client_id:
            raise TokenError(
                f'Token was issued for app "{claims.get("app") or "none"}", '
                f'not "{self._client_id}"'
            )
        return claims

    # ---- auth proxy (for apps that render their own login form) ----

    def login(
        self, *, email: str, password: str, tenant_slug: str | None = None
    ) -> dict[str, Any]:
        return self._post(
            "/auth/login",
            {
                "tenantSlug": tenant_slug,
                "email": email,
                "password": password,
                "clientId": self._client_id,
            },
        )

    def refresh(self, refresh_token: str) -> dict[str, Any]:
        return self._post("/auth/refresh", {"refreshToken": refresh_token})

    def signup(self, **params: Any) -> dict[str, Any]:
        """Self-service signup through THIS app. Gated by the platform's
        SIGNUP_MODE; carries no tokens — the first login follows email
        verification."""
        return self._post(
            "/auth/signup", {**_camel(params), "clientId": self._client_id}
        )

    def logout(self, refresh_token: str) -> dict[str, Any]:
        return self._post("/auth/logout", {"refreshToken": refresh_token})

    # ---- email verification & password reset ----
    # Send endpoints always answer ok (no account enumeration).

    def send_verification_email(
        self, *, email: str, tenant_slug: str | None = None
    ) -> dict[str, Any]:
        return self._post(
            "/auth/verify/send", _drop_none({"tenantSlug": tenant_slug, "email": email})
        )

    def verify_email(self, token: str) -> dict[str, Any]:
        return self._post("/auth/verify", {"token": token})

    def forgot_password(
        self, *, email: str, tenant_slug: str | None = None
    ) -> dict[str, Any]:
        """Starts recovery. The client's own id rides along so the platform can
        name the product in the email and send the user back to THIS app."""
        return self._post(
            "/auth/forgot",
            _drop_none(
                {
                    "tenantSlug": tenant_slug,
                    "email": email,
                    "clientId": self._client_id,
                }
            ),
        )

    def reset_password(self, token: str, password: str) -> dict[str, Any]:
        """Resets the password and revokes every session of that user."""
        return self._post("/auth/reset", {"token": token, "password": password})

    # ---- passkeys (WebAuthn) ----

    def passkey_register_options(
        self, access_token: str, *, origin: str | None = None
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/auth/passkeys/register/options",
            {},
            {**_bearer(access_token), **_origin(origin)},
        )

    def passkey_register_verify(
        self,
        access_token: str,
        *,
        credential: Any,
        challenge_token: str,
        nickname: str | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/auth/passkeys/register/verify",
            _drop_none(
                {
                    "credential": credential,
                    "challengeToken": challenge_token,
                    "nickname": nickname,
                }
            ),
            _bearer(access_token),
        )

    def list_passkeys(self, access_token: str) -> list[dict[str, Any]]:
        return self._request("GET", "/auth/passkeys", None, _bearer(access_token))

    def delete_passkey(self, access_token: str, passkey_id: str) -> dict[str, Any]:
        return self._request(
            "DELETE", f"/auth/passkeys/{passkey_id}", None, _bearer(access_token)
        )

    def passkey_login_options(
        self, *, email: str, tenant_slug: str | None = None, origin: str | None = None
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/auth/passkeys/login/options",
            _drop_none({"tenantSlug": tenant_slug, "email": email}),
            _origin(origin),
        )

    def passkey_login_verify(
        self, *, credential: Any, challenge_token: str
    ) -> dict[str, Any]:
        return self._post(
            "/auth/passkeys/login/verify",
            {
                "credential": credential,
                "challengeToken": challenge_token,
                "clientId": self._client_id,
            },
        )

    # ---- tenant member management (tenant-admin user's token) ----
    # The platform scopes every call to the token's own tenant.

    def list_tenant_members(self, access_token: str) -> list[dict[str, Any]]:
        return self._request("GET", "/tenant/users", None, _bearer(access_token))

    def list_tenant_roles(self, access_token: str) -> list[dict[str, Any]]:
        return self._request("GET", "/tenant/roles", None, _bearer(access_token))

    def create_tenant_member(
        self, access_token: str, **params: Any
    ) -> dict[str, Any]:
        return self._request(
            "POST", "/tenant/users", _camel(params), _bearer(access_token)
        )

    def update_tenant_member(
        self, access_token: str, member_id: str, **params: Any
    ) -> dict[str, Any]:
        return self._request(
            "PATCH", f"/tenant/users/{member_id}", _camel(params), _bearer(access_token)
        )

    def deactivate_tenant_member(
        self, access_token: str, member_id: str
    ) -> dict[str, Any]:
        return self._request(
            "DELETE", f"/tenant/users/{member_id}", None, _bearer(access_token)
        )

    def restore_tenant_member(
        self, access_token: str, member_id: str
    ) -> dict[str, Any]:
        return self._request(
            "POST", f"/tenant/users/{member_id}/restore", None, _bearer(access_token)
        )

    def set_tenant_member_roles(
        self, access_token: str, member_id: str, role_ids: list[str]
    ) -> dict[str, Any]:
        return self._request(
            "PUT",
            f"/tenant/users/{member_id}/roles",
            {"roleIds": role_ids},
            _bearer(access_token),
        )

    # ---- invites (tenant-admin token; accept is public) ----

    def list_tenant_invites(self, access_token: str) -> list[dict[str, Any]]:
        return self._request("GET", "/tenant/invites", None, _bearer(access_token))

    def create_tenant_invite(self, access_token: str, **params: Any) -> dict[str, Any]:
        return self._request(
            "POST", "/tenant/invites", _camel(params), _bearer(access_token)
        )

    def resend_tenant_invite(self, access_token: str, invite_id: str) -> dict[str, Any]:
        return self._request(
            "POST", f"/tenant/invites/{invite_id}/resend", None, _bearer(access_token)
        )

    def revoke_tenant_invite(self, access_token: str, invite_id: str) -> dict[str, Any]:
        return self._request(
            "DELETE", f"/tenant/invites/{invite_id}", None, _bearer(access_token)
        )

    def accept_invite(self, **params: Any) -> dict[str, Any]:
        return self._post("/auth/invites/accept", _camel(params))

    # ---- client-credential services ----

    def get_entitlement(self, *, tenant_id: str) -> dict[str, Any]:
        """The tenant's standing on THIS app - status, plan, trial/grace
        deadlines, and whether a login would be admitted right now. A cheap
        DB read on the platform (no Stripe round-trip), so calling it per
        page load is fine."""
        return self._request(
            "GET",
            f"/billing/entitlement?tenantId={quote(tenant_id, safe='')}",
            None,
            self._client_headers(),
        )

    def list_prices(self) -> list[dict[str, Any]]:
        """What this app sells, cheapest first - enough to render a pricing
        table without holding any Stripe ids in your own code."""
        return self._request("GET", "/billing/prices", None, self._client_headers())

    def create_checkout(
        self,
        *,
        tenant_id: str,
        success_url: str,
        cancel_url: str,
        tier: str | None = None,
        interval: str | None = None,
        interval_count: int | None = None,
        price_id: str | None = None,
        quantity: int | None = None,
    ) -> dict[str, Any]:
        """Stripe Checkout for the tenant's subscription to THIS app. The
        webhook then drives the tenant's access (paid → active, failed →
        grace → suspended)."""
        return self._post(
            "/billing/checkout",
            _drop_none(
                {
                    "tenantId": tenant_id,
                    "successUrl": success_url,
                    "cancelUrl": cancel_url,
                    "tier": tier,
                    "interval": interval,
                    "intervalCount": interval_count,
                    "priceId": price_id,
                    "quantity": quantity,
                }
            ),
            self._client_headers(),
        )

    def create_billing_portal(
        self, *, tenant_id: str, return_url: str
    ) -> dict[str, Any]:
        return self._post(
            "/billing/portal",
            {"tenantId": tenant_id, "returnUrl": return_url},
            self._client_headers(),
        )

    def send_email(self, **params: Any) -> dict[str, Any]:
        return self._post("/email/send", _camel(params), self._client_headers())

    def push_event(self, **params: Any) -> dict[str, Any]:
        return self._post("/events", _camel(params), self._client_headers())

    # ---- internals ----

    def _client_headers(self) -> dict[str, str]:
        if not self._client_id or not self._client_secret:
            raise ConfigError("client_id and client_secret are required for this call")
        return {
            "x-client-id": self._client_id,
            "x-client-secret": self._client_secret,
        }

    def _post(
        self, path: str, body: Any, headers: dict[str, str] | None = None
    ) -> Any:
        return self._request("POST", path, body, headers or {})

    def _request(
        self, method: str, path: str, body: Any, headers: dict[str, str]
    ) -> Any:
        try:
            res = self._http.request(
                method,
                f"{self._base}{path}",
                headers=headers,
                **({} if body is None else {"json": body}),
            )
        except httpx.TimeoutException as exc:
            raise PlatformError(504, f"Platform request timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise PlatformError(0, f"Platform is unreachable: {exc}") from exc

        try:
            parsed = res.json() if res.text else None
        except ValueError:
            parsed = res.text
        if res.status_code >= 400:
            message = (
                str(parsed.get("message"))
                if isinstance(parsed, dict) and "message" in parsed
                else f"Platform request failed with status {res.status_code}"
            )
            raise PlatformError(res.status_code, message, parsed)
        return parsed


def _bearer(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _origin(origin: str | None) -> dict[str, str]:
    return {"Origin": origin} if origin else {}


def _drop_none(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def _camel(params: dict[str, Any]) -> dict[str, Any]:
    """snake_case kwargs -> the camelCase the platform DTOs validate.

    Mechanical, so a parameter added to the node SDK needs no table entry
    here — the rename rule is the same for every key.
    """
    out: dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        parts = key.split("_")
        out[parts[0] + "".join(p.title() for p in parts[1:])] = value
    return out
