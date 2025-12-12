from fastapi import APIRouter, HTTPException
from Backend.app.schemas.pcan import InitRequest, WriteRequest, SaveDataRequest, CommandResponse, ResponsePayload, Result
from pydantic import BaseModel
from typing import Optional, Any
from Backend.app.services.pcan_service import pcan_service
import json
import os
from datetime import datetime

router = APIRouter()

DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'Data', 'data.json')

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
    # Switch to batch reading to avoid bottlenecks
    result = pcan_service.read_all_messages()
    
    # Payload now contains "messages": [ ... ]
    messages_list = result.get("messages", [])
    
    # We maintain the "message" key for backward compatibility if needed, 
    # but the frontend shoud switch to "messages".
    # Just in case, let's put the first message in "message" if exists (optional)
    # But clean approach is: data = { "messages": [...] }
    
    response_data = {"messages": messages_list}
    
    return CommandResponse(
        command="DATA",
        payload=ResponsePayload(
            result=Result(
                status="ok" if result["success"] else "error",
                message=f"Read {len(messages_list)} messages" if result["success"] else result.get("error", "")
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
        target_filename = request.payload.filename or "data.json"
        
        # Sanitize filename to prevent directory traversal
        target_filename = os.path.basename(target_filename)
        if not target_filename.endswith('.json'):
            target_filename += '.json'
            
        # Determine path
        # Assuming we want to save in the same directory as data.json (Data folder)
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'Data'))
        if not os.path.exists(base_dir):
            os.makedirs(base_dir)
        file_path = os.path.join(base_dir, target_filename)

        # "Style like tpms_streamed_data.json": List of objects, appended.
        
        # Check if file exists and determine start logic
        file_exists = os.path.exists(file_path)
        start_new = True
        
        if file_exists:
            # Check if it's a list or needs reset
            try:
                with open(file_path, 'r') as f:
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
                with open(file_path, 'rb+') as f:
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

        with open(file_path, mode) as f:
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
                    message=f"Saved {len(new_messages)} messages to {target_filename}"
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


class TimerStartRequest(BaseModel):
    mode: str # 'manual' or 'csv'
    data: str
    interval: Optional[int] = 2000
    base_id: Optional[int] = 1280

@router.post("/pcan/timer/start", response_model=CommandResponse)
async def start_timer(request: TimerStartRequest):
    result = pcan_service.start_timer_sequence(request.mode, request.data, request.interval, request.base_id)
    return CommandResponse(
        command="TIMER_START",
        payload=ResponsePayload(
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("message", result.get("error", ""))
            ),
            data="",
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.post("/pcan/timer/stop", response_model=CommandResponse)
async def stop_timer():
    result = pcan_service.stop_timer_sequence()
    return CommandResponse(
        command="TIMER_STOP",
        payload=ResponsePayload(
            result=Result(
                status="ok" if result["success"] else "error",
                message=result.get("message", result.get("error", ""))
            ),
            data="",
            packet_status="success" if result["success"] else "failed"
        )
    )

@router.get("/pcan/timer/logs", response_model=CommandResponse)
async def get_timer_logs():
    data = pcan_service.get_timer_logs()
    return CommandResponse(
        command="TIMER_LOGS",
        payload=ResponsePayload(
            result=Result(status="ok", message="Logs retrieved"),
            data=data, # Now a dict {logs: [], running: bool}
            packet_status="success"
        )
    )

@router.get("/pcan/timer/default-csv", response_model=CommandResponse)
async def get_default_csv():
    # Attempt to find commands.csv in project root
    # Backend/app/routers/pcan.py -> ... -> Project Root
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    csv_path = os.path.join(root_dir, 'commands.csv')

    # Fallback to specific user path if calculation fails
    if not os.path.exists(csv_path):
        # Specific path requested by user
        explicit_path = r"D:\internship\TPMS_Analysis_Dashboard\commands.csv"
        if os.path.exists(explicit_path):
            csv_path = explicit_path
    
    if os.path.exists(csv_path):
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return CommandResponse(
                command="GET_DEFAULT_CSV",
                payload=ResponsePayload(
                    result=Result(status="ok", message="Default CSV loaded"),
                    data=content,
                    packet_status="success"
                )
            )
        except Exception as e:
            return CommandResponse(
                command="GET_DEFAULT_CSV",
                payload=ResponsePayload(
                    result=Result(status="error", message=f"Failed to read file: {str(e)}"),
                    data="",
                    packet_status="failed"
                )
            )
    else:
        return CommandResponse(
            command="GET_DEFAULT_CSV",
            payload=ResponsePayload(
                result=Result(status="error", message="commands.csv not found in root"),
                data="",
                packet_status="failed"
            )
        )


