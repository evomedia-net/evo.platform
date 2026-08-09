# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Capture admin-console screenshots via headless Chrome + CDP.

Feeds the documentation site's EvoPlatform pages. Runs against the LOCAL DEV
server and its seeded, fictional data (Acme/Globex demo tenants) — never a
real deployment, so nothing customer-identifying can land in public docs.

Prereqs: dev stack up (`docker compose up -d`, `npm run start:dev`), seeded
demo data, and `pip install websockets`.

Usage: python scripts/capture_console_shots.py <output-dir> [only-name ...]
"""
import asyncio
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9336
BASE = "http://127.0.0.1:8200"
EMAIL = "admin@example.com"
PASSWORD = "EvoDevAdmin!2026"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
ONLY = set(sys.argv[2:])

# (name, hash-route, optional pre-shot JS)
PAGES = [
    ("console-tenants", "#/tenants", None),
    ("console-users", "#/users", None),
    ("console-apps", "#/apps", None),
    ("console-audit", "#/audit", None),
    ("console-smtp", "#/smtp", None),
    # Overlays: open, let the animation settle, then shoot.
    ("console-new-tenant", "#/tenants", "document.querySelector('#new-tenant-btn').click(), 'opened'"),
    ("console-new-user", "#/users", "document.querySelector('#new-user-btn').click(), 'opened'"),
]

LOGIN_JS = f"""
(() => {{
  const email = document.querySelector('#login-email');
  const pass = document.querySelector('#login-password');
  if (!email || !pass) return 'no login form (already signed in?)';
  email.value = {EMAIL!r};
  pass.value = {PASSWORD!r};
  document.querySelector('form').requestSubmit();
  return 'submitted';
}})()
"""


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 1

    async def cmd(self, method, params=None):
        mid = self.next_id
        self.next_id += 1
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})


async def main():
    profile = tempfile.mkdtemp(prefix="evo-console-shots-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}", "--window-size=1500,950",
        "--hide-scrollbars", "about:blank",
    ])
    try:
        ws_url = None
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
                    tabs = json.loads(r.read())
                pages = [t for t in tabs if t.get("type") == "page"]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws_url:
            raise RuntimeError("Chrome debug endpoint never came up")

        async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.cmd("Page.enable")
            await cdp.cmd("Runtime.enable")
            await cdp.cmd("Emulation.setDeviceMetricsOverride", {
                "width": 1500, "height": 950, "deviceScaleFactor": 2, "mobile": False,
            })

            async def goto(url, settle=2.5):
                await cdp.cmd("Page.navigate", {"url": url})
                await asyncio.sleep(settle)

            async def js(expr):
                r = await cdp.cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("value")

            # Crop to where content actually ends — the console's cards rarely
            # fill a 950px viewport, and docs shouldn't ship the dead space.
            CONTENT_HEIGHT_JS = """
            (() => {
              const modal = document.querySelector('#modal');
              if (modal && !modal.hidden) return 0;            // overlay: full frame
              // #content stretches to fill the viewport, so measure the cards
              // inside it — the last one's bottom is where content really ends.
              const kids = [...document.querySelectorAll('#content > *')]
                .filter((k) => k.getBoundingClientRect().height > 0);
              if (!kids.length) return 0;
              return Math.ceil(Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))) + 20;
            })()
            """

            async def shot(name):
                params = {"format": "png", "fromSurface": True}
                height = await js(CONTENT_HEIGHT_JS)
                if height:
                    params["clip"] = {
                        "x": 0, "y": 0, "width": 1500,
                        "height": min(max(int(height), 320), 950), "scale": 1,
                    }
                data = base64.b64decode(
                    (await cdp.cmd("Page.captureScreenshot", params))["data"]
                )
                out = OUT / f"{name}.png"
                out.write_bytes(data)
                print(f"saved {out} ({len(data)//1024} KB)")

            OUT.mkdir(parents=True, exist_ok=True)

            # Sign-in screen first — it can't be captured once a session exists.
            if not ONLY or "console-login" in ONLY:
                await goto(BASE, 2.5)
                await shot("console-login")

            await goto(BASE, 2.5)
            print("login:", await js(LOGIN_JS))
            await asyncio.sleep(3)
            # The sign-in view is hidden rather than removed, so presence of the
            # form proves nothing — the stored session token does.
            if not await js("sessionStorage.getItem('evoadmin.access')"):
                raise RuntimeError("login failed — no session token stored")

            for name, route, pre_js in PAGES:
                if ONLY and name not in ONLY:
                    continue
                # Force a re-render even when the hash is unchanged.
                await js("location.hash = '#/'")
                await asyncio.sleep(0.4)
                await js(f"location.hash = {route!r}")
                await asyncio.sleep(2.5)
                if pre_js:
                    print(f"{name} pre-shot:", await js(pre_js))
                    await asyncio.sleep(1.2)
                await shot(name)
    finally:
        proc.terminate()


asyncio.run(main())
