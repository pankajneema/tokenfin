from fastapi import APIRouter, Query
from app.models.schemas import LimitCheckResult
from app.services.limit_engine import check_limits

router = APIRouter(tags=["limits"])

@router.get("/limits/check", response_model=list[LimitCheckResult])
async def check_limit_status(
    org_id:     str = Query(...),
    project_id: str | None = Query(None),
    team_id:    str | None = Query(None),
    member_id:  str | None = Query(None),
):
    return await check_limits(org_id, project_id, team_id, member_id)
