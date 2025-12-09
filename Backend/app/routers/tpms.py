from fastapi import APIRouter
from Backend.app.schemas.tpms import TPMSStartRequest, TPMSStatusResponse
from Backend.app.services.tpms_service import tpms_service

router = APIRouter()

@router.post("/start")
async def start_tpms(request: TPMSStartRequest):
    return tpms_service.start_collection(request.tire_count, request.axle_config or [])

@router.post("/stop")
async def stop_tpms():
    return tpms_service.stop_collection()

@router.get("/status", response_model=TPMSStatusResponse)
async def get_tpms_status():
    return tpms_service.get_status()
