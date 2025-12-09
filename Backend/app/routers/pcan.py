from fastapi import APIRouter, HTTPException
from Backend.app.schemas.pcan import InitRequest, WriteRequest, SaveDataRequest, CommandResponse, ResponsePayload
from Backend.app.services.pcan_service import pcan_service
import json
import os
from datetime import datetime

router = APIRouter()

DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data.json')

@router.post("/pcan/initialize", response_model=CommandResponse)
async def initialize_pcan(request: InitRequest):
    result = pcan_service.initialize(request.payload.id, request.payload.bit_rate)
    return CommandResponse(
        command="PCAN_INIT_RESULT",
        payload=ResponsePayload(
            status="ok" if result["success"] else "error",
            data=result.get("message", result.get("error", "")),
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.post("/pcan/release", response_model=CommandResponse)
async def release_pcan():
    result = pcan_service.release()
    return CommandResponse(
        command="PCAN_UNINIT_RESULT",
        payload=ResponsePayload(
            status="ok" if result["success"] else "error",
            data=result.get("message", result.get("error", "")),
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.get("/pcan/read", response_model=CommandResponse)
async def read_pcan():
    result = pcan_service.read_message()
    # Wrap message in data object for frontend compatibility
    message_data = result.get("message")
    response_data = {"message": message_data} if message_data else result.get("error", "")
    return CommandResponse(
        command="DATA",
        payload=ResponsePayload(
            status="ok" if result["success"] else "error",
            data=response_data,
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.post("/pcan/write", response_model=CommandResponse)
async def write_pcan(request: WriteRequest):
    result = pcan_service.write_message(
        request.payload.id,
        request.payload.data
    )
    return CommandResponse(
        command="DATA",
        payload=ResponsePayload(
            status="ok" if result["success"] else "error",
            data=result.get("message", result.get("error", "")),
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.get("/pcan/status")
async def get_pcan_status():
    return pcan_service.get_status()

@router.post("/save-data", response_model=CommandResponse)
async def save_data(request: SaveDataRequest):
    try:
        new_messages = request.payload.data or []
        
        existing_data = {"messages": [], "savedAt": []}
        if os.path.exists(DATA_FILE_PATH):
            try:
                with open(DATA_FILE_PATH, 'r') as f:
                    existing_data = json.load(f)
            except:
                existing_data = {"messages": [], "savedAt": []}
        
        existing_data["messages"].extend(new_messages)
        existing_data["savedAt"].append(datetime.now().isoformat())
        
        with open(DATA_FILE_PATH, 'w') as f:
            json.dump(existing_data, f, indent=2)
        
        return CommandResponse(
            command="LOAD_DATA",
            payload=ResponsePayload(
                status="ok",
                data=f"Saved {len(new_messages)} messages to data.json",
                packet_status="success"
            )
        )
    except Exception as e:
        return CommandResponse(
            command="LOAD_DATA",
            payload=ResponsePayload(
                status="error",
                data=str(e),
                packet_status="failed"
            )
        )
