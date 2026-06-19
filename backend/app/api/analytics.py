from fastapi import APIRouter, Query
from app.models.schemas import AnalyticsResponse
from app.services.analytics import get_analytics

router = APIRouter(tags=["analytics"])

@router.get("/analytics", response_model=AnalyticsResponse)
async def analytics(
    org_id:     str = Query(...),
    project_id: str | None = Query(None),
    days:       int = Query(30, ge=1, le=365),
):
    return await get_analytics(org_id, project_id, days)
