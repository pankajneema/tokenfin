"""Wrapper tests with fake clients shaped like the real anthropic / openai SDKs."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS

import pytest

from tokenfin import TokenFinClient, wrap_anthropic, wrap_openai


class FakeStream:
    """Shaped like anthropic/openai `Stream`: __iter__ + __next__ over an internal iterator."""
    def __init__(self, events):
        self._iterator = iter(events)

    def __next__(self):
        return self._iterator.__next__()

    def __iter__(self):
        for item in self._iterator:
            yield item


class FakeAsyncStream:
    def __init__(self, events):
        self._events = events

    async def __anext__(self):  # pragma: no cover - shape only
        raise StopAsyncIteration

    async def __aiter__(self):
        for e in self._events:
            yield e


def anthropic_stream_events():
    return [
        NS(type="message_start", message=NS(model="claude-sonnet-4-6", usage=NS(
            input_tokens=12, output_tokens=1, cache_read_input_tokens=300, cache_creation_input_tokens=40))),
        NS(type="content_block_delta", delta=NS(type="text_delta", text="hi")),
        NS(type="message_delta", usage=NS(output_tokens=57)),
        NS(type="message_stop"),
    ]


class FakeMessages:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def create(self, **params):
        self.calls.append(params)
        if self.fail:
            raise RuntimeError("overloaded")
        if params.get("stream"):
            return FakeStream(anthropic_stream_events())
        return NS(id="msg_1", model="claude-sonnet-4-6", content=[NS(type="text", text="hi")],
                  usage=NS(input_tokens=20, output_tokens=8, cache_read_input_tokens=1000,
                           cache_creation_input_tokens=50))


class FakeMessageStream:
    def __init__(self):
        self.current_message_snapshot = None

    def __iter__(self):
        self.current_message_snapshot = NS(model="claude-haiku-4-5", usage=NS(
            input_tokens=5, output_tokens=6, cache_read_input_tokens=None, cache_creation_input_tokens=None))
        yield NS(type="message_stop")


class FakeStreamManager:
    def __init__(self):
        self.__stream = None

    def __enter__(self):
        self.__stream = FakeMessageStream()
        return self.__stream

    def __exit__(self, *exc):
        return None


class FakeMessagesWithStream(FakeMessages):
    def stream(self, **params):
        return FakeStreamManager()


class FakeAsyncMessages:
    async def create(self, **params):
        if params.get("stream"):
            return FakeAsyncStream(anthropic_stream_events())
        return NS(model="claude-sonnet-4-6", usage=NS(input_tokens=3, output_tokens=4,
                                                      cache_read_input_tokens=0, cache_creation_input_tokens=0))


def openai_chunks(include_usage):
    chunks = [NS(model="gpt-4o", choices=[NS(delta=NS(content="a"))], usage=None),
              NS(model="gpt-4o", choices=[NS(delta=NS(content="b"))], usage=None)]
    if include_usage:
        chunks.append(NS(model="gpt-4o", choices=[], usage=NS(
            prompt_tokens=1000, completion_tokens=30, prompt_tokens_details=NS(cached_tokens=800))))
    return chunks


class FakeCompletions:
    def __init__(self):
        self.calls = []

    def create(self, **params):
        self.calls.append(params)
        if params.get("stream"):
            so = params.get("stream_options") or {}
            return FakeStream(openai_chunks(so.get("include_usage")))
        return NS(model="gpt-4o-2024-08-06", choices=[NS(message=NS(content="x"))],
                  usage=NS(prompt_tokens=500, completion_tokens=20, prompt_tokens_details=NS(cached_tokens=200)))


class FakeResponses:
    def create(self, **params):
        return NS(model="gpt-5", output=[], usage=NS(input_tokens=90, output_tokens=9,
                                                    input_tokens_details=NS(cached_tokens=40)))


@pytest.fixture
def tf(server):
    client = TokenFinClient(api_key="tfk_test", base_url=server.url, flush_interval=0, flush_on_exit=False)
    client.server = server

    def events():
        client.flush()
        return server.events()
    client.events = events
    return client


def test_anthropic_non_streaming(tf):
    client = NS(messages=FakeMessages())
    assert wrap_anthropic(client, tf) is client
    res = client.messages.create(model="claude-sonnet-4-6", max_tokens=5, messages=[{"role": "user", "content": "secret"}])
    assert res.id == "msg_1"
    [e] = tf.events()
    assert (e["model"], e["input_tokens"], e["output_tokens"], e["cache_read_tokens"], e["cache_write_tokens"]) == \
        ("claude-sonnet-4-6", 20, 8, 1000, 50)
    assert e["provider"] == "anthropic" and isinstance(e["latency_ms"], int)
    assert "prompt_text" not in e


def test_anthropic_streaming_identity_and_usage(tf):
    client = NS(messages=FakeMessages())
    wrap_anthropic(client, tf, capture_prompts=True, project_id="proj", user_email="dev@x.test")
    stream = client.messages.create(model="claude-sonnet-4-6", stream=True,
                                    messages=[{"role": "user", "content": [{"type": "text", "text": "hello there"}]}])
    assert isinstance(stream, FakeStream)
    assert [ev.type for ev in stream] == ["message_start", "content_block_delta", "message_delta", "message_stop"]
    [e] = tf.events()
    assert (e["input_tokens"], e["output_tokens"], e["cache_read_tokens"], e["cache_write_tokens"]) == (12, 57, 300, 40)
    assert e["metadata"]["stream"] is True
    assert e["prompt_text"] == "hello there"
    assert (e["project_id"], e["user_email"]) == ("proj", "dev@x.test")


def test_anthropic_stream_helper(tf):
    client = NS(messages=FakeMessagesWithStream())
    wrap_anthropic(client, tf)
    with client.messages.stream(model="claude-haiku-4-5", messages=[]) as s:
        for _ in s:
            pass
    [e] = tf.events()
    assert (e["model"], e["input_tokens"], e["output_tokens"]) == ("claude-haiku-4-5", 5, 6)


def test_anthropic_errors_propagate(tf):
    client = NS(messages=FakeMessages(fail=True))
    wrap_anthropic(client, tf)
    with pytest.raises(RuntimeError, match="overloaded"):
        client.messages.create(model="m", messages=[])
    assert tf.events() == []


def test_anthropic_async_and_async_stream(tf):
    client = NS(messages=FakeAsyncMessages())
    wrap_anthropic(client, tf)

    async def main():
        r = await client.messages.create(model="x", messages=[])
        s = await client.messages.create(model="x", stream=True, messages=[])
        assert isinstance(s, FakeAsyncStream)
        return r, [ev.type async for ev in s]
    r, types = asyncio.run(main())
    assert r.model == "claude-sonnet-4-6" and len(types) == 4
    a, b = tf.events()
    assert (a["input_tokens"], a["output_tokens"]) == (3, 4)
    assert (b["input_tokens"], b["output_tokens"], b["cache_read_tokens"]) == (12, 57, 300)


def test_openai_non_streaming_and_responses(tf):
    client = NS(chat=NS(completions=FakeCompletions()), responses=FakeResponses())
    wrap_openai(client, tf)
    assert client.chat.completions.create(model="gpt-4o", messages=[]).choices[0].message.content == "x"
    client.responses.create(model="gpt-5", input="hi")
    a, b = tf.events()
    assert (a["model"], a["input_tokens"], a["output_tokens"], a["cache_read_tokens"]) == ("gpt-4o-2024-08-06", 300, 20, 200)
    assert (b["model"], b["input_tokens"], b["output_tokens"], b["cache_read_tokens"]) == ("gpt-5", 50, 9, 40)


def test_openai_streaming_injects_include_usage_and_hides_trailer(tf):
    completions = FakeCompletions()
    client = NS(chat=NS(completions=completions))
    wrap_openai(client, tf)
    params = dict(model="gpt-4o", stream=True, messages=[])
    chunks = list(client.chat.completions.create(**params))
    assert len(chunks) == 2 and all(c.choices for c in chunks)
    assert completions.calls[0]["stream_options"] == {"include_usage": True}
    assert "stream_options" not in params
    [e] = tf.events()
    assert (e["input_tokens"], e["output_tokens"], e["cache_read_tokens"]) == (200, 30, 800)


def test_openai_caller_include_usage_keeps_trailer(tf):
    client = NS(chat=NS(completions=FakeCompletions()))
    wrap_openai(client, tf)
    chunks = list(client.chat.completions.create(model="gpt-4o", stream=True,
                                                 stream_options={"include_usage": True}, messages=[]))
    assert len(chunks) == 3
    assert len(tf.events()) == 1


def test_double_wrap_and_early_break(tf):
    client = NS(messages=FakeMessages())
    wrap_anthropic(wrap_anthropic(client, tf), tf)
    stream = client.messages.create(model="m", stream=True, messages=[])
    for _ in stream:
        break
    del stream
    evs = tf.events()
    assert len(evs) == 1
    assert evs[0]["metadata"]["stream_status"] == "aborted"
