"""The Ask AI client: two auth modes, and refusals that are not errors."""

from __future__ import annotations

import json

import httpx
import pytest

from evoplatform_sdk import AskAi, ConfigError, PlatformError


class Capture:
    def __init__(self, respond=None, status=200):
        self.requests: list[httpx.Request] = []
        self._respond = respond if respond is not None else {"answer": "42"}
        self._status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self._status, json=self._respond)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]


def ai(cap: Capture, **kw) -> AskAi:
    kw.setdefault("service_key", "svc_k")
    return AskAi("https://ai.example", transport=httpx.MockTransport(cap.handler), **kw)


# ── auth: the service key names the app, the header names the customer ───

def test_service_key_auth_sends_the_key_and_the_data_tenant():
    cap = Capture()
    ai(cap).ask("q", tenant_id="t1")
    assert cap.last.headers["authorization"] == "Bearer svc_k"
    assert cap.last.headers["x-data-tenant"] == "t1"


def test_a_service_key_without_a_tenant_is_refused_client_side():
    """evo-ai answers 400 for this; failing here names the actual mistake —
    the key identifies the application, not the customer."""
    with pytest.raises(ConfigError, match="tenant_id is required"):
        ai(Capture()).ask("q")


def test_user_token_auth_carries_the_token_and_no_tenant_header():
    cap = Capture()
    ai(cap, service_key=None).ask("q", access_token="tok")
    assert cap.last.headers["authorization"] == "Bearer tok"
    assert "x-data-tenant" not in cap.last.headers


def test_naming_a_tenant_alongside_a_user_token_is_refused():
    """It would be ignored by evo-ai — reject rather than imply it took
    effect."""
    with pytest.raises(ConfigError, match="not both"):
        ai(Capture()).ask("q", access_token="tok", tenant_id="t1")


def test_no_credentials_at_all_is_named():
    with pytest.raises(ConfigError, match="either a service_key"):
        AskAi("https://ai.example", transport=httpx.MockTransport(Capture().handler)).ask(
            "q", tenant_id="t1"
        )


# ── the wire is snake_case (evo-ai, unlike the platform) ─────────────────

def test_the_body_uses_evo_ai_field_names():
    cap = Capture()
    ai(cap).ask("q", tenant_id="t1", source_types=["permit"], allow_actions=True)
    body = json.loads(cap.last.content)
    assert body["source_types"] == ["permit"]
    assert body["allow_actions"] is True
    assert body["collection"] == "default"


# ── refusals are results, failures are errors ────────────────────────────

def test_gated_and_unconfigured_come_back_as_flags_not_exceptions():
    cap = Capture(respond={"answer": "", "gated": True, "unconfigured": False})
    out = ai(cap).ask("what is the weather", tenant_id="t1")
    assert out.gated is True
    assert out.answer == ""


def test_the_condensed_question_is_surfaced():
    """With history, evo-ai rewrites "how many?" into a standalone question.
    Worth showing when it surprises a user."""
    cap = Capture(respond={"answer": "3", "question": "how many permits expire"})
    out = ai(cap).ask("how many?", tenant_id="t1")
    assert out.question == "how many permits expire"


def test_a_422_surfaces_evo_ais_detail():
    cap = Capture(respond={"detail": "question too long"}, status=422)
    with pytest.raises(PlatformError) as caught:
        ai(cap).ask("q" * 9000, tenant_id="t1")
    assert caught.value.status == 422
    assert "question too long" in str(caught.value)


def test_a_timeout_is_504_with_the_configured_window_named():
    def hang(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    slow = AskAi(
        "https://ai.example",
        service_key="svc_k",
        timeout_seconds=90,
        transport=httpx.MockTransport(hang),
    )
    with pytest.raises(PlatformError) as caught:
        slow.ask("q", tenant_id="t1")
    assert caught.value.status == 504
    assert "90" in str(caught.value)


def test_unreachable_is_status_zero_and_health_is_false():
    def die(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    dead = AskAi(
        "https://ai.example", service_key="svc_k", transport=httpx.MockTransport(die)
    )
    with pytest.raises(PlatformError) as caught:
        dead.ask("q", tenant_id="t1")
    assert caught.value.status == 0
    assert dead.health() is False
