import hashlib
import asyncio
from datetime import datetime, timezone
from typing import Optional
from app.core.database import get_supabase
from app.core.logging import log
from app.models.schemas import UsageEventIn, UsageEventOut


def _sha256(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def resolve_api_key(raw_key: str) -> Optional[dict]:
    """Resolve raw API key to org/project via hash lookup."""
    db = get_supabase()
    key_hash = _sha256(raw_key)
    prefix   = raw_key[:20]

    try:
        res = (
            db.table("api_keys")
            .select("id, org_id, project_id, is_active")
            .eq("key_hash", key_hash)
            .eq("key_prefix", prefix)
            .eq("is_active", True)
            .single()
            .execute()
        )
        return res.data
    except Exception as e:
        log.warning("resolve_api_key_failed", error=str(e))
        return None


async def get_model_price(model: str) -> tuple[float, float]:
    """Returns (input_price_per_1m, output_price_per_1m)."""
    db = get_supabase()
    try:
        res = (
            db.table("model_prices")
            .select("input_per_1m, output_per_1m")
            .eq("model_id", model)
            .eq("is_active", True)
            .single()
            .execute()
        )
        d = res.data
        return float(d["input_per_1m"]), float(d["output_per_1m"])
    except Exception:
        return 0.0, 0.0


def calc_cost(prompt: int, completion: int, input_price: float, output_price: float) -> float:
    return (prompt / 1_000_000) * input_price + (completion / 1_000_000) * output_price


async def _upsert_aggregate(event_id: str, org_id: str, project_id: Optional[str],
                             model: str, date: str, prompt: int,
                             completion: int, cost: float) -> None:
    db = get_supabase()
    try:
        db.rpc("upsert_usage_agg", {
            "p_org_id":            org_id,
            "p_project_id":        project_id,
            "p_model":             model,
            "p_date":              date,
            "p_prompt_tokens":     prompt,
            "p_completion_tokens": completion,
            "p_cost_usd":          cost,
            "p_calls":             1,
        }).execute()
    except Exception as e:
        log.warning("upsert_agg_failed", event_id=event_id, error=str(e))


async def process_event(payload: UsageEventIn) -> Optional[UsageEventOut]:
    key_record = await resolve_api_key(payload.api_key)
    if not key_record:
        return None

    org_id     = key_record["org_id"]
    project_id = key_record.get("project_id") or None

    input_price, output_price = await get_model_price(payload.model)
    cost = calc_cost(payload.prompt_tokens, payload.completion_tokens, input_price, output_price)

    now  = datetime.now(timezone.utc)
    date = now.date().isoformat()

    db = get_supabase()
    try:
        res = db.table("usage_events").insert({
            "org_id":            org_id,
            "project_id":        project_id,
            "model":             payload.model,
            "prompt_tokens":     payload.prompt_tokens,
            "completion_tokens": payload.completion_tokens,
            "cost_usd":          cost,
            "metadata":          payload.metadata or {},
        }).execute()
        row = res.data[0]
    except Exception as e:
        log.error("insert_event_failed", error=str(e))
        return None

    # Fire-and-forget aggregate update
    asyncio.ensure_future(
        _upsert_aggregate(
            row["id"], org_id, project_id, payload.model,
            date, payload.prompt_tokens, payload.completion_tokens, cost
        )
    )

    return UsageEventOut(
        id=row["id"],
        org_id=org_id,
        project_id=project_id,
        model=payload.model,
        prompt_tokens=payload.prompt_tokens,
        completion_tokens=payload.completion_tokens,
        cost_usd=cost,
        created_at=now,
    )
