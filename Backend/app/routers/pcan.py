from fastapi import APIRouter, HTTPException
from Backend.app.schemas.pcan import InitRequest, WriteRequest, SaveDataRequest, CommandResponse, ResponsePayload, Result
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
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("message", result.get("error", ""))
            ),
            data="",
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.post("/pcan/release", response_model=CommandResponse)
async def release_pcan():
    result = pcan_service.release()
    return CommandResponse(
        command="PCAN_UNINIT_RESULT",
        payload=ResponsePayload(
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("message", result.get("error", ""))
            ),
            data="",
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
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("error", "") if not result["success"] else "Read successful"
            ),
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
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("message", result.get("error", ""))
            ),
            data="",
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
        
        # "Style like tpms_streamed_data.json": List of objects, appended.
        
        # Check if file exists and determine start logic
        file_exists = os.path.exists(DATA_FILE_PATH)
        start_new = True
        
        if file_exists:
            # Check if it's a list or needs reset
            try:
                with open(DATA_FILE_PATH, 'r') as f:
                    first_char = f.read(1)
                    if first_char == '[':
                        start_new = False
            except:
                pass

        mode = 'a' if not start_new else 'w'
        
        # If appending, we need to handle the trailing ']' carefully
        if not start_new:
            try:
                # Use binary mode to reliably find and remove the last ']' ignoring newlines
                with open(DATA_FILE_PATH, 'rb+') as f:
                    f.seek(0, os.SEEK_END)
                    # Search backwards for 50 bytes max to find ']'
                    search_limit = 50
                    found = False
                    current_pos = f.tell()
                    
                    for _ in range(min(current_pos, search_limit)):
                        current_pos -= 1
                        f.seek(current_pos, os.SEEK_SET)
                        char = f.read(1)
                        if char == b']':
                            # Found the closing bracket.
                            # Check if the array is empty (i.e. if the previous char is '[')
                            is_empty = False
                            check_pos = current_pos
                            search_back_limit = 50
                            for _ in range(search_back_limit):
                                check_pos -= 1
                                if check_pos < 0: break
                                f.seek(check_pos, os.SEEK_SET)
                                c = f.read(1)
                                if c == b'[':
                                    is_empty = True
                                    break
                                if c not in [b'\n', b'\r', b' ', b'\t']:
                                    break
                            
                            f.seek(current_pos, os.SEEK_SET)
                            f.truncate()
                            
                            if not is_empty:
                                f.write(b',\n')
                            else:
                                f.write(b'\n') # Just newline if it was empty [
                                
                            found = True
                            break
                        if char not in [b'\n', b'\r', b' ', b'\t']:
                            # Found non-whitespace that isn't ']'; abort
                            break
            except Exception as e:
                # If fail, fallback to overwrite or just append (might break JSON but data saved)
                print(f"Seek error: {e}")
                pass

        with open(DATA_FILE_PATH, mode) as f:
            if start_new:
                f.write('[\n')

            # Write the new Session Object
            # Header
            f.write(f'  {{\n    "savedAt": "{datetime.now().isoformat()}",\n    "messages": [\n')
            
            # Message items
            for i, msg in enumerate(new_messages):
                f.write(f'      {json.dumps(msg)}')
                if i < len(new_messages) - 1:
                    f.write(',\n')
                else:
                    f.write('\n')
            
            # Footer
            f.write('    ]\n  }\n]')
        
        return CommandResponse(
            command="LOAD_DATA",
            payload=ResponsePayload(
                result=Result(
                    status="ok",
                    message=f"Saved {len(new_messages)} messages to data.json"
                ),
                data="",
                packet_status="success"
            )
        )
    except Exception as e:
        return CommandResponse(
            command="LOAD_DATA",
            payload=ResponsePayload(
                result=Result(
                    status="error",
                    message=str(e)
                ),
                data="",
                packet_status="failed"
            )
        )
