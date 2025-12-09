#DeviceDetection.py

import asyncio
from typing import List, Dict
from bleak import BleakScanner  # supports async BLE discovery [web:28][web:37]


async def scan_devices(timeout: float = 5.0) -> List[Dict]:
    """Scan for nearby BLE devices and return a simple list for the UI."""
    devices = await BleakScanner.discover(timeout=timeout)  # [web:28][web:37]
    result = []
    for d in devices:
        result.append(
            {
                "address": d.address,
                "name": d.name or "Unknown",
            }
        )
    return result
