# Evomedia.net evo.platform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Tests for stripe_catalogue.py.

Nothing here reaches Stripe: every test replaces the one HTTP helper. What is
worth testing is the part a dashboard would not give you - that a second run
creates nothing, that a malformed catalogue is rejected whole rather than half
applied, and that a live key cannot be used by accident.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import stripe_catalogue as sc  # noqa: E402

TEST_KEY = "sk_test_x"
LIVE_KEY = "sk_live_x"

CATALOGUE = {
    "products": [
        {
            "app": "docketmail",
            "name": "DocketMail",
            "prices": [{"tier": "standard", "amount": 1000, "interval": "month"}],
        },
        {
            "app": "evocivilcode",
            "name": "EvoCivilCode",
            "prices": [{"tier": "standard", "amount": 500, "interval": "month"}],
        },
    ]
}


class FakeStripe:
    """Just enough of the two endpoints the script uses, with a call log."""

    def __init__(self, products=None, prices=None):
        self.products = list(products or [])
        self.prices = list(prices or [])
        self.posts: list[tuple[str, dict]] = []
        self._seq = 0

    def __call__(self, key, method, path, form=None):
        if method == "GET" and path.startswith("products"):
            return {"data": self.products, "has_more": False}
        if method == "GET" and path.startswith("prices"):
            return {"data": self.prices, "has_more": False}
        if method == "POST" and path == "products":
            self.posts.append((path, form))
            self._seq += 1
            created = {"id": f"prod_{self._seq}", "name": form["name"], "active": True}
            self.products.append(created)
            return created
        if method == "POST" and path == "prices":
            self.posts.append((path, form))
            self._seq += 1
            created = {
                "id": f"price_{self._seq}",
                "product": form["product"],
                "unit_amount": int(form["unit_amount"]),
                "currency": form["currency"],
                "active": True,
                "recurring": {
                    "interval": form["recurring[interval]"],
                    "interval_count": int(form["recurring[interval_count]"]),
                },
            }
            self.prices.append(created)
            return created
        raise AssertionError(f"unexpected {method} /{path}")


@pytest.fixture
def fake(monkeypatch):
    stripe = FakeStripe()
    monkeypatch.setattr(sc, "_request", stripe)
    return stripe


# ── Reading the key ─────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "key,expected",
    [
        ("sk_test_abc", "test"),
        ("rk_test_abc", "test"),
        ("sk_live_abc", "live"),
        ("rk_live_abc", "live"),
        ("pk_test_abc", "unrecognised"),
        ("", "unrecognised"),
    ],
)
def test_mode_of_reads_the_prefix(key, expected):
    assert sc.mode_of(key) == expected


# ── Validation: all of it, before anything is created ──────────────────────

def test_a_good_catalogue_has_no_problems():
    assert sc.validate(CATALOGUE) == []


def test_an_empty_catalogue_is_rejected():
    assert sc.validate({}) == ['"products" must be a non-empty list']
    assert sc.validate({"products": []}) == ['"products" must be a non-empty list']


# A partial create is the worst place to stop, so every fault in the file is
# reported in one pass rather than one per run.
def test_every_fault_is_reported_in_one_pass():
    problems = sc.validate(
        {
            "products": [
                {"name": "", "prices": [{"tier": "", "amount": -1, "interval": "fortnight"}]},
                {"name": "Dup", "prices": []},
                {"name": "Dup", "prices": [{"tier": "a", "amount": 1, "currency": "dollars"}]},
            ]
        }
    )
    joined = " ".join(problems)
    assert '"name" is required' in joined
    assert '"tier" is required' in joined
    assert "non-negative integer" in joined
    assert '"interval" must be one of' in joined
    assert '"prices" must be a non-empty list' in joined
    assert 'duplicate product name "Dup"' in joined
    assert "3-letter code" in joined


# $0 is a legitimate price - a free tier that still carries a subscription
# lifecycle - so the amount check cannot be a truthiness test.
def test_a_zero_amount_is_allowed():
    assert sc.validate({"products": [{"name": "Free", "prices": [{"tier": "free", "amount": 0}]}]}) == []


