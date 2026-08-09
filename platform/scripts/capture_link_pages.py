# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Capture the platform-hosted pages that email links land on.

Reads real URLs (produced by get_link_urls.ps1 from actual Mailpit messages)
and shoots each page, cropped to the card.

Usage: python capture_link_pages.py <urls.json> <output-dir>
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
PORT = 9338
URLS = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
OUT = Path(sys.argv[2])

SHOTS = [
    ("link-invite-accept", URLS["invite"]),
    ("link-password-reset", URLS["reset"]),
    ("link-email-verified", URLS["verify"]),
]


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
    profile = tempfile.mkdtemp(prefix="evo-link-shots-")
    proc = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}", "--window-size=900,760",
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
                "width": 900, "height": 760, "deviceScaleFactor": 2, "mobile": False,
            })
            OUT.mkdir(parents=True, exist_ok=True)

            for name, url in SHOTS:
                await cdp.cmd("Page.navigate", {"url": url})
                await asyncio.sleep(2.5)
                box = (await cdp.cmd("Runtime.evaluate", {
                    "expression": """
                      (() => {
                        const c = document.querySelector('.card');
                        if (!c) return null;
                        const r = c.getBoundingClientRect();
                        return {x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 40),
                                w: r.width + 80, h: r.height + 80};
                      })()
                    """,
                    "returnByValue": True,
                }))["result"].get("value")
                params = {"format": "png", "fromSurface": True}
                if box:
                    params["clip"] = {"x": box["x"], "y": box["y"],
                                      "width": box["w"], "height": box["h"], "scale": 1}
                data = base64.b64decode((await cdp.cmd("Page.captureScreenshot", params))["data"])
                (OUT / f"{name}.png").write_bytes(data)
                print(f"saved {name}.png ({len(data)//1024} KB)")
    finally:
        proc.terminate()


asyncio.run(main())
