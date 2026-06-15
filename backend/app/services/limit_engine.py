from datetime import date, timedelta
from typing import Optional
from app.core.database import get_supabase
from app.models.schemas import LimitCheckResult, LimitScope, LimitPeriod, LimitStatus


def _period_start(period: LimitPeriod) -> date:
    today = date.today()
    if period == LimitPeriod.daily:
        return today
    if period == LimitPeriod.weekly:
        return today - timedelta(days=today.weekday())
    # monthly
    return today.replace(day=1)


async def check_limits(
    org_id:     str,
    project_id: Optional[str] = None,
    team_id:    Optional[str] = None,
    member_id:  Optional[str] = None,
) -> list[LimitCheckResult]:
    db      = get_supabase()
    results = []

    # Build scope filters
    scope_filters = [("org", org_id)]
    if project_id:
        scope_filters.append(("project", project_id))
    if team_id:
        scope_filters.append(("team", team_id))
    if member_id:
        scope_filters.append(("member", member_id))

    try:
        limits_res = db.table("limits").select("*").eq("org_id", org_id).execute()
        limits     = limits_res.data or []
    except Exception:
        return []

    for limit in limits:
        scope    = LimitScope(limit["scope"])
        period   = LimitPeriod(limit["period"])
        scope_id = limit.get("scope_id", org_id)

        # Check if this limit applies to our context
        applicable = any(s == scope.value and sid == scope_id for s, sid in scope_filters)
        if not applicable:
            continue

        period_start = _period_start(period)

        try:
            agg = (
                db.table("usage_agg")
                .select("cost_usd.sum()")
                .eq("org_id", org_id)
                .gte("date", period_start.isoformat())
                .execute()
            )
            spent = float((agg.data[0] or {}).get("sum", 0) or 0)
        except Exception:
            spent = 0.0

        budget    = float(limit["budget_usd"])
        pct       = spent / budget if budget > 0 else 0.0
        warn_at   = float(limit.get("warn_at",     0.70))
        throttle  = float(limit.get("throttle_at", 0.90))
        block_at  = float(limit.get("block_at",    1.00))

        if pct >= block_at:
            status = LimitStatus.blocked
        elif pct >= throttle:
            status = LimitStatus.throttled
        elif pct >= warn_at:
            status = LimitStatus.warning
        else:
            status = LimitStatus.ok

        results.append(LimitCheckResult(
            scope=scope, scope_id=scope_id, period=period,
            budget_usd=budget, spent_usd=spent, pct=pct, status=status,
            warn_at=warn_at, throttle_at=throttle, block_at=block_at,
        ))

    return results


async def is_blocked(org_id: str, project_id: Optional[str] = None) -> bool:
    results = await check_limits(org_id, project_id)
    return any(r.status == LimitStatus.blocked for r in results)


async def is_throttled(org_id: str, project_id: Optional[str] = None) -> bool:
    results = await check_limits(org_id, project_id)
    return any(r.status == LimitStatus.throttled for r in results)
