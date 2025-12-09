from pydantic import BaseModel
from typing import Optional

class TPMSStartRequest(BaseModel):
    tire_count: int
    axle_config: Optional[list[int]] = None

class TPMSStatusResponse(BaseModel):
    success: bool
    is_collecting: bool
    message: Optional[str] = None
