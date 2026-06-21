"""
Basic unit tests for the sync and async TokenFin clients.
Uses unittest.mock to intercept HTTP calls — no live server required.
"""
from __future__ import annotations

import asyncio
import json
import time
import unittest
from unittest.mock import MagicMock, patch

from tokenfin import TokenFinClient, AsyncTokenFinClient, FlushResult


# ─── Sync client tests ────────────────────────────────────────────────────────

class TestTokenFinClientTrack(unittest.TestCase):

    def _make_client(self, **kwargs) -> TokenFinClient:
        return TokenFinClient(
            api_key="tf_test_key",
            flush_interval=0,    # disable auto-flush
            **kwargs,
        )

    def test_track_enqueues_event(self):
        tf = self._make_client()
        tf.track(model="gpt-4o", input_tokens=100, output_tokens=50)
        self.assertEqual(len(tf._queue), 1)
        self.assertEqual(tf._queue[0]["model"], "gpt-4o")
        self.assertEqual(tf._queue[0]["input_tokens"], 100)
        self.assertEqual(tf._queue[0]["output_tokens"], 50)

    def test_track_sets_idempotency_key(self):
        tf = self._make_client()
        tf.track(model="gpt-4o", input_tokens=10, output_tokens=10, idempotency_key="k1")
        self.assertEqual(tf._queue[0]["idempotency_key"], "k1")

    def test_track_autogenerates_idempotency_key(self):
        tf = self._make_client()
        tf.track(model="gpt-4o", input_tokens=10, output_tokens=10)
        key = tf._queue[0]["idempotency_key"]
        self.assertIsNotNone(key)
        self.assertEqual(len(key), 36)   # UUID format

    def test_queue_drops_oldest_when_full(self):
        tf = self._make_client(max_queue_size=3)
        for i in range(4):
            tf.track(model=f"model-{i}", input_tokens=i, output_tokens=i)
        self.assertEqual(len(tf._queue), 3)
        # model-0 should be dropped
        models = [e["model"] for e in tf._queue]
        self.assertNotIn("model-0", models)

    def test_tags_and_metadata_included(self):
        tf = self._make_client()
        tf.track(
            model="gpt-4o",
            input_tokens=100,
            output_tokens=50,
            tags={"env": "prod"},
            metadata={"session_id": "abc"},
        )
        self.assertEqual(tf._queue[0]["tags"], {"env": "prod"})
        self.assertEqual(tf._queue[0]["metadata"], {"session_id": "abc"})


class TestTokenFinClientFlush(unittest.TestCase):

    @patch("urllib.request.urlopen")
    def test_flush_sends_events(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 202
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        tf = TokenFinClient(api_key="tf_test", flush_interval=0)
        tf.track(model="gpt-4o", input_tokens=10, output_tokens=5)
        result = tf.flush()

        self.assertEqual(result.sent, 1)
        self.assertEqual(result.dropped, 0)
        self.assertEqual(len(tf._queue), 0)

    @patch("urllib.request.urlopen")
    def test_flush_returns_dropped_on_server_error(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("connection refused")

        tf = TokenFinClient(api_key="tf_test", flush_interval=0, max_retries=1)
        tf.track(model="gpt-4o", input_tokens=10, output_tokens=5)
        result = tf.flush()

        self.assertEqual(result.dropped, 1)
        self.assertEqual(result.sent, 0)


# ─── Async client tests ───────────────────────────────────────────────────────

class TestAsyncTokenFinClient(unittest.IsolatedAsyncioTestCase):

    async def _make_client(self, **kwargs) -> AsyncTokenFinClient:
        return AsyncTokenFinClient(
            api_key="tf_test_key",
            flush_interval=0,
            **kwargs,
        )

    async def test_track_enqueues_event(self):
        tf = await self._make_client()
        await tf.track(model="claude-sonnet-4-6", input_tokens=200, output_tokens=80)
        self.assertEqual(len(tf._queue), 1)
        self.assertEqual(tf._queue[0]["model"], "claude-sonnet-4-6")

    async def test_destroy_clears_queue(self):
        tf = await self._make_client()
        await tf.track(model="gpt-4o", input_tokens=10, output_tokens=5)
        await tf.destroy()
        self.assertEqual(len(tf._queue), 0)


if __name__ == "__main__":
    unittest.main()
