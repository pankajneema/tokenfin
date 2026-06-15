from datetime import date, timedelta
from typing import Optional
from app.core.database import get_supabase
from app.models.schemas import (
    AnalyticsResponse, AnalyticsSummary, ModelBreakdown, DayStats
)


async def get_analytics(
    org_id:     str,
    project_id: Optional[str],
    days:       int = 30,
) -> AnalyticsResponse:
    db         = get_supabase()
    since      = (date.today() - timedelta(days=days)).isoformat()

    query = (
        db.table("usage_events")
        .select("model, prompt_tokens, completion_tokens, cost_usd, created_at")
        .eq("org_id", org_id)
        .gte("created_at", since)
    )
    if project_id:
        query = query.eq("project_id", project_id)

    try:
        res    = query.execute()
        events = res.data or []
    except Exception:
        events = []

    # Aggregate by model
    model_map: dict[str, dict] = {}
    day_map:   dict[str, dict] = {}

    for e in events:
        m    = e["model"]
        d    = e["created_at"][:10]
        pt   = int(e["prompt_tokens"]     or 0)
        ct   = int(e["completion_tokens"] or 0)
        cost = float(e["cost_usd"]        or 0)

        if m not in model_map:
            model_map[m] = {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "calls": 0}
        model_map[m]["prompt_tokens"]     += pt
        model_map[m]["completion_tokens"] += ct
        model_map[m]["cost_usd"]          += cost
        model_map[m]["calls"]             += 1

        if d not in day_map:
            day_map[d] = {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "calls": 0}
        day_map[d]["prompt_tokens"]     += pt
        day_map[d]["completion_tokens"] += ct
        day_map[d]["cost_usd"]          += cost
        day_map[d]["calls"]             += 1

    by_model = [
        ModelBreakdown(model=m, **v) for m, v in
        sorted(model_map.items(), key=lambda x: -x[1]["cost_usd"])
    ]
    by_day = [
        DayStats(date=d, **v) for d, v in sorted(day_map.items())
    ]

    total_cost = sum(e["cost_usd"] or 0 for e in events)
    total_pt   = sum(e["prompt_tokens"]     or 0 for e in events)
    total_ct   = sum(e["completion_tokens"] or 0 for e in events)

    summary = AnalyticsSummary(
        total_cost_usd=total_cost,
        total_calls=len(events),
        prompt_tokens=total_pt,
        completion_tokens=total_ct,
        period_days=days,
    )
    return AnalyticsResponse(summary=summary, by_model=by_model, by_day=by_day)
