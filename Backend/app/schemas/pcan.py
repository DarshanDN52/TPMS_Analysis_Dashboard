from pydantic import BaseModel
from typing import Optional, List, Any

class InitPayload(BaseModel):
    id: str
    bit_rate: str
    data: Optional[str] = ""

class InitRequest(BaseModel):
    command: str
    payload: InitPayload

class WritePayload(BaseModel):
    id: str
    bit_rate: Optional[str] = ""
    data: List[int]

class WriteRequest(BaseModel):
    command: str
    payload: WritePayload

class SaveDataPayload(BaseModel):
    id: Optional[str] = ""
    bit_rate: Optional[str] = ""
    data: List[Any]

class SaveDataRequest(BaseModel):
    command: str
    payload: SaveDataPayload

class ResponsePayload(BaseModel):
    status: str
    data: Any
    packet_status: str

class CommandResponse(BaseModel):
    command: str
    payload: ResponsePayload
