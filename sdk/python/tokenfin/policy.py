"""
Org policy enforced client-side by the wrappers: model routes (rewrite
``model`` before the call) and — only when the app opts in with
``enforce_policy=True`` — blocked models.

Fetched from ``GET /api/v1/policy`` with the client's API key (read or ingest
scope) on a background thread, refreshed every ``ttl_seconds`` (60). Fail
open: no policy / an error / an older server → calls go through unchanged.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

from .utils import SDK_VERSION

logger = logging.getLogger("tokenfin")

DEFAULT_TTL = 60.0
ERROR_RETRY = 30.0


class TokenFinPolicyError(Exception):
    """Raised by a wrapped client for a blocked model when ``enforce_policy=True``."""

    code = "model_blocked"

    def __init__(self, model: str) -> None:
        self.model = model
        super().__init__(
            f'TokenFin policy blocks model "{model}" for this organization (a usage limit was reached). '
            "Ask an admin to lift the block on the TokenFin Limits page, or use another model.")


def _norm(m: str) -> str:
    return m.strip().lower()


def find_route(policy: Optional[Dict[str, Any]], model: str) -> Optional[Dict[str, Any]]:
    """The route for ``model``: exact match first, then the longest prefix route."""
    if not policy or not model:
        return None
    m = _norm(model)
    routes = [r for r in policy.get("routes") or [] if isinstance(r, dict)
              and isinstance(r.get("from"), str) and isinstance(r.get("to"), str)]
    for r in routes:
        if _norm(r["from"]) == m:
            return r
    best = None
    for r in routes:
        if r.get("match") == "prefix" and m.startswith(_norm(r["from"])):
            if best is None or len(r["from"]) > len(best["from"]):
                best = r
    return best


def is_model_blocked(policy: Optional[Dict[str, Any]], model: str) -> bool:
    if not policy or not model:
        return False
    m = _norm(model)
    return any(isinstance(b, str) and m.startswith(_norm(b)) for b in policy.get("blocked_models") or [])


# fetcher(etag) -> ("ok", policy, etag) | ("not_modified",) | ("unavailable",) | ("error",)
Fetcher = Callable[[Optional[str]], Tuple[Any, ...]]


def fetch_policy_urllib(base: str, api_key: str, timeout: float) -> Fetcher:
    def fetch(etag: Optional[str]) -> Tuple[Any, ...]:
        headers = {"Authorization": f"Bearer {api_key}", "X-TokenFin-SDK": f"python/{SDK_VERSION}",
                   "User-Agent": f"tokenfin-python/{SDK_VERSION}"}
        if etag:
            headers["If-None-Match"] = etag
        req = urllib.request.Request(base + "/api/v1/policy", headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read() or b"null")
                if not isinstance(body, dict) or not isinstance(body.get("routes"), list):
                    return ("error",)
                return ("ok", body, resp.headers.get("ETag"))
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return ("not_modified",)
            if e.code in (401, 403, 404):
                logger.debug("tokenfin: policy unavailable (HTTP %s) — routing off", e.code)
                return ("unavailable",)
            return ("error",)
        except Exception as e:  # never log headers (Bearer token)
            logger.debug("tokenfin: policy fetch failed: %s", type(e).__name__)
            return ("error",)
    return fetch


class PolicyManager:
    """Background-refreshed policy cache. Thread-safe; never raises."""

    def __init__(self, fetcher: Fetcher, ttl: float = DEFAULT_TTL) -> None:
        self._fetcher = fetcher
        self._ttl = ttl
        self._policy: Optional[Dict[str, Any]] = None
        self._etag: Optional[str] = None
        self._next_at = 0.0
        self._lock = threading.Lock()
        self._inflight = False
        self._settled = threading.Event()
        self.fetches = 0

    def current(self) -> Optional[Dict[str, Any]]:
        return self._policy

    @property
    def settled(self) -> bool:
        """True once the first fetch has finished (successfully or not)."""
        return self._settled.is_set()

    def refresh(self, force: bool = False) -> None:
        """Start a background refresh when stale. Returns immediately."""
        with self._lock:
            if self._inflight or (not force and time.monotonic() < self._next_at):
                return
            self._inflight = True
        threading.Thread(target=self._run, daemon=True, name="tokenfin-policy").start()

    def _run(self) -> None:
        try:
            self.fetches += 1
            r = self._fetcher(self._etag)
            now = time.monotonic()
            if r[0] == "ok":
                self._policy, self._etag = r[1], r[2]
                ttl = r[1].get("ttl_seconds")
                self._next_at = now + (float(ttl) if isinstance(ttl, (int, float)) and ttl > 0 else self._ttl)
            elif r[0] == "not_modified":
                self._next_at = now + self._ttl
            elif r[0] == "unavailable":
                self._policy, self._etag = None, None
                self._next_at = now + self._ttl
            else:
                self._next_at = now + ERROR_RETRY
        except Exception:
            self._next_at = time.monotonic() + ERROR_RETRY
        finally:
            with self._lock:
                self._inflight = False
            self._settled.set()

    def ready(self, timeout: float = 0.2) -> None:
        """Block until the first fetch finished or ``timeout`` seconds passed."""
        if self._settled.is_set():
            return
        self.refresh()
        self._settled.wait(max(0.0, timeout))

    def apply(self, params: Dict[str, Any], route: bool, enforce: bool) -> Tuple[Dict[str, Any], Optional[str]]:
        """(params with the routed model, routed_from). Raises TokenFinPolicyError when enforcing a block."""
        model = params.get("model")
        if not isinstance(model, str) or not model:
            return params, None
        try:
            self.refresh()
        except Exception:
            pass
        pol = self._policy
        if not pol:
            return params, None
        out, routed_from = params, None
        if route:
            r = find_route(pol, model)
            if r and r["to"] and r["to"] != model:
                out = dict(params)
                out["model"] = r["to"]
                routed_from = model
        if enforce and is_model_blocked(pol, out["model"]):
            raise TokenFinPolicyError(out["model"])
        return out, routed_from


__all__: List[str] = ["TokenFinPolicyError", "PolicyManager", "find_route", "is_model_blocked", "fetch_policy_urllib"]
