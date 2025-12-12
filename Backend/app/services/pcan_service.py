from typing import Optional, Dict, Any
import sys
import os
import threading
import time
import json
from datetime import datetime
import io
import csv
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
        
        # Streaming state
        self.recording = False
        self.record_path = os.path.join(root_dir, 'tpms_streamed_data.json')
        self.stream_file = None
        self.stream_file = None
        self.first_message = True
        
        # Timer / Sequencer state
        self.timer_running = False
        self.timer_thread: Optional[threading.Thread] = None
        self.timer_logs = deque(maxlen=1000)
        self.timer_response_buffer = deque(maxlen=1000)
        self.stop_timer_event = threading.Event()
        
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
                except Exception:
                    pass
                
                # Start recording to file
                try:
                    # Check if file exists to determine if we need to start array or append
                    file_exists = os.path.exists(self.record_path)
                    
                    if file_exists:
                        # If file exists, we need to remove the trailing ']' to append
                        try:
                            with open(self.record_path, 'rb+') as f:
                                f.seek(0, os.SEEK_END)
                                pos = f.tell()
                                if pos > 1:
                                    # Search backwards for the last ']'
                                    # This is a simple assumption that the file ends with '}\n]' or '}' or ']'
                                    # We will just remove the last byte if it is ']'
                                    # A safer way is ensuring we always write ']' on release. 
                                    # So we remove the last char.
                                    f.seek(-1, os.SEEK_END)
                                    char = f.read(1)
                                    if char == b']':
                                        f.seek(-1, os.SEEK_END)
                                        f.truncate()
                                        needs_comma = True
                                    else:
                                        # File might be corrupted or empty array
                                        needs_comma = False
                                else:
                                    needs_comma = False
                        except Exception:
                            # If binary edit fails, maybe file is locked, risky fallback
                            needs_comma = False
                            
                        self.stream_file = open(self.record_path, 'a')
                        if needs_comma:
                            self.stream_file.write(',\n')
                    else:
                        # New file, start array
                        self.stream_file = open(self.record_path, 'w')
                        self.stream_file.write('[\n')
                    
                    # Write Session Object Start
                    self.stream_file.write(f'  {{\n    "initializationTime": "{datetime.now().isoformat()}",\n    "messages": [\n')
                    self.stream_file.flush()
                    self.recording = True
                    self.first_message = True
                except Exception as e:
                    print(f"Failed to start recording: {e}")

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
                
                # Stop recording and close file
                if self.recording and self.stream_file:
                    try:
                        self.stream_file.write(f'\n    ],\n    "releaseTime": "{datetime.now().isoformat()}"\n  }}')
                        # Always write the closing array bracket. The next init will strip it if appending.
                        self.stream_file.write('\n]')
                        self.stream_file.close()
                    except Exception:
                        pass
                    self.stream_file = None
                    self.recording = False

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

    def read_all_messages(self) -> Dict[str, Any]:
        """
        Retrieves ALL currently buffered messages.
        This prevents the queue from filling up if the frontend polls slower than the bus speed.
        """
        if not self.initialized:
            return {
                "success": False,
                "messages": [] # Return list for consistency
            }
        
        # 1. Drain internal threaded buffer
        messages = []
        while self.read_buffer:
            try:
                messages.append(self.read_buffer.popleft())
            except IndexError:
                break
        
        # 2. Also try to read whatever is currently in the hardware queue (poll once more)
        # This ensures we get the "very latest" if the thread is sleeping
        # (Optional, but good for "real-time" feel)
        # We won't force a hardware read here to avoid race conditions with the thread.
        # The thread is fast enough (0.05s sleep).
        
        return {
            "success": True,
            "messages": messages
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
            is_extended = extended or (can_id > 0x7FF)
            
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
                            
                            # If timer sequence is running, also feed the response buffer
                            if self.timer_running:
                                self.timer_response_buffer.append(item)
                            
                            # Stream to file if recording
                            if self.recording and self.stream_file:
                                try:
                                    if not self.first_message:
                                        self.stream_file.write(',\n')
                                    else:
                                        self.first_message = False
                                    
                                    # Format data as space-separated hex string
                                    hex_data = ' '.join([f"{x:02X}" for x in item['data']])
                                    record_obj = {
                                        "id": item['id'],
                                        "data": hex_data,
                                        "timestamp": datetime.now().isoformat()
                                    }
                                    self.stream_file.write(f'    {json.dumps(record_obj)}')
                                except Exception:
                                    pass

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

    # Timer / Sequencer Methods
    def start_timer_sequence(self, mode: str, data: Any, default_interval: int = 2000, base_id: int = 1280) -> Dict[str, Any]:
        """
        Starts the timer write sequence in a separate thread.
        mode: 'manual' or 'csv'
        data: string (manual input or csv content)
        default_interval: ms
        base_id: Base Transmission CAN ID to calculate response IDs (Base + 129, Base + 130)
        """
        if self.timer_running:
            return {"success": False, "error": "Timer sequence already running"}

        try:
            commands = self._parse_commands(data, default_interval)
            if not commands:
                return {"success": False, "error": "No valid commands found in input"}
            
            self.timer_running = True
            self.stop_timer_event.clear()
            self.timer_logs.clear()
            self.timer_response_buffer.clear()
            
            self.timer_thread = threading.Thread(
                target=self._timer_write_loop, 
                args=(commands, base_id), 
                daemon=True
            )
            self.timer_thread.start()
            
            return {"success": True, "message": f"Started sequence with {len(commands)} commands"}
        except Exception as e:
            self.timer_running = False
            return {"success": False, "error": str(e)}

    def stop_timer_sequence(self) -> Dict[str, Any]:
        if not self.timer_running:
            return {"success": False, "error": "Timer sequence not running"}
        
        self.stop_timer_event.set()
        if self.timer_thread:
            self.timer_thread.join(timeout=2.0)
        
        self.timer_running = False
        return {"success": True, "message": "Timer sequence stopped"}

    def get_timer_logs(self) -> Dict[str, Any]:
        return {
            "logs": list(self.timer_logs),
            "running": self.timer_running
        }

    def _parse_commands(self, data: str, default_interval: int) -> list:
        # User requirement: "if untick manual mode were take every coumn separated by comma"
        # "each new line is new command"
        # Format similar to CSV: ID, CmdType, Payload, Interval, Repeat
        
        commands = []
        # Use csv module to handle comma splitting correctly
        f = io.StringIO(data.strip())
        reader = csv.reader(f)
        
        row_idx = 1
        for row in reader:
            if not row or all(x.strip() == '' for x in row): 
                continue
                
            # Skip header if it looks like one (simple heuristic or just assume no header in manual?)
            # The python script skips the first row of the CSV file.
            # In manual mode, user might just paste raw data.
            # We'll assume NO header for manual, or let user handle it. 
            # But the user said "input ui at left side give plan @[06_TimerWrite_CSV.py]"
            # The referenced script expects a header.
            # We will NOT skip automatically unless we are sure. 
            # Best effort: try to parse ID as hex/int. If fail, skip (it's a header).
            
            try:
                # 1. ID
                id_str = row[0].strip() if len(row) > 0 else "0"
                if id_str.lower() in ['id', 'can_id', 'command']: # Header detection
                    continue
                can_id = int(id_str, 0) # Handles 0x prefix
                
                # 2. CmdType (2 bytes)
                cmd_str = row[1].strip() if len(row) > 1 else "0"
                cmd_bytes = self._parse_hex_bytes(cmd_str, 2)
                
                # 3. Payload (6 bytes)
                pay_str = row[2].strip() if len(row) > 2 else "0"
                pay_bytes = self._parse_hex_bytes(pay_str, 6)
                
                full_data = cmd_bytes + pay_bytes
                
                # 4. Interval
                try:
                    interval = int(row[3].strip()) if len(row) > 3 and row[3].strip() else default_interval
                except:
                    interval = default_interval
                    
                # 5. Repeat
                try:
                    repeat_val = int(row[4].strip()) if len(row) > 4 and row[4].strip() else 1
                except:
                    repeat_val = 1
                
                if repeat_val <= 0: repeat_val = 1
                    
                commands.append({
                    "id": can_id,
                    "data": full_data,
                    "interval": interval,
                    "repeat": repeat_val
                })
                row_idx += 1
            except Exception as e:
                print(f"Skipping row {row_idx}: {e}")
                pass
                
        return commands

    def _parse_hex_bytes(self, val_str: str, expected_bytes: int) -> list:
        # Same logic as python script
        if not val_str: return [0] * expected_bytes
        try:
            val_int = int(val_str, 0)
        except:
            return [0] * expected_bytes
            
        try:
            byte_data = val_int.to_bytes(expected_bytes, byteorder='big')
        except OverflowError:
            mask = (1 << (expected_bytes * 8)) - 1
            val_int &= mask
            byte_data = val_int.to_bytes(expected_bytes, byteorder='big')
            
        return list(byte_data)

    def _timer_write_loop(self, commands, base_id):
        self.timer_logs.append({
            "type": "info",
            "message": "Starting Sequence...",
            "timestamp": datetime.now().isoformat()
        })
        
        # Calculate allowed response IDs based on base_id 
        # Script says: allowed_response_ids = [1280 + 129, 1280 + 130] if base is 1280
        # So generic formula:
        resp_id_1 = base_id + 129
        resp_id_2 = base_id + 130
        allowed_response_ids = [resp_id_1, resp_id_2]
        
        recv_stats = {rid: 0 for rid in allowed_response_ids}
        all_received_msgs = []

        try:
            for cmd in commands:
                if self.stop_timer_event.is_set(): break
                
                can_id = cmd['id']
                data = cmd['data']
                interval_ms = cmd['interval']
                repeat_count = cmd['repeat']
                
                for i in range(repeat_count):
                    if self.stop_timer_event.is_set(): break

                    # Send
                    res = self.write_message(hex(can_id), data)
                    
                    # Log Send
                    hex_data_str = ' '.join([f"{b:02X}" for b in data])
                    if res['success']:
                        self.timer_logs.append({
                            "type": "sent",
                            "message": f"Sent: ID=0x{can_id:X} Data={hex_data_str}",
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        self.timer_logs.append({
                            "type": "error",
                            "message": f"Failed Sent: {res.get('error')}",
                            "timestamp": datetime.now().isoformat()
                        })

                    # Wait and Poll
                    start_time = time.time()
                    wait_sec = interval_ms / 1000.0
                    
                    while (time.time() - start_time) < wait_sec:
                        if self.stop_timer_event.is_set(): break
                        
                        # Check response buffer
                        # We process all available messages in buffer to see if any match
                        while len(self.timer_response_buffer) > 0:
                            msg = self.timer_response_buffer.popleft() # Consume
                            # Check ID
                            try:
                                msg_id_int = int(msg['id'], 16)
                                if msg_id_int in allowed_response_ids:
                                    # Collect Response (Don't log immediately)
                                    # We need to capture the SentID (can_id) here.
                                    # Since we are in the loop of processing 'cmd', 'can_id' is available.
                                    data_str = " ".join([f"{x:02X}" for x in msg['data']])
                                    all_received_msgs.append({
                                        "sent_id": f"0x{can_id:X}",
                                        "response_id": f"0x{msg_id_int:X}",
                                        "data": data_str,
                                        "time": datetime.now().strftime("%H:%M:%S.%f")[:-3]
                                    })
                                    recv_stats[msg_id_int] += 1
                            except:
                                pass
                        
                        time.sleep(0.01)

            # Post-Sequence Listening (Dynamic Interval)
            # Use the last 'interval_ms' from the loop, or default 0 if not available?
            # User wants: "total 2*timeinterval after 4 th frame".
            # The 4th frame loop wait = 1*interval. We add 1*interval here. Total = 2*interval.
            
            last_interval_ms = locals().get('interval_ms', 1000) # Default to 1000 if not defined
            
            post_start = time.time()
            post_wait = last_interval_ms / 1000.0
            
            while (time.time() - post_start) < post_wait:
                if self.stop_timer_event.is_set(): break
                
                while len(self.timer_response_buffer) > 0:
                     msg = self.timer_response_buffer.popleft()
                     try:
                        msg_id_int = int(msg['id'], 16)
                        if msg_id_int in allowed_response_ids:
                            data_str = " ".join([f"{x:02X}" for x in msg['data']])
                            
                            current_sent_id = f"0x{can_id:X}" if 'can_id' in locals() else "Unknown"
                            
                            all_received_msgs.append({
                                "sent_id": current_sent_id,
                                "response_id": f"0x{msg_id_int:X}",
                                "data": data_str,
                                "time": datetime.now().strftime("%H:%M:%S.%f")[:-3]
                            })
                     except:
                        pass
                time.sleep(0.01)
            
            self.timer_logs.append({
                "type": "info",
                "message": "Sequence Finished",
                "timestamp": datetime.now().isoformat()
            })
            
            # Summary of all received messages
            timer_end_time = datetime.now()
            duration_sec = (timer_end_time - datetime.fromisoformat(self.timer_logs[0]['timestamp'])).total_seconds()
            
            # Calculate total expected responses (Sum of Repeats)
            total_expected = sum(cmd['repeat'] for cmd in commands)
            total_received = len(all_received_msgs)

            if all_received_msgs:
                self.timer_logs.append({
                    "type": "info",
                    "message": f"--- Listened Data (Refreshed) ---",
                    "timestamp": datetime.now().isoformat()
                })
                self.timer_logs.append({
                    "type": "info",
                    "message": f"Listening Duration: {duration_sec:.2f}s | Expected: {total_expected} | Recv: {total_received}",
                    "timestamp": datetime.now().isoformat()
                })
                
                for msg in all_received_msgs:
                    # User requested 'Recv: 0x581 | Data: ...' (Time optional? I will keep time as it's useful)
                    self.timer_logs.append({
                        "type": "recv",
                        "message": f"Recv: {msg['response_id']} | Data: {msg['data']} | Time: {msg.get('time', '-')}",
                        "timestamp": datetime.now().isoformat()
                    })
            else:
                 self.timer_logs.append({
                    "type": "info",
                    "message": "No matching responses received.",
                    "timestamp": datetime.now().isoformat()
                })
                 self.timer_logs.append({
                    "type": "info",
                    "message": f"Listening Duration: {duration_sec:.2f}s | Expected: {total_expected} | Recv: 0",
                    "timestamp": datetime.now().isoformat()
                })

            
        except Exception as e:
            self.timer_logs.append({
                "type": "error",
                "message": f"Sequence Error: {str(e)}",
                "timestamp": datetime.now().isoformat()
            })
        finally:
            self.timer_running = False

pcan_service = PCANService()
