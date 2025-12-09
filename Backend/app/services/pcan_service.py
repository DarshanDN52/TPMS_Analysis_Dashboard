from typing import Optional, Dict, Any
import sys
import os
import threading
import time
from collections import deque

# Add root directory to path to import PCANBasic
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

# Initialize defaults
PCANBasic = None
PCAN_ERROR_OK = 0
PCAN_ERROR_CAUTION = 0x8000
PCAN_ERROR_QRCVEMPTY = 0x00020  # Receive queue is empty
PCAN_USBBUS1 = 0x51
PCAN_USBBUS2 = 0x52
PCAN_USBBUS3 = 0x53
PCAN_USBBUS4 = 0x54
PCAN_USBBUS5 = 0x55
PCAN_BAUD_1M = 0x0014
PCAN_BAUD_800K = 0x0015
PCAN_BAUD_500K = 0x0004
PCAN_BAUD_250K = 0x0005
PCAN_BAUD_125K = 0x0006
PCAN_BAUD_100K = 0x0007
PCAN_BAUD_50K = 0x0008
PCAN_BAUD_20K = 0x0009
PCAN_BAUD_10K = 0x000A
PCAN_MESSAGE_STANDARD = 0x00
TPCANMsg = None

# Try to import PCANBasic
try:
    from Dependency.PCANBasic import *
except (ImportError, Exception):
    # PCANBasic not available - will return errors when trying to connect
    pass

