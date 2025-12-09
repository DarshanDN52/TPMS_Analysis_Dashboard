from fastapi import FastAPI, WebSocket, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from Backend.app.routers import pcan, tpms
from Backend.app.src.BLETestAutomation import BLETestAutomation
from Backend.app.src.DevicesDetection import scan_devices
import os
import asyncio
from typing import Dict, Set, Optional

app = FastAPI(
    title="PCAN Web API",
    description="API for PCAN-Basic CAN bus communication",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pcan.router, prefix="/api", tags=["PCAN"])
app.include_router(tpms.router, prefix="/api/tpms", tags=["TPMS"])

# Global state for connected WebSocket clients and logs
ble_status: Dict = {"connected": False, "logs": []}
clients: Set[WebSocket] = set()
active_test_task: Optional[asyncio.Task] = None

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for streaming BLE notifications to clients."""
    await websocket.accept()
    clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # To keep connection alive / receive messages if needed
    except Exception:
        clients.remove(websocket)

async def broadcast(msg: dict) -> None:
    """Send JSON message to all connected WebSocket clients, removing disconnected."""
    disconnected = []
    for client in clients:
        try:
            await client.send_json(msg)
        except Exception:
            disconnected.append(client)
    for c in disconnected:
        clients.discard(c)

def ble_notification_handler(sender: int, data: bytearray) -> None:
    """Handle BLE notifications and broadcast to WebSocket clients asynchronously."""
    decoded = data.decode("utf-8", errors="ignore")
    print(f"BLE Notification: {decoded}")
    ble_status["logs"].append({"time": "now", "data": decoded})
    if len(ble_status["logs"]) > 100:
        ble_status["logs"].pop(0)
    asyncio.create_task(broadcast({"type": "log", "data": decoded}))

@app.get("/devices")
async def list_devices():
    """Scan for available BLE devices and return list."""
    try:
        devices = await scan_devices(timeout=5.0)
        return {"devices": devices}
    except Exception as e:
        print(f"Device scan error: {e}")
        return {"devices": [], "error": str(e)}

@app.post("/start-test")
async def start_test(payload: dict = Body(...)):
    """Start BLE test with configuration passed in payload."""
    global active_test_task
    
    device_mac = payload.get("device_mac")
    if not device_mac:
        return {"success": False, "error": "device_mac is required"}


    def ble_notification_handler(sender: int, data: bytearray) -> None:
        """Handle BLE notifications and broadcast to WebSocket clients asynchronously."""
        decoded = data.decode("utf-8", errors="ignore")
        print(f"BLE Notification: {decoded}")
        ble_status["logs"].append({"time": "now", "data": decoded})
        if len(ble_status["logs"]) > 100:
            ble_status["logs"].pop(0)
        asyncio.create_task(broadcast({"type": "log", "data": decoded}))

    def ble_record_handler(record: str) -> None:
        """Handle execution log records (Command -> Response) and broadcast."""
        ble_status["logs"].append({"time": "now", "data": record})
        if len(ble_status["logs"]) > 100:
            ble_status["logs"].pop(0)
        asyncio.create_task(broadcast({"type": "log", "data": record}))

    # Initialize BLETestAutomation instance with all parameters, including manual_commands_input
    ble = BLETestAutomation(
        device_mac=device_mac,
        write_uuid=payload.get("write_uuid", "01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0"),
        notify_uuid=payload.get("notify_uuid", "01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0"),
        chunk_length=payload.get("chunk_length", 30),
        max_retries=payload.get("max_retries", 3),
        retry_delay=payload.get("retry_delay", 2),
        ble_timeout_interval=payload.get("ble_timeout_interval", 10),
        test_by_collection=payload.get("test_by_collection", False),
        manual_commands_input=payload.get("manual_commands_input"),
        on_record=ble_record_handler
    )

    # Set BLE notification handler for real-time broadcast
    ble.on_notification = ble_notification_handler

    # Run the test asynchronously using the 'run' coroutine in your class
    if active_test_task and not active_test_task.done():
        active_test_task.cancel()
        
    active_test_task = asyncio.create_task(run_ble_test(ble))

    return {"success": True, "message": "BLE test started"}

@app.post("/stop-test")
async def stop_test():
    """Stop the currently running BLE test."""
    global active_test_task
    if active_test_task and not active_test_task.done():
        active_test_task.cancel()
        try:
            await active_test_task
        except asyncio.CancelledError:
            pass
        await broadcast({"type": "test_stopped", "message": "Test execution stopped by user."})
        print("BLE Test Task Cancelled")
        return {"success": True, "message": "Test stopped successfully"}
    return {"success": False, "message": "No active test running"}

async def run_ble_test(ble):
    try:
        await ble.run()
        await broadcast({"type": "test_complete", "result": {"success": True, "stats": ble.stats}})
    except asyncio.CancelledError:
        print("Test execution cancelled.")
        await broadcast({"type": "test_stopped", "message": "Test execution cancelled."})
    except Exception as e:
        print(f"BLE Test Error: {e}")
        await broadcast({"type": "test_complete", "result": {"success": False, "error": str(e), "stats": ble.stats}})


@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/api/{path:path}")
async def api_not_found(path: str):
    return JSONResponse(
        status_code=404,
        content={"error": "API endpoint not found", "path": f"/api/{path}"}
    )

static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "dist")

if os.path.exists(static_dir):
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "PCAN Web API is running", "note": "Frontend not built. Ensure PCAN hardware is connected."}
