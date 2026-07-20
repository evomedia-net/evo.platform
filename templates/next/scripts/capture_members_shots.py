"""Capture app-side member/billing screenshots (SWAG in platform mode).

Runs against local dev with the platform's fictional seed data (Acme demo
workspace, owner@acme.example). Companion to the platform's
capture_console_shots.py.

Usage: python capture_members_shots.py <output-dir>
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
PORT = 9337
BASE = "http://127.0.0.1:4173"
WORKSPACE = "acme"
EMAIL = "owner@acme.example"
PASSWORD = "EvoDevOwner!2026"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")

LOGIN_JS = f"""
(() => {{
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const fill = (sel, v) => {{
    const el = document.querySelector(sel);
    if (!el) return false;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', {{bubbles: true}}));
    return true;
  }};
  fill('#workspace', {WORKSPACE!r});
  if (!fill('#email', {EMAIL!r}) || !fill('#password', {PASSWORD!r})) return 'no login form';
  setTimeout(() => document.querySelector('form').requestSubmit(), 250);
  return 'submitted';
}})()
"""

SUDO_JS = f"""
(() => {{
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const el = document.querySelector('#sudo-password');
  if (!el) return 'no sudo field (already unlocked?)';
  setter.call(el, {PASSWORD!r});
  el.dispatchEvent(new Event('input', {{bubbles: true}}));
  setTimeout(() => el.closest('form').requestSubmit(), 250);
  return 'unlocking';
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
    profile = tempfile.mkdtemp(prefix="evo-members-shots-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}", "--window-size=1400,900",
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
                "width": 1400, "height": 900, "deviceScaleFactor": 2, "mobile": False,
            })

            async def goto(url, settle=4.0):
                await cdp.cmd("Page.navigate", {"url": url})
                await asyncio.sleep(settle)

            async def js(expr):
                r = await cdp.cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("value")

            # Next.js injects a dev-only overlay badge; it must not ship in docs.
            CLEAN_JS = "document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()), 'cleaned'"

            async def shot(name, selector=None):
                await js(CLEAN_JS)
                params = {"format": "png", "fromSurface": True}
                if selector:
                    box = await js(f"""
                      (() => {{
                        const el = document.querySelector({selector!r});
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        return {{x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16),
                                 w: Math.min(1400, r.width + 32), h: r.height + 32}};
                      }})()
                    """)
                    if box:
                        params["clip"] = {"x": box["x"], "y": box["y"],
                                          "width": box["w"], "height": box["h"], "scale": 1}
                else:
                    # Crop to the last card so docs don't ship half a blank page.
                    bottom = await js("""
                      (() => {
                        const kids = [...document.querySelectorAll('main *')]
                          .filter((k) => k.getBoundingClientRect().height > 40);
                        if (!kids.length) return 0;
                        return Math.ceil(Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))) + 24;
                      })()
                    """)
                    if bottom:
                        params["clip"] = {"x": 0, "y": 0, "width": 1400,
                                          "height": min(max(int(bottom), 300), 900), "scale": 1}
                data = base64.b64decode(
                    (await cdp.cmd("Page.captureScreenshot", params))["data"]
                )
                out = OUT / f"{name}.png"
                out.write_bytes(data)
                print(f"saved {out} ({len(data)//1024} KB)")

            OUT.mkdir(parents=True, exist_ok=True)

            await goto(f"{BASE}/login", 5)
            await shot("app-login")
            print("login:", await js(LOGIN_JS))
            await asyncio.sleep(7)
            print("after login:", await js("location.pathname"))

            await goto(f"{BASE}/members", 5)
            await shot("members-locked", "main div")
            print("sudo:", await js(SUDO_JS))
            await asyncio.sleep(6)
            await shot("members-list")
            print("invite form:", await js("""
              (() => {
                const b = [...document.querySelectorAll('button')]
                  .find(x => /invite member/i.test(x.textContent));
                if (b) b.click();
                return b ? 'opened' : 'invite button not found';
              })()
            """))
            await asyncio.sleep(1.5)
            await shot("members-invite")
    finally:
        proc.terminate()


asyncio.run(main())