# True is an int in Python, and Stripe would charge 1 cent for it.
def test_a_boolean_amount_is_not_an_integer():
    problems = sc.validate({"products": [{"name": "X", "prices": [{"tier": "t", "amount": True}]}]})
    assert any("non-negative integer" in p for p in problems)


# The platform stores one price per (app, tier, interval, interval_count), so
# a second one here could never be registered against the app.
def test_two_prices_on_the_same_tier_and_cadence_are_rejected():
    problems = sc.validate(
        {
            "products": [
                {
                    "name": "X",
                    "prices": [
                        {"tier": "pro", "amount": 100, "interval": "month"},
                        {"tier": "pro", "amount": 900, "interval": "month"},
                    ],
                }
            ]
        }
    )
    assert any("duplicate tier/interval" in p for p in problems)


def test_the_same_tier_at_two_cadences_is_fine():
    assert (
        sc.validate(
            {
                "products": [
                    {
                        "name": "X",
                        "prices": [
                            {"tier": "pro", "amount": 1000, "interval": "month"},
                            {"tier": "pro", "amount": 10000, "interval": "year"},
                        ],
                    }
                ]
            }
        )
        == []
    )


# ── Creating, and not re-creating ──────────────────────────────────────────

def test_a_dry_run_creates_nothing_and_still_reports_the_plan(fake):
    rows = sc.run(TEST_KEY, CATALOGUE, apply=False)
    assert fake.posts == []
    assert [r["price_action"] for r in rows] == ["would create", "would create"]
    assert [r["amount"] for r in rows] == ["10.00 USD", "5.00 USD"]


def test_apply_creates_one_product_and_one_price_each(fake):
    rows = sc.run(TEST_KEY, CATALOGUE, apply=True)
    assert [p[0] for p in fake.posts] == ["products", "prices", "products", "prices"]
    assert [r["price_action"] for r in rows] == ["created", "created"]
    assert all(r["price_id"] for r in rows)

    created = dict(fake.posts[1][1])
    assert created["unit_amount"] == 1000
    assert created["currency"] == "usd"
    assert created["recurring[interval]"] == "month"
    assert created["recurring[interval_count]"] == 1


# The whole reason this is a script: running it twice must be safe, because
# the second run is how you confirm the first one.
def test_a_second_apply_creates_nothing(fake):
    sc.run(TEST_KEY, CATALOGUE, apply=True)
    fake.posts.clear()
    rows = sc.run(TEST_KEY, CATALOGUE, apply=True)
    assert fake.posts == []
    assert [r["price_action"] for r in rows] == ["exists", "exists"]
    assert [r["product_action"] for r in rows] == ["exists", "exists"]


# A price that differs in amount is a different price, not this one - Stripe
# prices are immutable, so repricing means a new object.
def test_a_changed_amount_creates_a_new_price_on_the_same_product(fake):
    sc.run(TEST_KEY, CATALOGUE, apply=True)
    fake.posts.clear()
    dearer = json.loads(json.dumps(CATALOGUE))
    dearer["products"][1]["prices"][0]["amount"] = 700
    rows = sc.run(TEST_KEY, dearer, apply=True)
    assert [p[0] for p in fake.posts] == ["prices"]
    assert rows[1]["price_action"] == "created"
    assert rows[0]["price_action"] == "exists"


def test_an_existing_price_on_another_product_is_not_reused(fake):
    fake.products.append({"id": "prod_other", "name": "Something Else", "active": True})
    fake.prices.append(
        {
            "id": "price_other",
            "product": "prod_other",
            "unit_amount": 1000,
            "currency": "usd",
            "recurring": {"interval": "month", "interval_count": 1},
        }
    )
    rows = sc.run(TEST_KEY, CATALOGUE, apply=True)
    assert rows[0]["price_id"] != "price_other"


# The product comes back expanded on the prices listing, so the match has to
# cope with a dict as well as a bare id.
def test_an_expanded_product_object_matches_too(fake):
    fake.products.append({"id": "prod_dm", "name": "DocketMail", "active": True})
    fake.prices.append(
        {
            "id": "price_dm",
            "product": {"id": "prod_dm", "name": "DocketMail"},
            "unit_amount": 1000,
            "currency": "usd",
            "recurring": {"interval": "month", "interval_count": 1},
        }
    )
    rows = sc.run(TEST_KEY, CATALOGUE, apply=True)
    assert rows[0]["price_id"] == "price_dm"
    assert rows[0]["price_action"] == "exists"


