"""Client for evo-ai, the Ask AI service. Mirrored with sdk-node's AskAi.

evo-ai is a SEPARATE service from the platform, with its own URL and its own
credentials, so this is a sibling of ``EvoPlatform`` rather than a method on
it.

Two ways to authenticate, matching the two ways an app is built:

- **Service key** — your server holds one ``svc_`` key and names the tenant
  per request. The key authenticates the *application*; ``tenant_id`` states
  which customer's data to search.
- **User access token** — pass a platform-issued token straight through and
  evo-ai reads the tenant from its verified claims.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from .errors import ConfigError, PlatformError

# An LLM composing an answer over retrieved records is not a fast API call —
# the usual client default cuts off answers that were about to succeed.
DEFAULT_TIMEOUT_SECONDS = 120.0


@dataclass
class AskResult:
    answer: str
    #: The question actually executed: with history, evo-ai condenses a
    #: follow-up like "how many?" into a standalone question before searching.
    question: str
    sources: list[dict[str, Any]] = field(default_factory=list)
    action_proposal: dict[str, Any] | None = None
    #: Declined as unrelated to the indexed data, before any AI call.
    #: A refusal is NOT an error — render it differently from a failure.
    gated: bool = False
    #: No usable model for this tenant — an administrator problem.
    unconfigured: bool = False


class AskAi:
    def __init__(
        self,
        url: str,
        *,
        service_key: str | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not url:
            raise ConfigError("AskAi requires a url")
        self._base = url.rstrip("/")
        self._service_key = service_key
        self._timeout = timeout_seconds
        self._http = httpx.Client(timeout=timeout_seconds, transport=transport)

    def ask(
        self,
        question: str,
        *,
        tenant_id: str | None = None,
        access_token: str | None = None,
        history: list[dict[str, str]] | None = None,
        source_types: list[str] | None = None,
        collection: str = "default",
        allow_actions: bool = False,
    ) -> AskResult:
        """Ask a question against one tenant's indexed data.

        Raises ``PlatformError`` on any non-2xx response or timeout. ``gated``
        and ``unconfigured`` come back on the result, not as exceptions.
        """
        body = {
            "question": question,
            "history": history or [],
            "source_types": source_types,
            "collection": collection,
            "allow_actions": allow_actions,
        }
        res = self._send(
            "/query", body, self._auth_headers(tenant_id, access_token)
        )
        return AskResult(
            answer=res.get("answer") or "",
            question=res.get("question") or question,
            sources=res.get("sources") or [],
            action_proposal=res.get("action_proposal"),
            gated=bool(res.get("gated")),
            unconfigured=bool(res.get("unconfigured")),
        )

    def health(self) -> bool:
        """Liveness check. Cheap enough for a readiness probe."""
        try:
            res = self._http.get(f"{self._base}/health", timeout=5.0)
            return res.status_code == 200
        except httpx.HTTPError:
            return False

    # ---- internals ----

    def _auth_headers(
        self, tenant_id: str | None, access_token: str | None
    ) -> dict[str, str]:
        if access_token:
            # The tenant comes from the token's verified claims. Naming one
            # here too would be ignored, so reject it rather than imply it
            # took effect.
            if tenant_id:
                raise ConfigError(
                    "Pass either access_token or tenant_id, not both — with a "
                    "user token the tenant comes from its verified claims"
                )
            return {"Authorization": f"Bearer {access_token}"}

        if not self._service_key:
            raise ConfigError(
                "AskAi.ask needs either a service_key on the client or an "
                "access_token on the call"
            )
        if not tenant_id:
            # evo-ai answers 400 for this; failing here names the actual mistake.
            raise ConfigError(
                "tenant_id is required when authenticating with a service key "
                "— the key identifies your application, not the customer"
            )
        return {
            "Authorization": f"Bearer {self._service_key}",
            "X-Data-Tenant": str(tenant_id),
        }

    def _send(
        self, path: str, body: Any, headers: dict[str, str]
    ) -> dict[str, Any]:
        try:
            res = self._http.post(
                f"{self._base}{path}", json=body, headers=headers
            )
        except httpx.TimeoutException as exc:
            raise PlatformError(
                504, f"Ask AI request timed out after {self._timeout}s"
            ) from exc
        except httpx.HTTPError as exc:
            raise PlatformError(0, f"Ask AI is unreachable: {exc}") from exc

        try:
            parsed = res.json() if res.text else {}
        except ValueError:
            parsed = res.text
        if res.status_code >= 400:
            detail = (
                str(parsed.get("detail"))
                if isinstance(parsed, dict) and "detail" in parsed
                else f"Ask AI request failed with status {res.status_code}"
            )
            raise PlatformError(res.status_code, detail, parsed)
        return parsed if isinstance(parsed, dict) else {}
