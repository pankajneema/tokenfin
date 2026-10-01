"""
Auto-instrumentation for the official ``anthropic`` and ``openai`` SDKs.

Both wrappers patch the client IN PLACE and return the same client. Return
values are the SDK's own objects: streams keep their identity and exact type
(the stream's internal iterator is wrapped to observe events). Any failure
inside TokenFin is swallowed; SDK errors propagate unchanged.

``anthropic`` and ``openai`` are optional — nothing here imports them.

    from anthropic import Anthropic
    from tokenfin import TokenFinClient, wrap_anthropic

    tf = TokenFinClient(api_key="tfk_...")
    client = wrap_anthropic(Anthropic(), tf, user_email="dev@acme.com")
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from typing import Any, Callable, Dict, Optional, Tuple

from .policy import TokenFinPolicyError

logger = logging.getLogger("tokenfin")

_MARK = "__tokenfin_wrapped__"
_OBS = "_tokenfin_observer"


class _Opts:
    def __init__(self, capture_prompts: bool = False, max_prompt_chars: Optional[int] = None,
                 project_id: Optional[str] = None, user_email: Optional[str] = None,
                 session_id: Optional[str] = None, tags: Optional[Dict[str, str]] = None,
                 metadata: Optional[Dict[str, Any]] = None, source: str = "sdk",
                 route_models: bool = True, enforce_policy: bool = False,
                 policy_wait_ms: float = 200) -> None:
        self.capture_prompts = capture_prompts
        self.max_prompt_chars = max_prompt_chars
        self.project_id = project_id
        self.user_email = user_email
        self.session_id = session_id
        self.tags = tags
        self.metadata = metadata
        self.source = source
        self.route_models = route_models
        self.enforce_policy = enforce_policy
        self.policy_wait_ms = policy_wait_ms


class _Gate:
    """Model routes / blocks from the org policy (tf.policy()). Fail open."""

    def __init__(self, tf: Any, opts: _Opts) -> None:
        self.opts = opts
        self.pm = tf.policy()
        self.pm.refresh()  # prefetch in the background

    @staticmethod
    def make(tf: Any, opts: _Opts) -> Optional["_Gate"]:
        if not opts.route_models and not opts.enforce_policy:
            return None
        try:
            return _Gate(tf, opts) if callable(getattr(tf, "policy", None)) else None
        except Exception:
            return None

    def apply(self, kwargs: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[str]]:
        try:
            return self.pm.apply(kwargs, self.opts.route_models, self.opts.enforce_policy)
        except TokenFinPolicyError:
            raise
        except Exception:
            return kwargs, None

    def wait_seconds(self) -> float:
        try:
            return 0.0 if self.pm.settled else max(0.0, float(self.opts.policy_wait_ms) / 1000.0)
        except Exception:
            return 0.0


def _g(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _n(v: Any) -> int:
    try:
        n = int(v or 0)
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


# ── collectors ────────────────────────────────────────────────────────────────

class _Collector:
    def __init__(self) -> None:
        self.model: Optional[str] = None
        self.usage: Optional[Dict[str, int]] = None

    def final(self, res: Any) -> None: ...

    def chunk(self, ev: Any) -> bool:
        return True


class _AnthropicCollector(_Collector):
    def _apply(self, usage: Any) -> None:
        if usage is None:
            return
        u = self.usage or {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        for src, dst in (("input_tokens", "input"), ("output_tokens", "output"),
                         ("cache_read_input_tokens", "cache_read"),
                         ("cache_creation_input_tokens", "cache_write")):
            v = _g(usage, src)
            if v is not None:
                u[dst] = _n(v)
        self.usage = u

    def final(self, res: Any) -> None:
        self.model = _g(res, "model")
        self._apply(_g(res, "usage"))

    def chunk(self, ev: Any) -> bool:
        t = _g(ev, "type")
        if t == "message_start":
            msg = _g(ev, "message")
            self.model = _g(msg, "model") or self.model
            self._apply(_g(msg, "usage"))
        elif t == "message_delta":
            self._apply(_g(ev, "usage"))  # output_tokens is cumulative
        return True


def _openai_usage(usage: Any) -> Dict[str, int]:
    prompt = _n(_g(usage, "prompt_tokens") if _g(usage, "prompt_tokens") is not None else _g(usage, "input_tokens"))
    details = _g(usage, "prompt_tokens_details") or _g(usage, "input_tokens_details")
    cached = _n(_g(details, "cached_tokens"))
    out = _g(usage, "completion_tokens")
    if out is None:
        out = _g(usage, "output_tokens")
    return {"input": max(0, prompt - cached), "output": _n(out), "cache_read": cached, "cache_write": 0}


class _OpenAIChatCollector(_Collector):
    def __init__(self, injected: bool) -> None:
        super().__init__()
        self.injected = injected

    def final(self, res: Any) -> None:
        self.model = _g(res, "model")
        if _g(res, "usage") is not None:
            self.usage = _openai_usage(_g(res, "usage"))

    def chunk(self, ch: Any) -> bool:
        if _g(ch, "model"):
            self.model = _g(ch, "model")
        usage = _g(ch, "usage")
        if usage is not None:
            self.usage = _openai_usage(usage)
        choices = _g(ch, "choices")
        # Hide the usage-only trailer we requested so `chunk.choices[0]` keeps working.
        return not (self.injected and usage is not None and isinstance(choices, list) and not choices)


class _OpenAIResponsesCollector(_Collector):
    def final(self, res: Any) -> None:
        self.model = _g(res, "model")
        if _g(res, "usage") is not None:
            self.usage = _openai_usage(_g(res, "usage"))

    def chunk(self, ev: Any) -> bool:
        r = _g(ev, "response")
        if _g(r, "model"):
            self.model = _g(r, "model")
        if _g(r, "usage") is not None:
            self.usage = _openai_usage(_g(r, "usage"))
        return True


# ── observation ───────────────────────────────────────────────────────────────

class _Observer:
    def __init__(self, tf: Any, opts: _Opts, provider: str, params: Dict[str, Any],
                 collector: _Collector, started: float, routed_from: Optional[str] = None) -> None:
        self.tf, self.opts, self.provider, self.params = tf, opts, provider, params
        self.collector, self.started = collector, started
        self.routed_from = routed_from
        self.done = False
        self.first_at: Optional[float] = None

    def on_chunk(self, item: Any) -> bool:
        try:
            if self.first_at is None:
                self.first_at = time.monotonic()
            return self.collector.chunk(item)
        except Exception:
            return True

    def finish(self, extra: Optional[Dict[str, Any]] = None) -> None:
        if self.done:
            return
        self.done = True
        try:
            u = self.collector.usage
            if not u or sum(u.values()) <= 0:
                return
            meta: Dict[str, Any] = dict(self.opts.metadata or {})
            if self.routed_from:
                meta["routed_from"] = self.routed_from
            meta.update(extra or {})
            if self.first_at is not None:
                meta["ttft_ms"] = round((self.first_at - self.started) * 1000)
            fields: Dict[str, Any] = dict(
                cache_read_tokens=u["cache_read"] or None,
                cache_write_tokens=u["cache_write"] or None,
                latency_ms=round((time.monotonic() - self.started) * 1000),
                provider=self.provider, source=self.opts.source, tool=f"{self.provider}-sdk",
                project_id=self.opts.project_id, user_email=self.opts.user_email,
                session_id=self.opts.session_id, tags=self.opts.tags, metadata=meta or None,
            )
            if self.opts.capture_prompts:
                text = last_user_text(self.params)
                if text:
                    # Full prompt by default; max_prompt_chars caps it only when set.
                    m = self.opts.max_prompt_chars
                    fields["prompt_text"] = text[:m] if m and m > 0 else text
            model = self.collector.model or self.params.get("model") or "unknown"
            self.tf.track(str(model), u["input"], u["output"], **fields)
        except Exception as e:
            logger.debug("tokenfin wrapper: failed to record usage: %s", e)


def _is_stream(value: Any) -> Tuple[bool, bool]:
    """(is_sync_stream, is_async_stream). Responses carry `usage`; streams don't."""
    if value is None or _g(value, "usage") is not None or isinstance(value, (dict, list, str, bytes)):
        return False, False
    cls = type(value)
    return hasattr(cls, "__iter__") and hasattr(cls, "__next__"), hasattr(cls, "__aiter__")


