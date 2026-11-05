#!/usr/bin/env python3
# Evomedia.net evo.platform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Create the Stripe Products and Prices an EvoPlatform deployment sells.

Going live means building the same catalogue twice: test mode to rehearse in,
live mode to charge in. The objects do not copy between modes - new products,
new prices, new ids - so it is built by hand twice, and a typo in the second
build charges a real customer the wrong amount. This reads the catalogue from
a file instead, so both builds come from one reviewed source.

    export STRIPE_SECRET_KEY=...            # never passed on the command line
    python3 stripe_catalogue.py cat.json            # dry run, the default
    python3 stripe_catalogue.py cat.json --apply    # create what is missing

Idempotent: it matches an existing active Product by name and an existing
active Price by (product, amount, currency, interval), so a second run creates
nothing and simply reprints the ids.

A live key additionally requires --live, spelled out. Everything else about a
live run looks identical to a test run, and "I thought those keys were the
sandbox" is the one mistake here that reaches a customer's card.

The ids it prints are what you register against each app in the console
(Apps -> the app -> Prices), which is where the platform reads the amount back
from Stripe. This script never touches the platform's own database.

Catalogue format - amounts are in the currency's minor unit (cents), the same
unit Stripe uses, so there is no rounding step to get wrong:

    {
      "products": [
        {
          "app": "docketmail",
          "name": "DocketMail",
          "description": "optional, shown on Stripe Checkout and invoices",
          "prices": [
            {"tier": "standard", "amount": 1000, "currency": "usd",
             "interval": "month", "interval_count": 1}
          ]
        }
      ]
    }

`app` is only a label for the output, so the printed table says which app each
id belongs to. Stripe never sees it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

API = "https://api.stripe.com/v1"
VALID_INTERVALS = {"day", "week", "month", "year"}


class StripeError(RuntimeError):
    pass


def _request(key: str, method: str, path: str, form: dict[str, Any] | None = None) -> dict:
    data = urllib.parse.urlencode(form, doseq=True).encode() if form else None
    req = urllib.request.Request(f"{API}/{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    if data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            message = json.loads(body)["error"]["message"]
        except Exception:
            message = body[:400]
        # The key is in a header, never in the message, so this is safe to show.
        raise StripeError(f"{method} /{path} -> HTTP {exc.code}: {message}") from None
    except urllib.error.URLError as exc:
        raise StripeError(f"{method} /{path} -> {exc.reason}") from None


def _page_all(key: str, path: str) -> list[dict]:
    """Every object, following Stripe's cursor rather than hoping for one page.

    A deployment with a dozen products and several prices each passes 100
    quickly, and a half-read list would silently create duplicates.
    """
    out: list[dict] = []
    cursor: str | None = None
    while True:
        sep = "&" if "?" in path else "?"
        url = f"{path}{sep}limit=100" + (f"&starting_after={cursor}" if cursor else "")
        page = _request(key, "GET", url)
        out.extend(page.get("data", []))
        if not page.get("has_more"):
            return out
        cursor = out[-1]["id"]


def mode_of(key: str) -> str:
    if key.startswith(("sk_live_", "rk_live_")):
        return "live"
    if key.startswith(("sk_test_", "rk_test_")):
        return "test"
    return "unrecognised"


def money(amount: int, currency: str) -> str:
    return f"{amount / 100:,.2f} {currency.upper()}"


def cadence(price: dict[str, Any]) -> str:
    count = int(price.get("interval_count", 1) or 1)
    return f"every {price['interval']}" if count == 1 else f"every {count} {price['interval']}s"


def validate(catalogue: dict) -> list[str]:
    """Everything wrong with the file, all of it, before anything is created.

    Reporting one error per run turns a four-product catalogue into four
    round-trips, and a partial create is the worst state to stop in.
    """
    problems: list[str] = []
    products = catalogue.get("products")
    if not isinstance(products, list) or not products:
        return ['"products" must be a non-empty list']

    seen_names: set[str] = set()
    for i, product in enumerate(products):
        where = f"products[{i}]"
        name = product.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f'{where}: "name" is required')
        elif name in seen_names:
            problems.append(f'{where}: duplicate product name "{name}"')
        else:
            seen_names.add(name)

        prices = product.get("prices")
        if not isinstance(prices, list) or not prices:
            problems.append(f'{where}: "prices" must be a non-empty list')
            continue

        seen_keys: set[tuple] = set()
        for j, price in enumerate(prices):
            at = f"{where}.prices[{j}]"
            tier = price.get("tier")
            if not isinstance(tier, str) or not tier.strip():
                problems.append(f'{at}: "tier" is required')
            amount = price.get("amount")
            # A bool is an int in Python, and 0 is a legitimate amount, so this
            # cannot be a truthiness check.
            if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
                problems.append(f'{at}: "amount" must be a non-negative integer of minor units')
            currency = price.get("currency", "usd")
            if not isinstance(currency, str) or len(currency) != 3:
                problems.append(f'{at}: "currency" must be a 3-letter code')
            interval = price.get("interval", "month")
            if interval not in VALID_INTERVALS:
                problems.append(f'{at}: "interval" must be one of {sorted(VALID_INTERVALS)}')
            count = price.get("interval_count", 1)
            if not isinstance(count, int) or isinstance(count, bool) or count < 1:
                problems.append(f'{at}: "interval_count" must be a positive integer')

            # The platform stores one price per (app, tier, interval,
            # interval_count), so two here would mean the second silently
            # fails to register later.
            key = (tier, interval, count)
            if key in seen_keys:
                problems.append(f"{at}: duplicate tier/interval {key} within this product")
            seen_keys.add(key)
    return problems


