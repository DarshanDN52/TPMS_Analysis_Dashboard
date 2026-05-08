from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from Backend.app.routers import pcan
import os

app = FastAPI(
    title="Multifeet Web API",
    description="API for Multifeet CAN bus communication",
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
