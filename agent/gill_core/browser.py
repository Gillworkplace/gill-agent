"""CDP 浏览器客户端：连接沙箱内 Chromium、页面控制、Screencast 投屏、交互回注（FR-41~46）。

通路（memory 固化）：http://<api_host>/sandbox/<sid>/9223/<path> + Host: 127.0.0.1
（path 路由不依赖 Host；127.0.0.1 为 IP 型 Host，通过 DevTools DNS-rebinding 防护）
传输：httpx-ws（支持覆盖 Host 头；websockets 库不支持）。
"""
from __future__ import annotations
import asyncio
import json
import logging
import time

log = logging.getLogger("gill.browser")

QUALITY_LEVELS = {"low": (960, 600, 40, 2), "mid": (1280, 800, 60, 1), "high": (1280, 800, 70, 1)}


class BrowserSession:
    """一个沙箱的浏览器会话（第一个 page target）。"""

    def __init__(self, sandbox, emit, quality: str = "mid"):
        self.sb = sandbox
        self.emit = emit                       # async (type, payload) -> None
        self.quality = quality
        self._ws = None
        self._ctx = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._meta: dict = {}
        self._running = False

    async def _targets(self):
        import httpx
        base, _ = self.sb.cdp_url(9223)
        async with httpx.AsyncClient(trust_env=False, timeout=15) as c:
            r = await c.get(base + "/json/list", headers={"Host": "127.0.0.1"})
            r.raise_for_status()
            return r.json()

    async def connect(self):
        from httpx_ws import aconnect_ws
        targets = await self._targets()
        page = next((t for t in targets if t.get("type") == "page"), targets[0] if targets else None)
        if not page:
            raise RuntimeError("no page target")
        base, _ = self.sb.cdp_url(9223)
        tail = page["webSocketDebuggerUrl"].split("/", 3)[3]
        url = base + "/" + tail
        self._ctx = aconnect_ws(url, headers={"Host": "127.0.0.1"}, timeout=30)
        self._ws = await self._ctx.__aenter__()
        self._running = True
        asyncio.create_task(self._reader())
        await self._send("Page.enable")
        log.info("CDP connected: %s", url[:90])

    async def _send(self, method: str, params: dict | None = None) -> dict:
        self._msg_id += 1
        mid = self._msg_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        await self._ws.send_json({"id": mid, "method": method, "params": params or {}})
        return await asyncio.wait_for(fut, 20)

    async def _reader(self):
        try:
            while self._running:
                msg = await self._ws.receive_json()
                if "id" in msg and msg["id"] in self._pending:
                    self._pending.pop(msg["id"]).set_result(msg.get("result", {}))
                elif msg.get("method") == "Page.screencastFrame":
                    await self._on_frame(msg["params"])
        except Exception as e:
            if self._running:
                log.warning("CDP reader exit: %s", e)
                await self.emit("session_status", {"status": "browser_disconnected"})

    # ---------- 投屏 ----------
    async def start_screencast(self, quality: str | None = None):
        if quality:
            self.quality = quality
        w, h, q, nth = QUALITY_LEVELS.get(self.quality, QUALITY_LEVELS["mid"])
        await self._send("Page.startScreencast", {
            "format": "jpeg", "quality": q, "maxWidth": w, "maxHeight": h, "everyNthFrame": nth})
        log.info("screencast started (%s)", self.quality)

    async def stop_screencast(self):
        try:
            await self._send("Page.stopScreencast")
        except Exception:
            pass

    async def _on_frame(self, p: dict):
        self._meta = {"width": p["metadata"].get("deviceWidth"),
                      "height": p["metadata"].get("deviceHeight"),
                      "scale": p["metadata"].get("pageScaleFactor", 1),
                      "offsetTop": p["metadata"].get("offsetTop", 0),
                      "ts": int(time.time() * 1000)}
        await self.emit("screencast_meta", self._meta)
        await self.emit("screencast_frame", {"data": p["data"], "ts": self._meta["ts"]})
        try:
            await self._send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})
        except Exception:
            pass

    # ---------- 控制 ----------
    async def navigate(self, url: str):
        await self._send("Page.navigate", {"url": url})

    async def eval(self, expr: str):
        r = await self._send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("value")

    # ---------- 交互回注（FR-43，坐标换算 01 §11.5.2）----------
    async def input_event(self, p: dict):
        kind = p.get("kind")
        m = self._meta or {}
        scale = max(0.01, float(m.get("scale") or 1))
        if kind in ("mouse_down", "mouse_up", "mouse_click"):
            btn = {"left": "left", "middle": "middle", "right": "right"}[p.get("button", "left")]
            await self._send("Input.dispatchMouseEvent", {
                "type": "mouseReleased" if kind == "mouse_up" else "mousePressed",
                "x": float(p.get("x", 0)), "y": float(p.get("y", 0)) / scale + m.get("offsetTop", 0),
                "button": btn, "clickCount": 1})
            if kind == "mouse_click":   # 补一个 released
                await self._send("Input.dispatchMouseEvent", {
                    "type": "mouseReleased", "x": float(p.get("x", 0)),
                    "y": float(p.get("y", 0)) / scale + m.get("offsetTop", 0),
                    "button": btn, "clickCount": 1})
        elif kind == "key":
            k = p.get("key", "")
            mapping = {"Enter": "\r", "Backspace": "\b", "Tab": "\t"}
            await self._send("Input.dispatchKeyEvent", {"type": "char", "text": mapping.get(k, k)})
        elif kind == "type":
            await self._send("Input.insertText", {"text": p.get("text", "")})

    async def close(self):
        self._running = False
        try:
            if self._ctx:
                await self._ctx.__aexit__(None, None, None)
        except Exception:
            pass
