"""
Shared FastAPI dependencies — injected via Depends().

Usage:
    from app.api.deps import get_db, get_settings

    @router.get("/example")
    async def example(db: Client = Depends(get_db)):
        ...
"""
from functools import lru_cache
from supabase import Client
from app.core.config import Settings, get_settings as _get_settings
from app.core.database import get_supabase as _get_supabase


def get_db() -> Client:
    """Inject the Supabase service-role client."""
    return _get_supabase()


def get_cfg() -> Settings:
    """Inject app settings."""
    return _get_settings()