# ── Paging ─────────────────────────────────────────────────────────────────

# A half-read list silently creates duplicates, which is the one failure here
# that costs money to unpick.
def test_paging_follows_the_cursor_to_the_end(monkeypatch):
    pages = [
        {"data": [{"id": "a"}, {"id": "b"}], "has_more": True},
        {"data": [{"id": "c"}], "has_more": False},
    ]
    seen: list[str] = []

    def fake_request(key, method, path, form=None):
        seen.append(path)
        return pages[len(seen) - 1]

    monkeypatch.setattr(sc, "_request", fake_request)
    assert [o["id"] for o in sc._page_all(TEST_KEY, "products?active=true")] == ["a", "b", "c"]
    assert "starting_after=b" in seen[1]
    assert "limit=100" in seen[0]


# ── The live-key guard ─────────────────────────────────────────────────────

def test_main_refuses_a_live_apply_without_the_live_flag(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRIPE_SECRET_KEY", LIVE_KEY)
    monkeypatch.setattr(sc, "_request", FakeStripe())
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")

    assert sc.main([str(path), "--apply"]) == 2
    assert "Refusing" in capsys.readouterr().err


def test_main_allows_a_live_apply_when_it_is_spelled_out(monkeypatch, tmp_path):
    monkeypatch.setenv("STRIPE_SECRET_KEY", LIVE_KEY)
    stripe = FakeStripe()
    monkeypatch.setattr(sc, "_request", stripe)
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")

    assert sc.main([str(path), "--apply", "--live"]) == 0
    assert [p[0] for p in stripe.posts] == ["products", "prices", "products", "prices"]


# A dry run reads only, so it needs no ceremony whichever key is in the
# environment - and seeing the live catalogue is how you check it.
def test_a_live_dry_run_needs_no_flag(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRIPE_SECRET_KEY", LIVE_KEY)
    stripe = FakeStripe()
    monkeypatch.setattr(sc, "_request", stripe)
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")

    assert sc.main([str(path)]) == 0
    assert stripe.posts == []
    assert "LIVE" in capsys.readouterr().out


def test_main_refuses_a_publishable_key(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "pk_test_abc")
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")
    assert sc.main([str(path)]) == 2
    assert "not a secret key" in capsys.readouterr().err


def test_main_refuses_a_missing_key(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")
    assert sc.main([str(path)]) == 2
    assert "not set" in capsys.readouterr().err


def test_main_reports_an_invalid_catalogue_without_calling_stripe(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRIPE_SECRET_KEY", TEST_KEY)
    stripe = FakeStripe()
    monkeypatch.setattr(sc, "_request", stripe)
    path = tmp_path / "cat.json"
    path.write_text(json.dumps({"products": [{"name": "X", "prices": []}]}), encoding="utf-8")

    assert sc.main([str(path), "--apply"]) == 2
    assert "not valid" in capsys.readouterr().err
    assert stripe.posts == []


def test_main_reports_a_stripe_failure_as_exit_one(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRIPE_SECRET_KEY", TEST_KEY)

    def boom(key, method, path, form=None):
        raise sc.StripeError("GET /products -> HTTP 401: Invalid API Key provided")

    monkeypatch.setattr(sc, "_request", boom)
    path = tmp_path / "cat.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")

    assert sc.main([str(path)]) == 1
    assert "Invalid API Key" in capsys.readouterr().err


# ── Formatting ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "amount,currency,expected",
    [(1000, "usd", "10.00 USD"), (500, "usd", "5.00 USD"), (0, "usd", "0.00 USD"), (123456, "eur", "1,234.56 EUR")],
)
def test_money_is_printed_in_major_units(amount, currency, expected):
    assert sc.money(amount, currency) == expected


@pytest.mark.parametrize(
    "price,expected",
    [
        ({"interval": "month", "interval_count": 1}, "every month"),
        ({"interval": "month", "interval_count": 3}, "every 3 months"),
        ({"interval": "year", "interval_count": 1}, "every year"),
    ],
)
def test_cadence_reads_as_english(price, expected):
    assert sc.cadence(price) == expected
