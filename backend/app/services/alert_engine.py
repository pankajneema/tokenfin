from datetime import datetime, timezone, timedelta
from app.core.database import get_supabase
from app.core.logging import log
from app.models.schemas import NotificationPayload
from app.services.notification import dispatch


async def evaluate_rules() -> None:
    """Run all active alert rules and dispatch notifications if triggered."""
    db  = get_supabase()
    now = datetime.now(timezone.utc)

    try:
        rules_res = db.table("alert_rules").select("*").eq("is_active", True).execute()
        rules     = rules_res.data or []
    except Exception as e:
        log.error("alert_fetch_rules_failed", error=str(e))
        return

    for rule in rules:
        try:
            await _evaluate_rule(db, rule, now)
        except Exception as e:
            log.error("alert_rule_eval_failed", rule_id=rule["id"], error=str(e))


async def _evaluate_rule(db, rule: dict, now: datetime) -> None:
    trigger   = rule.get("trigger_type", "threshold")
    org_id    = rule["org_id"]
    threshold = float(rule.get("threshold_usd", 0) or 0)
    channels  = rule.get("channels") or []

    triggered = False
    title     = ""
    body      = ""

    if trigger == "threshold":
        since_24h = (now - timedelta(hours=24)).isoformat()
        res       = (
            db.table("usage_events")
            .select("cost_usd.sum()")
            .eq("org_id", org_id)
            .gte("created_at", since_24h)
            .execute()
        )
        spent = float((res.data[0] or {}).get("sum", 0) or 0)
        if spent >= threshold:
            triggered = True
            title     = f"Cost threshold reached — ${spent:.2f}"
            body      = f"Your organization has spent ${spent:.2f} in the last 24 hours, exceeding the ${threshold:.2f} alert threshold."

    elif trigger == "anomaly":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        week_start  = (now - timedelta(days=7)).isoformat()

        today_res = (
            db.table("usage_events")
            .select("cost_usd.sum()")
            .eq("org_id", org_id)
            .gte("created_at", today_start)
            .execute()
        )
        week_res = (
            db.table("usage_events")
            .select("cost_usd.sum()")
            .eq("org_id", org_id)
            .gte("created_at", week_start)
            .lt("created_at", today_start)
            .execute()
        )

        today_spend = float((today_res.data[0] or {}).get("sum", 0) or 0)
        week_spend  = float((week_res.data[0]  or {}).get("sum", 0) or 0)
        daily_avg   = week_spend / 7

        if daily_avg > 0 and today_spend > daily_avg * 2:
            triggered = True
            title     = f"Spending anomaly detected — ${today_spend:.2f}"
            body      = f"Today's spend (${today_spend:.2f}) is {today_spend/daily_avg:.1f}× your 7-day daily average (${daily_avg:.2f})."

    elif trigger == "limit_breach":
        from .limit_engine import check_limits
        from app.models.schemas import LimitStatus
        results = await check_limits(org_id)
        breached = [r for r in results if r.status in (LimitStatus.blocked, LimitStatus.throttled)]
        if breached:
            triggered = True
            r         = breached[0]
            title     = f"Budget limit {r.status.value} — {r.scope.value}"
            body      = f"Spending has reached {r.pct*100:.1f}% of the ${r.budget_usd:.2f} {r.period.value} budget."

    if not triggered:
        return

    # Store notification
    try:
        db.table("notifications").insert({
            "org_id":       org_id,
            "alert_rule_id": rule["id"],
            "title":         title,
            "body":          body,
            "channels":      channels,
        }).execute()
    except Exception as e:
        log.warning("alert_store_notification_failed", error=str(e))

    # Dispatch
    payload = NotificationPayload(
        org_id=org_id, title=title, body=body, channels=channels
    )
    results = await dispatch(payload)
    log.info("alert_dispatched", rule_id=rule["id"], trigger=trigger, results=results)