_subclass_cache: Dict[Tuple[type, str], type] = {}


def _swap_class(obj: Any, kind: str, body: Dict[str, Any]) -> bool:
    cls = type(obj)
    key = (cls, kind)
    sub = _subclass_cache.get(key)
    if sub is None:
        sub = type(cls.__name__, (cls,), {**body, "__module__": cls.__module__, "__qualname__": cls.__qualname__})
        _subclass_cache[key] = sub
    try:
        obj.__class__ = sub
        return True
    except TypeError:
        return False


def _sync_iter(self: Any):
    obs: _Observer = self.__dict__.get(_OBS)
    base_iter = super(type(self), self).__iter__()  # type: ignore[misc]
    status = "complete"
    try:
        for item in base_iter:
            if obs is None or obs.on_chunk(item):
                yield item
    except GeneratorExit:
        status = "aborted"
        raise
    except BaseException:
        status = "error"
        raise
    finally:
        if obs is not None:
            obs.finish({"stream": True, **({} if status == "complete" else {"stream_status": status})})


async def _async_iter(self: Any):
    obs: _Observer = self.__dict__.get(_OBS)
    base_iter = super(type(self), self).__aiter__()  # type: ignore[misc]
    status = "complete"
    try:
        async for item in base_iter:
            if obs is None or obs.on_chunk(item):
                yield item
    except GeneratorExit:
        status = "aborted"
        raise
    except BaseException:
        status = "error"
        raise
    finally:
        if obs is not None:
            obs.finish({"stream": True, **({} if status == "complete" else {"stream_status": status})})


