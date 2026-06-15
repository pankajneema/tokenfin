"""
Tests for ingest service.
Run: cd backend && pytest tests/ -v
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.ingest import calc_cost, _sha256


def test_sha256_deterministic():
    h = _sha256("tf_live_proj_abcd_deadbeef")
    assert len(h) == 64
    assert h == _sha256("tf_live_proj_abcd_deadbeef")


def test_calc_cost_zero_tokens():
    assert calc_cost(0, 0, 5.0, 15.0) == 0.0


def test_calc_cost_basic():
    # 1M prompt tokens @ $5 + 0.5M completion @ $15 = $5 + $7.50 = $12.50
    cost = calc_cost(1_000_000, 500_000, 5.0, 15.0)
    assert abs(cost - 12.50) < 0.0001


def test_calc_cost_small():
    # 100 prompt + 50 completion at gpt-4o-mini prices (0.15/1M, 0.60/1M)
    cost = calc_cost(100, 50, 0.15, 0.60)
    assert cost == pytest.approx((100 / 1_000_000) * 0.15 + (50 / 1_000_000) * 0.60)
