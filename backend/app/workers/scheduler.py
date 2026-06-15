import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval  import IntervalTrigger
from app.core.logging import log

_scheduler = AsyncIOScheduler()


async def _run_alert_engine() -> None:
    from app.services.alert_engine import evaluate_rules
    try:
        await evaluate_rules()
    except Exception as e:
        log.error("scheduler_alert_engine_failed", error=str(e))


async def _refresh_model_prices() -> None:
    from app.core.database import get_supabase
    log.info("model_prices_refresh_skipped", reason="static_seed_data")


def start_scheduler() -> None:
    _scheduler.add_job(
        lambda: asyncio.ensure_future(_run_alert_engine()),
        IntervalTrigger(minutes=1),
        id="alert_engine",
        replace_existing=True,
    )
    _scheduler.add_job(
        lambda: asyncio.ensure_future(_refresh_model_prices()),
        IntervalTrigger(hours=6),
        id="price_refresh",
        replace_existing=True,
    )
    _scheduler.start()
    log.info("scheduler_started")


def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)
    log.info("scheduler_stopped")
