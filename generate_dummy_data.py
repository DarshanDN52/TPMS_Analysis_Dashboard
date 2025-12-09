
import json
import random
from datetime import datetime, timedelta

def generate_dummy_json(file_path):
    # Configuration
    num_sensors = 32 # IDs 0 to 31
    num_cycles = 40  # 40 cycles * 32 sensors = 1280 messages
    cycle_interval = timedelta(minutes=1)
    
    # Base timestamp
    start_time = datetime.now()
    
    messages = []
    
    # Packet Types
    packet_types = [0x01, 0x01, 0x01, 0x02, 0x03, 0x04, 0x10, 0x11] 

    for cycle in range(num_cycles):
        cycle_base_time = start_time + (cycle * cycle_interval)
        
        for sensor_id in range(num_sensors):
            # 2. Packet Type
            pkt_type = random.choice(packet_types)
            
            # 3. Data Generation
            msg_id = "502"
            
            # Byte 0: Sensor ID
            b0 = sensor_id
            
            # Byte 1: Packet Type
            b1 = pkt_type
            
            # Pressure (Bytes 2-3)
            pressure_val = random.randint(35, 120)
            if pkt_type == 0x11: pressure_val = 15 # Critical Low
            if pkt_type == 0x10: pressure_val = 25 # Low
            
            b2 = (pressure_val >> 8) & 0xFF
            b3 = pressure_val & 0xFF
            
            # Temperature (Bytes 4-5)
            temp_val = random.randint(11000, 14500)
            if pkt_type == 0x11 and random.random() > 0.5: temp_val = 18000 # Critical High Temp
            
            b4 = temp_val & 0xFF 
            b5 = (temp_val >> 8) & 0xFF 
            
            # Battery (Byte 6)
            batt_val = random.randint(100, 160)
            if pkt_type == 0x11 and random.random() > 0.8: batt_val = 20 # Critical Low Batt
            
            b6 = batt_val
            
            # Byte 7: Unused
            b7 = 0x00
            
            # Format Hex String
            data_str = f"{b0:02X} {b1:02X} {b2:02X} {b3:02X} {b4:02X} {b5:02X} {b6:02X} {b7:02X}"
            
            # Timestamp
            # Spread sensors slightly within the minute so they don't all have IDENTICAL timestamp
            # e.g., offset by 100ms per sensor
            offset = timedelta(milliseconds=sensor_id * 100)
            msg_time = cycle_base_time + offset
            
            msg_obj = {
                "id": msg_id,
                "data": data_str,
                "timestamp": msg_time.isoformat()
            }
            messages.append(msg_obj)

    # Wrap in Session Structure
    session_data = [
        {
            "initializationTime": start_time.isoformat(),
            "messages": messages,
            "releaseTime": (start_time + (num_cycles * cycle_interval)).isoformat()
        }
    ]
    
    with open(file_path, 'w') as f:
        json.dump(session_data, f, indent=2)

    print(f"Generated {len(messages)} messages to {file_path}")
    print(f"Update interval: Every 1 minute for {num_sensors} sensors")

if __name__ == "__main__":
    generate_dummy_json("d:/internship/TPMS_Analysis_Dashboard/dummy.json")