def _wrap_iterator(it: Any, obs: _Observer):
    status = "complete"
    try:
        for item in it:
            if obs.on_chunk(item):
                yield item
    except GeneratorExit:
        status = "aborted"
        raise
    except BaseException:
        status = "error"
        raise
    finally:
        obs.finish({"stream": True, **({} if status == "complete" else {"stream_status": status})})


async def _wrap_async_iterator(it: Any, obs: _Observer):
    status = "complete"
    try:
        async for item in it:
            if obs.on_chunk(item):
                yield item
    except GeneratorExit:
        status = "aborted"
        raise
    except BaseException:
        status = "error"
        raise
    finally:
        obs.finish({"stream": True, **({} if status == "complete" else {"stream_status": status})})


def _observe(value: Any, obs: _Observer) -> Any:
    try:
        is_sync, is_async = _is_stream(value)
        if is_sync or is_async:
            # Preferred: the SDK Stream classes iterate `self._iterator` in both
            # __iter__ and __next__ — wrapping that attribute keeps the exact type
            # (anthropic's Stream metaclass rejects isinstance() for subclasses).
            inner = getattr(value, "__dict__", {}).get("_iterator")
            if is_async and inner is not None and hasattr(inner, "__anext__"):
                value._iterator = _wrap_async_iterator(inner, obs)
            elif is_sync and inner is not None and hasattr(inner, "__next__"):
                value._iterator = _wrap_iterator(inner, obs)
            else:
                # Fallback for other iterables: transparent subclass swap.
                value.__dict__[_OBS] = obs
                if is_async:
                    _swap_class(value, "aiter", {"__aiter__": _async_iter})
                else:
                    _swap_class(value, "iter", {"__iter__": _sync_iter})
        else:
            obs.collector.final(value)
            obs.finish()
    except Exception as e:
        logger.debug("tokenfin wrapper: observe failed: %s", e)
    return value