def find_product(existing: list[dict], name: str) -> dict | None:
    return next((p for p in existing if p.get("name") == name), None)


def find_price(existing: list[dict], product_id: str, want: dict) -> dict | None:
    """An active recurring price on this product that already bills exactly this."""
    for price in existing:
        product = price.get("product")
        if (product.get("id") if isinstance(product, dict) else product) != product_id:
            continue
        recurring = price.get("recurring") or {}
        if (
            price.get("unit_amount") == want["amount"]
            and price.get("currency") == want["currency"]
            and recurring.get("interval") == want["interval"]
            and int(recurring.get("interval_count") or 1) == want["interval_count"]
        ):
            return price
    return None


def normalise(price: dict) -> dict:
    return {
        "tier": price["tier"],
        "amount": price["amount"],
        "currency": price.get("currency", "usd").lower(),
        "interval": price.get("interval", "month"),
        "interval_count": int(price.get("interval_count", 1)),
    }


def run(key: str, catalogue: dict, apply: bool) -> list[dict]:
    products = _page_all(key, "products?active=true")
    prices = _page_all(key, "prices?active=true&expand[]=data.product")
    rows: list[dict] = []

    for spec in catalogue["products"]:
        name = spec["name"]
        product = find_product(products, name)
        if product:
            action = "exists"
        elif apply:
            form = {"name": name}
            if spec.get("description"):
                form["description"] = spec["description"]
            product = _request(key, "POST", "products", form)
            products.append(product)
            action = "created"
        else:
            product = None
            action = "would create"

        for raw in spec["prices"]:
            want = normalise(raw)
            found = find_price(prices, product["id"], want) if product else None
            if found:
                price_action = "exists"
            elif apply and product:
                found = _request(
                    key,
                    "POST",
                    "prices",
                    {
                        "product": product["id"],
                        "unit_amount": want["amount"],
                        "currency": want["currency"],
                        "recurring[interval]": want["interval"],
                        "recurring[interval_count]": want["interval_count"],
                    },
                )
                prices.append(found)
                price_action = "created"
            else:
                price_action = "would create"

            rows.append(
                {
                    "app": spec.get("app", ""),
                    "product": name,
                    "product_action": action,
                    "product_id": product["id"] if product else "",
                    "tier": want["tier"],
                    "price_id": found["id"] if found else "",
                    "price_action": price_action,
                    "amount": money(want["amount"], want["currency"]),
                    "cadence": cadence(want),
                }
            )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("catalogue", help="path to the catalogue JSON")
    parser.add_argument("--apply", action="store_true", help="create what is missing (default: dry run)")
    parser.add_argument(
        "--live",
        action="store_true",
        help="required to --apply with a live key; a live run otherwise looks like a test run",
    )
    args = parser.parse_args(argv)

    key = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        print("STRIPE_SECRET_KEY is not set in the environment.", file=sys.stderr)
        return 2
    mode = mode_of(key)
    if mode == "unrecognised":
        print(
            "STRIPE_SECRET_KEY is not a secret key (expected sk_test_/sk_live_/rk_test_/rk_live_). "
            "A publishable key cannot create anything.",
            file=sys.stderr,
        )
        return 2
    if mode == "live" and args.apply and not args.live:
        print(
            "Refusing: the key is LIVE and --live was not given. Prices created with a live key "
            "are what real customers are charged. Re-run with --live if that is what you mean.",
            file=sys.stderr,
        )
        return 2

    try:
        with open(args.catalogue, encoding="utf-8") as handle:
            catalogue = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cannot read {args.catalogue}: {exc}", file=sys.stderr)
        return 2

    problems = validate(catalogue)
    if problems:
        print("Catalogue is not valid:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 2

    print(f"Stripe mode: {mode.upper()}    {'APPLYING' if args.apply else 'dry run'}")
    try:
        rows = run(key, catalogue, args.apply)
    except StripeError as exc:
        print(f"Stripe: {exc}", file=sys.stderr)
        return 1

    width = max((len(r["app"] or r["product"]) for r in rows), default=3)
    print()
    for row in rows:
        print(
            f"{(row['app'] or row['product']).ljust(width)}  {row['tier']:<10} "
            f"{row['amount']:>12}  {row['cadence']:<16} "
            f"{row['price_id'] or '-':<32} ({row['price_action']})"
        )

    pending = [r for r in rows if r["price_action"] == "would create"]
    if pending:
        print(f"\n{len(pending)} price(s) not created. Re-run with --apply.")
    else:
        print("\nRegister each price id against its app in the console: Apps -> app -> Prices.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
