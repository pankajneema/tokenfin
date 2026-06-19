from __future__ import annotations
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class Plan(str, Enum):
    free       = "free"
    starter    = "starter"
    pro        = "pro"
    enterprise = "enterprise"


class Role(str, Enum):
    owner  = "owner"
    admin  = "admin"
    member = "member"
    viewer = "viewer"


class LimitScope(str, Enum):
    org     = "org"
    project = "project"
    team    = "team"
    member  = "member"


class LimitPeriod(str, Enum):
    daily   = "daily"
    weekly  = "weekly"
    monthly = "monthly"


class LimitStatus(str, Enum):
    ok        = "ok"
    warning   = "warning"
    throttled = "throttled"
    blocked   = "blocked"


class BudgetStatus(str, Enum):
    pending  = "pending"
    approved = "approved"
    rejected = "rejected"


class TriggerType(str, Enum):
    threshold   = "threshold"
    anomaly     = "anomaly"
    limit_breach = "limit_breach"


# ── Ingest ───────────────────────────────────────────────────────────────────

class UsageEventIn(BaseModel):
    api_key:           str
    model:             str
    prompt_tokens:     int = Field(ge=0)
    completion_tokens: int = Field(ge=0)
    metadata:          Optional[dict[str, Any]] = None


class UsageEventOut(BaseModel):
    id:                str
    org_id:            str
    project_id:        Optional[str]
    model:             str
    prompt_tokens:     int
    completion_tokens: int
    cost_usd:          float
    created_at:        datetime


# ── Limits ───────────────────────────────────────────────────────────────────

class LimitCheckResult(BaseModel):
    scope:       LimitScope
    scope_id:    str
    period:      LimitPeriod
    budget_usd:  float
    spent_usd:   float
    pct:         float
    status:      LimitStatus
    warn_at:     float = 0.70
    throttle_at: float = 0.90
    block_at:    float = 1.00


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationPayload(BaseModel):
    org_id:   str
    title:    str
    body:     str
    channels: list[str] = Field(default_factory=list)
    metadata: Optional[dict[str, Any]] = None


# ── Analytics ─────────────────────────────────────────────────────────────────

class ModelBreakdown(BaseModel):
    model:             str
    prompt_tokens:     int
    completion_tokens: int
    cost_usd:          float
    calls:             int


class DayStats(BaseModel):
    date:              str
    prompt_tokens:     int
    completion_tokens: int
    cost_usd:          float
    calls:             int


class AnalyticsSummary(BaseModel):
    total_cost_usd:    float
    total_calls:       int
    prompt_tokens:     int
    completion_tokens: int
    period_days:       int


class AnalyticsResponse(BaseModel):
    summary:  AnalyticsSummary
    by_model: list[ModelBreakdown]
    by_day:   list[DayStats]


# ── Budget requests ──────────────────────────────────────────────────────────

class BudgetRequestIn(BaseModel):
    project_id:    str
    requested_usd: float = Field(gt=0)
    reason:        Optional[str] = None


class BudgetReviewIn(BaseModel):
    status:  BudgetStatus
    comment: Optional[str] = None


# ── Health ───────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:   str
    version:  str
    supabase: str
