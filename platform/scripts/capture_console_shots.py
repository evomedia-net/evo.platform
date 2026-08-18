"""Capture admin-console screenshots via headless Chrome + CDP.

Ported from evo.ehs's scripts/capture_docs_shots.py — same pipeline (own
headless Chrome on a private port, scripted login, CDP screenshots written
to disk), retargeted at the platform console's hash-routed views.

Point it at a LOCAL instance. The console shows real workspace names, member
addresses, audit trails, mail config and revenue; a docs screenshot of a
production console publishes all of it.

Credentials come from the environment and are never written to this file:

    CONSOLE_SHOT_USER      admin email
    CONSOLE_SHOT_PASSWORD  its password
    CONSOLE_SHOT_BASE      default http://localhost:8200
    CONSOLE_SHOT_WORKSPACE blank for a platform-level account

Usage: python platform/scripts/capture_console_shots.py <output-dir> [only-name ...]
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = os.environ.get(
    "CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe"
)
PORT = int(os.environ.get("CONSOLE_SHOT_PORT", "9335"))
BASE = os.environ.get("CONSOLE_SHOT_BASE", "http://localhost:8200").rstrip("/")
SHOT_USER = os.environ.get("CONSOLE_SHOT_USER", "")
SHOT_PASSWORD = os.environ.get("CONSOLE_SHOT_PASSWORD", "")
SHOT_WORKSPACE = os.environ.get("CONSOLE_SHOT_WORKSPACE", "")
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
ONLY = set(sys.argv[2:])

# (name, hash route). Order matches the console's own nav.
PAGES = [
    ("tenants", "#/tenants"),
    ("users", "#/users"),
    ("apps", "#/apps"),
    ("revenue", "#/revenue"),
    ("audit", "#/audit"),
    ("smtp", "#/smtp"),
    ("email-copy", "#/email"),
]

# Fills the console's own form and submits it, rather than posting to
# /auth/login directly: the SPA keeps its tokens in memory after a real
# submit, so a scripted fetch would leave the app still showing the login
# card. Values are injected as JSON literals so a password containing quotes
# or backslashes cannot break out of the expression.
LOGIN_JS_TEMPLATE = """
(() => {
  const email = document.querySelector('#login-email');
  const workspace = document.querySelector('#login-workspace');
  const password = document.querySelector('#login-password');
  const form = document.querySelector('#login-form');
  if (!email || !password || !form) return 'login form not found';
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(email, __USER__);
  if (workspace) set(workspace, __WORKSPACE__);
  set(password, __PASS__);
  form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }));
  return 'submitted';
})()
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
    if not SHOT_USER or not SHOT_PASSWORD:
        print("Set CONSOLE_SHOT_USER and CONSOLE_SHOT_PASSWORD in the environment.")
        return 2
    if "localhost" not in BASE and "127.0.0.1" not in BASE:
        print(f"Refusing to shoot {BASE}: point this at a local instance.")
        print("A console screenshot publishes real workspaces, members and revenue.")
        print("Override deliberately with CONSOLE_SHOT_ALLOW_REMOTE=1.")
        if os.environ.get("CONSOLE_SHOT_ALLOW_REMOTE") != "1":
            return 2

    profile = tempfile.mkdtemp(prefix="evo-console-shots-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}", "--window-size=1600,1000",
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
                "width": 1600, "height": 1000, "deviceScaleFactor": 2, "mobile": False,
            })

            async def goto(url, settle=2.5):
                await cdp.cmd("Page.navigate", {"url": url})
                await asyncio.sleep(settle)

            async def js(expr):
                r = await cdp.cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("value")

            async def shot(name):
                data = base64.b64decode(
                    (await cdp.cmd("Page.captureScreenshot",
                                   {"format": "png", "fromSurface": True}))["data"]
                )
                out = OUT / f"console-{name}.png"
                out.write_bytes(data)
                print(f"saved {out} ({len(data)//1024} KB)")

            OUT.mkdir(parents=True, exist_ok=True)

            # Signed out first — the login card is gone once a session exists.
            await goto(BASE, 2.0)
            if not ONLY or "login" in ONLY:
                await shot("login")

            print("login:", await js(
                LOGIN_JS_TEMPLATE
                .replace("__USER__", json.dumps(SHOT_USER))
                .replace("__PASS__", json.dumps(SHOT_PASSWORD))
                .replace("__WORKSPACE__", json.dumps(SHOT_WORKSPACE))
            ))
            await asyncio.sleep(3.0)

            signed_in = await js("!document.querySelector('#app-view').hidden")
            if not signed_in:
                err = await js("(document.querySelector('#login-error')||{}).textContent || ''")
                print(f"login failed: {err.strip() or 'still on the login card'}")
                return 1

            for name, route in PAGES:
                if ONLY and name not in ONLY:
                    continue
                await goto(f"{BASE}/{route}", 2.5)
                await shot(name)
        return 0
    finally:
        proc.terminate()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