Prepare = Callable[[Dict[str, Any]], Tuple[Dict[str, Any], bool]]


def _is_async(fn: Any) -> bool:
    """async def, or a sync decorator around one (openai's @required_args keeps __wrapped__)."""
    seen = 0
    while fn is not None and seen < 5:
        if inspect.iscoroutinefunction(fn):
            return True
        fn, seen = getattr(fn, "__wrapped__", None), seen + 1
    return False


def _patch(target: Any, name: str, tf: Any, opts: _Opts, provider: str,
           make_collector: Callable[[bool], _Collector], prepare: Optional[Prepare] = None,
           gate: Optional[_Gate] = None) -> None:
    orig = getattr(target, name, None) if target is not None else None
    if orig is None or not callable(orig) or getattr(orig, _MARK, False):
        return
    is_async = _is_async(orig)

    def invoke(args: Tuple[Any, ...], kwargs: Dict[str, Any]) -> Any:
        routed, routed_from = gate.apply(kwargs) if gate is not None else (kwargs, None)
        call_kwargs, injected = routed, False
        if prepare is not None:
            try:
                call_kwargs, injected = prepare(routed)
            except Exception:
                call_kwargs, injected = routed, False
        started = time.monotonic()
        result = orig(*args, **call_kwargs)  # SDK errors propagate unchanged

        def make_obs() -> _Observer:
            return _Observer(tf, opts, provider, routed, make_collector(injected), started, routed_from)

        if inspect.isawaitable(result):
            async def awaited() -> Any:
                value = await result
                return _observe(value, make_obs())
            return awaited()
        return _observe(result, make_obs())

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        wait = gate.wait_seconds() if gate is not None else 0.0
        if wait <= 0:
            return invoke(args, kwargs)
        if is_async:
            # Wait for the first policy fetch without blocking the event loop.
            async def deferred() -> Any:
                try:
                    await asyncio.get_running_loop().run_in_executor(None, gate.pm.ready, wait)  # type: ignore[union-attr]
                except Exception:
                    pass
                r = invoke(args, kwargs)
                return await r if inspect.isawaitable(r) else r
            return deferred()
        try:
            gate.pm.ready(wait)  # type: ignore[union-attr]
        except Exception:
            pass
        return invoke(args, kwargs)

    setattr(wrapper, _MARK, True)
    wrapper.__wrapped__ = orig  # type: ignore[attr-defined]
    wrapper.__doc__ = getattr(orig, "__doc__", None)
    setattr(target, name, wrapper)


def _patch_stream_manager(target: Any, tf: Any, opts: _Opts, gate: Optional[_Gate] = None) -> None:
    """Anthropic `messages.stream()` bypasses `create`; record from the final snapshot on exit."""
    orig = getattr(target, "stream", None) if target is not None else None
    if orig is None or not callable(orig) or getattr(orig, _MARK, False):
        return

    def record(mgr: Any) -> None:
        obs: _Observer = mgr.__dict__.get(_OBS)
        if obs is None or obs.done:
            return
        for v in list(mgr.__dict__.values()):
            snap = getattr(v, "current_message_snapshot", None) if v is not obs else None
            if snap is not None:
                obs.collector.final(snap)
                obs.finish({"stream": True})
                return

    def __exit__(self: Any, *exc: Any) -> Any:
        try:
            record(self)
        except Exception:
            pass
        return super(type(self), self).__exit__(*exc)  # type: ignore[misc]

    async def __aexit__(self: Any, *exc: Any) -> Any:
        try:
            record(self)
        except Exception:
            pass
        return await super(type(self), self).__aexit__(*exc)  # type: ignore[misc]

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # Routing uses the policy already fetched (a stream manager never waits).
        routed, routed_from = gate.apply(kwargs) if gate is not None else (kwargs, None)
        mgr = orig(*args, **routed)
        try:
            mgr.__dict__[_OBS] = _Observer(tf, opts, "anthropic", routed, _AnthropicCollector(), time.monotonic(), routed_from)
            body: Dict[str, Any] = {}
            if hasattr(type(mgr), "__exit__"):
                body["__exit__"] = __exit__
            if hasattr(type(mgr), "__aexit__"):
                body["__aexit__"] = __aexit__
            if body:
                _swap_class(mgr, "stream-manager", body)
        except Exception:
            pass
        return mgr

    setattr(wrapper, _MARK, True)
    wrapper.__wrapped__ = orig  # type: ignore[attr-defined]
    setattr(target, "stream", wrapper)


