from fastapi import APIRouter
from app.models.schemas import NotificationPayload
from app.services.notification import dispatch

router = APIRouter(tags=["notifications"])

@router.post("/notify", status_code=202)
async def send_notification(payload: NotificationPayload):
    results = await dispatch(payload)
    return {"dispatched": results}
