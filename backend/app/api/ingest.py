from fastapi import APIRouter, HTTPException
from app.models.schemas import UsageEventIn, UsageEventOut
from app.services.ingest import process_event

router = APIRouter(tags=["ingest"])

@router.post("/ingest", response_model=UsageEventOut, status_code=201)
async def ingest_event(payload: UsageEventIn):
    result = await process_event(payload)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return result
