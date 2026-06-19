from fastapi import APIRouter
from app.core.database import get_supabase
from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])

@router.get("/health", response_model=HealthResponse)
async def health_check():
    try:
        db = get_supabase()
        db.table("organizations").select("id").limit(1).execute()
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    return HealthResponse(status="ok", version="0.1.0", supabase=db_status)