# ── public API ────────────────────────────────────────────────────────────────

def wrap_anthropic(client: Any, tf: Any, **options: Any) -> Any:
    """
    Instrument an ``Anthropic`` / ``AsyncAnthropic`` client in place.

    Options: capture_prompts (default False), max_prompt_chars, project_id,
    user_email, session_id, tags, metadata, source, route_models (default True:
    rewrite ``model`` per the org's model routes), enforce_policy (default False:
    raise TokenFinPolicyError for blocked models), policy_wait_ms (default 200:
    longest the first call waits for the policy).
    """
    try:
        opts = _Opts(**options)
        gate = _Gate.make(tf, opts)
        messages = getattr(client, "messages", None)
        _patch(messages, "create", tf, opts, "anthropic", lambda _i: _AnthropicCollector(), gate=gate)
        _patch_stream_manager(messages, tf, opts, gate)
        beta_messages = getattr(getattr(client, "beta", None), "messages", None)
        _patch(beta_messages, "create", tf, opts, "anthropic", lambda _i: _AnthropicCollector(), gate=gate)
    except Exception as e:
        logger.debug("wrap_anthropic failed: %s", e)
    return client


def _openai_prepare(kwargs: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    if kwargs.get("stream") is True:
        so = kwargs.get("stream_options")
        if not (isinstance(so, dict) and so.get("include_usage")):
            new = dict(kwargs)
            new["stream_options"] = {**(so if isinstance(so, dict) else {}), "include_usage": True}
            return new, True
    return kwargs, False


def wrap_openai(client: Any, tf: Any, **options: Any) -> Any:
    """
    Instrument an ``OpenAI`` / ``AsyncOpenAI`` client in place:
    ``chat.completions.create`` and ``responses.create`` (incl. streaming).
    Streaming chat calls get ``stream_options.include_usage`` switched on
    automatically; the resulting usage-only chunk is hidden from the caller.
    """
    try:
        opts = _Opts(**options)
        gate = _Gate.make(tf, opts)
        completions = getattr(getattr(client, "chat", None), "completions", None)
        _patch(completions, "create", tf, opts, "openai", lambda inj: _OpenAIChatCollector(inj), _openai_prepare, gate)
        _patch(getattr(client, "responses", None), "create", tf, opts, "openai",
               lambda _i: _OpenAIResponsesCollector(), gate=gate)
    except Exception as e:
        logger.debug("wrap_openai failed: %s", e)
    return client


def last_user_text(params: Dict[str, Any]) -> Optional[str]:
    """Text of the last user message (chat APIs) or the Responses ``input``."""
    def content(c: Any) -> str:
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            parts = []
            for b in c:
                if isinstance(b, str):
                    parts.append(b)
                else:
                    t = _g(b, "text")
                    if isinstance(t, str):
                        parts.append(t)
            return "\n".join(p for p in parts if p)
        return ""

    msgs = params.get("messages")
    if not isinstance(msgs, list):
        msgs = params.get("input") if isinstance(params.get("input"), list) else None
    if msgs is not None:
        for m in reversed(msgs):
            if _g(m, "role") == "user":
                t = content(_g(m, "content"))
                if t:
                    return t
        return None
    inp = params.get("input")
    return inp if isinstance(inp, str) else None