class PCANService:
    """Real PCAN service - requires actual PCAN hardware"""
    def __init__(self):
        self.initialized = False
        self.channel = None
        self.baudrate = None
        self.message_counter = 0
        self.pcan_available = False
        self.pcan = None
        self.read_buffer = deque(maxlen=2000)
        self.reader_thread: Optional[threading.Thread] = None
        self.reader_running = False
        
        # Try to instantiate PCANBasic if available
        if PCANBasic is not None:
            try:
                self.pcan = PCANBasic()
                self.pcan_available = True
            except Exception as e:
                # Library failed to load (e.g., libpcanbasic.so not found)
                self.pcan = None
                self.pcan_available = False
        
        # Channel mapping
        self.channel_map = {
            'PCAN_USBBUS1': PCAN_USBBUS1,
            'PCAN_USBBUS2': PCAN_USBBUS2,
            'PCAN_USBBUS3': PCAN_USBBUS3,
            'PCAN_USBBUS4': PCAN_USBBUS4,
            'PCAN_USBBUS5': PCAN_USBBUS5,
        }
        
        # Baudrate mapping
        self.baudrate_map = {
            'PCAN_BAUD_1M': PCAN_BAUD_1M,
            'PCAN_BAUD_800K': PCAN_BAUD_800K,
            'PCAN_BAUD_500K': PCAN_BAUD_500K,
            'PCAN_BAUD_250K': PCAN_BAUD_250K,
            'PCAN_BAUD_125K': PCAN_BAUD_125K,
            'PCAN_BAUD_100K': PCAN_BAUD_100K,
            'PCAN_BAUD_50K': PCAN_BAUD_50K,
            'PCAN_BAUD_20K': PCAN_BAUD_20K,
            'PCAN_BAUD_10K': PCAN_BAUD_10K,
        }
    
    def initialize(self, channel: str, baudrate: str) -> Dict[str, Any]:
        try:
            if not self.pcan_available:
                return {
                    "success": False,
                    "error": "PCAN hardware not available. Ensure PCANBasic driver is installed and PCAN device is connected."
                }
            
            # Get channel handle from mapping
            if channel not in self.channel_map:
                return {
                    "success": False,
                    "error": f"Invalid channel: {channel}"
                }
            
            if baudrate not in self.baudrate_map:
                return {
                    "success": False,
                    "error": f"Invalid baudrate: {baudrate}"
                }
            
            pcan_channel = self.channel_map[channel]
            pcan_baudrate = self.baudrate_map[baudrate]
            
            # Initialize PCAN with proper parameters
            result = self.pcan.Initialize(pcan_channel, pcan_baudrate)
            
            # Check if initialization was successful
            if result == PCAN_ERROR_OK or result == PCAN_ERROR_CAUTION:
                self.initialized = True
                self.channel = channel
                self.baudrate = baudrate
                self.message_counter = 0
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_MESSAGE_FILTER, PCAN_FILTER_OPEN)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_ALLOW_STATUS_FRAMES, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_ALLOW_RTR_FRAMES, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_ALLOW_ERROR_FRAMES, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_BITRATE_ADAPTING, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_BUSOFF_AUTORESET, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                try:
                    self.pcan.SetValue(pcan_channel, PCAN_RECEIVE_STATUS, PCAN_PARAMETER_ON)
                except Exception:
                    pass
                return {
                    "success": True,
                    "message": f"Channel {channel} initialized successfully at {baudrate}"
                }
            else:
                # Get error message
                try:
                    et = self.pcan.GetErrorText(result)
                    error_text = et[1].decode(errors='ignore') if isinstance(et, tuple) and isinstance(et[1], (bytes, bytearray)) else str(et)
                except Exception:
                    error_text = str(result)
                return {
                    "success": False,
                    "error": f"Failed to initialize PCAN: {error_text}"
                }
        
        except Exception as e:
            return {
                "success": False,
                "error": f"PCAN initialization error: {str(e)}"
            }
        finally:
            if self.initialized and not self.reader_running and self.pcan_available:
                self.reader_running = True
                try:
                    self.reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
                    self.reader_thread.start()
                except Exception:
                    self.reader_running = False
    
    def release(self) -> Dict[str, Any]:
        try:
            if self.initialized:
                if self.reader_running:
                    self.reader_running = False
                    try:
                        if self.reader_thread is not None:
                            self.reader_thread.join(timeout=1.0)
                    except Exception:
                        pass
                result = self.pcan.Uninitialize(self.channel_map[self.channel])
                self.initialized = False
                self.channel = None
                self.baudrate = None
                self.message_counter = 0
                self.read_buffer.clear()
                
                if result == PCAN_ERROR_OK:
                    return {
                        "success": True,
                        "message": "Channel released successfully"
                    }
                else:
                    try:
                        et = self.pcan.GetErrorText(result)
                        error_text = et[1].decode(errors='ignore') if isinstance(et, tuple) and isinstance(et[1], (bytes, bytearray)) else str(et)
                    except Exception:
                        error_text = str(result)
                    return {
                        "success": False,
                        "error": f"Failed to release PCAN: {error_text}"
                    }
            else:
                return {
                    "success": False,
                    "error": "PCAN not initialized"
                }
        except Exception as e:
            return {
                "success": False,
                "error": f"Error releasing PCAN: {str(e)}"
            }
    
    def get_status(self) -> Dict[str, Any]:
        if not self.initialized:
            return {
                "status_code": "00001h",
                "status_text": "Not initialized"
            }
        
        try:
            result = self.pcan.GetStatus(self.channel_map[self.channel])
            if result == PCAN_ERROR_OK:
                return {
                    "status_code": "00000h",
                    "status_text": "OK"
                }
            else:
                try:
                    et = self.pcan.GetErrorText(result)
                    error_text = et[1].decode(errors='ignore') if isinstance(et, tuple) and isinstance(et[1], (bytes, bytearray)) else str(et)
                except Exception:
                    error_text = str(result)
                return {
                    "status_code": "00001h",
                    "status_text": error_text
                }
        except Exception as e:
            return {
                "status_code": "00001h",
                "status_text": str(e)
            }
    
    def read_message(self) -> Dict[str, Any]:
        if not self.initialized:
            return {
                "success": False,
                "message": "PCAN not initialized"
            }
        
        if not self.pcan_available:
            return {
                "success": False,
                "message": "PCAN hardware not available"
            }
        
        try:
            if self.read_buffer:
                item = self.read_buffer.popleft()
                self.message_counter += 1
                item["counter"] = self.message_counter
                return {
                    "success": True,
                    "message": item
                }
            ch = self.channel_map.get(self.channel)
            if ch is None:
                return {"success": True, "message": None}
            try:
                resfd = self.pcan.ReadFD(ch)
                if resfd[0] == PCAN_ERROR_OK:
                    msgfd = resfd[1]
                    tsfd = resfd[2]
                    datafd = []
                    for i in range(msgfd.DLC):
                        datafd.append(msgfd.DATA[i])
                    self.message_counter += 1
                    return {
                        "success": True,
                        "message": {
                            "counter": self.message_counter,
                            "id": f"{msgfd.ID:03X}",
                            "msg_type": "DATA",
                            "len": msgfd.DLC,
                            "data": datafd,
                            "timestamp": self._timestamp_to_us(tsfd)
                        }
                    }
                elif resfd[0] != PCAN_ERROR_QRCVEMPTY:
                    pass
            except Exception:
                pass
            res = self.pcan.Read(ch)
            if res[0] == PCAN_ERROR_OK:
                can_msg = res[1]
                timestamp = res[2]
                data = []
                for i in range(can_msg.LEN):
                    data.append(can_msg.DATA[i])
                self.message_counter += 1
                return {
                    "success": True,
                    "message": {
                        "counter": self.message_counter,
                        "id": f"{can_msg.ID:03X}",
                        "msg_type": "DATA",
                        "len": can_msg.LEN,
                        "data": data,
                        "timestamp": self._timestamp_to_us(timestamp)
                    }
                }
            return {"success": True, "message": None}
        except Exception as e:
            return {
                "success": False,
                "message": f"Error reading message: {str(e)}"
            }
    
    def write_message(self, msg_id: str, data: list, extended: bool = False, rtr: bool = False) -> Dict[str, Any]:
        if not self.initialized:
            return {
                "success": False,
                "error": "PCAN not initialized"
            }
        
        try:
            # Parse message ID
            can_id = int(msg_id, 16)
            is_extended = extended or (can_id > 0x7FF) or (len(msg_id) > 3)
            
            # Create CAN message
            can_msg = TPCANMsg()
            can_msg.ID = can_id
            msg_type = 0
            try:
                # Combine flags for extended/RTR if available
                if is_extended:
                    msg_type |= PCAN_MESSAGE_EXTENDED.value if hasattr(PCAN_MESSAGE_EXTENDED, 'value') else PCAN_MESSAGE_EXTENDED
                if rtr:
                    msg_type |= PCAN_MESSAGE_RTR.value if hasattr(PCAN_MESSAGE_RTR, 'value') else PCAN_MESSAGE_RTR
            except Exception:
                msg_type = 0
            can_msg.MSGTYPE = msg_type
            can_msg.LEN = min(len(data), 8)
            
            # Copy data to message
            if not rtr:
                for i, byte in enumerate(data[:can_msg.LEN]):
                    can_msg.DATA[i] = byte
            
            # Send message
            result = self.pcan.Write(self.channel_map[self.channel], can_msg)
            
            if result == PCAN_ERROR_OK:
                return {
                    "success": True,
                    "message": f"Message sent successfully - ID: {msg_id}"
                }
            else:
                try:
                    et = self.pcan.GetErrorText(result)
                    error_text = et[1].decode(errors='ignore') if isinstance(et, tuple) and isinstance(et[1], (bytes, bytearray)) else str(et)
                except Exception:
                    error_text = str(result)
                return {
                    "success": False,
                    "error": f"Failed to send message: {error_text}"
                }
        
        except Exception as e:
            return {
                "success": False,
                "error": f"Error writing message: {str(e)}"
            }

    def _reader_loop(self):
        try:
            while self.reader_running and self.initialized and self.pcan_available:
                try:
                    ch = self.channel_map.get(self.channel)
                    if ch is None:
                        time.sleep(0.05)
                        continue
                    # Drain the queue in bursts, similar to the example's timer tick
                    while True:
                        res = self.pcan.Read(ch)
                        status_code = res[0]
                        if status_code == PCAN_ERROR_OK:
                            can_msg = res[1]
                            timestamp = res[2]
                            # Extract data
                            data = []
                            for i in range(can_msg.LEN):
                                data.append(can_msg.DATA[i])
                            # Determine type label
                            try:
                                is_rtr = (can_msg.MSGTYPE & PCAN_MESSAGE_RTR.value) == PCAN_MESSAGE_RTR.value
                            except Exception:
                                is_rtr = False
                            msg_type_str = "RTR" if is_rtr else "DATA"
                            item = {
                                "id": f"{can_msg.ID:03X}",
                                "msg_type": msg_type_str,
                                "len": can_msg.LEN,
                                "data": data,
                                "timestamp": self._timestamp_to_us(timestamp)
                            }
                            self.read_buffer.append(item)
                            continue
                        elif status_code == PCAN_ERROR_QRCVEMPTY:
                            break
                        else:
                            # Non-empty error; we can sleep and retry
                            break
                except Exception:
                    # Suppress read-loop exceptions to keep the thread alive
                    pass
                time.sleep(0.05)
        finally:
            pass

    def _timestamp_to_us(self, ts: Any) -> int:
        try:
            # FD timestamp uses .value already in microseconds
            if hasattr(ts, 'value'):
                return int(getattr(ts, 'value'))
            # Classic timestamp fields: micros + 1000*millis + overflow
            micros = getattr(ts, 'micros', 0)
            millis = getattr(ts, 'millis', 0)
            overflow = getattr(ts, 'millis_overflow', 0)
            return int(micros + (1000 * millis) + (0x100000000 * 1000 * overflow))
        except Exception:
            try:
                return int(ts)
            except Exception:
                return 0

pcan_service = PCANService()
