from typing import Dict, Any

class TPMSService:
    def __init__(self):
        self.is_collecting = False
        self.tire_count = 0
        self.axle_config = []
    
    def start_collection(self, tire_count: int, axle_config: list[int] | None = None) -> Dict[str, Any]:
        self.is_collecting = True
        self.tire_count = tire_count
        self.axle_config = axle_config or []
        return {
            "success": True,
            "message": f"TPMS collection started with {tire_count} tires",
            "is_collecting": True,
            "tire_count": self.tire_count,
            "axle_config": self.axle_config
        }
    
    def stop_collection(self) -> Dict[str, Any]:
        self.is_collecting = False
        return {
            "success": True,
            "message": "TPMS collection stopped",
            "is_collecting": False
        }
    
    def get_status(self) -> Dict[str, Any]:
        return {
            "success": True,
            "is_collecting": self.is_collecting,
            "tire_count": self.tire_count,
            "axle_config": self.axle_config
        }

tpms_service = TPMSService()
