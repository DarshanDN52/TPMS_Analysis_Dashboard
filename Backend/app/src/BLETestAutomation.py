import asyncio
import traceback
from datetime import datetime
from typing import List, Optional, Callable, Union
from bleak import BleakClient
import os

from .GenerateCombinations import generate_combinations,clear_output_file
from .ExcelToCommands import process_command_master

# Shared state
latest_response: Optional[str] = None

class BLETestAutomation:
    def __init__(
        self,
        device_mac: str,
        write_uuid: str,
        notify_uuid: str,
        # NEW: Raw string of commands for manual execution mode (one command per line)
        manual_commands_input: Optional[str] = None, 
        
        # Keeping these paths for 'collection mode' logic
        csv_file: str = os.path.join(os.path.dirname(__file__), "TestCollectionOfCommands.csv"),
        log_file: str = os.path.join(os.path.dirname(__file__), "..", "output", "Execution_Log.csv"),
        processed_commands_file: str = os.path.join(os.path.dirname(__file__), "..", "output", "processedcommands.csv"),
        combinations_file: str = os.path.join(os.path.dirname(__file__), "..", "output", "generated_combinations.csv"),
        
        # Behaviour config
        test_by_collection: bool = False,
        chunk_length: int = 30,
        max_retries: int = 3,
        retry_delay: int = 2,
        ble_timeout_interval: int = 10,
        on_notification: Optional[Callable[[int, bytearray], None]] = None,
        on_record: Optional[Callable[[str], None]] = None,
    ) -> None:
        # BLE / file config
        self.device_mac = device_mac
        self.write_uuid = write_uuid
        self.notify_uuid = notify_uuid
        
        self.manual_commands_input = manual_commands_input
        self.csv_file = csv_file
        self.log_file = log_file
        self.processed_commands_file = processed_commands_file
        self.combinations_file = combinations_file

        # Behaviour config
        self.test_by_collection = test_by_collection
        self.chunk_length = chunk_length
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.ble_timeout_interval = ble_timeout_interval

        # Callback + stats
        self.on_notification = on_notification or self.default_notification_handler
        self.on_record = on_record
        self.stats = {"total": 0, "success": 0, "failed": 0, "unknown": 0}

    @staticmethod
    def chunk_commands(commands: list[str], chunk_size: int = 20) -> list[list[str]]:
        """Split commands into chunks of specified size."""
        return [commands[i:i + chunk_size] for i in range(0, len(commands), chunk_size)]

    @staticmethod
    def notification_handler(sender: int, data: bytearray) -> None:
        """Default notification handler."""
        global latest_response
        decoded = data.decode('utf-8', errors='ignore')
        latest_response = decoded
        print(f"🔔 Notification from {sender}: {decoded}")

    @staticmethod
    def validate_response(response: str) -> str:
        """Validate and simplify response format."""
        try:
            parts = response.split(':')
            if len(parts) > 1:
                value = parts[1].split(';')[0].strip()
                
                # Try to parse as integer to handle negative/zero logic
                try:
                    int_val = int(value)
                    if int_val == 0:
                        return 'P'
                    if int_val < 0:
                        return 'F'
                except ValueError:
                    # Not an integer, check if it's already P or F
                    if value in ['P', 'F']:
                        return value
                        
                # Default for any other value (positive ints, other strings)
                return "Unknown"
            return "Invalid Format"
        except Exception:
            return "Exception Occurred"

    def load_commands(self, file_path: str) -> list[str]:
        """Load commands from file."""
        with open(file_path, 'r') as file:
            return [line.strip().strip('"') for line in file if line.strip()]

    async def log_command_response(self, client: BleakClient, command: str, log_file) -> None:
        """Log single command response to file."""
        global latest_response
        latest_response = None

        print(f"➡ Sending command: {command}")
        await client.write_gatt_char(self.write_uuid, command.encode('utf-8'))
        await asyncio.sleep(3)

        response = latest_response or "No response"
        validation = self.validate_response(response)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # --- Stats Logic Explanation ---
        # Total: Increments for every command sent.
        # Success: Increments when response validation returns 'P'.
        # Failed: Increments when response validation returns 'F'.
        # Unknown: Increments for any other response (e.g., "Invalid Format", "Exception").
        self.stats["total"] += 1
        if validation == 'P':
            self.stats["success"] += 1
        elif validation == 'F':
            self.stats["failed"] += 1
        else:
            self.stats["unknown"] += 1
        
        log_entry = f'"{command}","{response}","{validation}","{timestamp}"\n'
        log_file.write(log_entry)
        
        # Format for display/streaming
        display_log = f"{command} -> {response} -> {validation}"
        print(f"✅ Logged: {display_log} @ {timestamp}")
        
        if self.on_record:
            self.on_record(display_log)

    async def execute_commands(self, client: BleakClient, commands: list[str]) -> None:
        """Execute list of commands and log results."""
        with open(self.log_file, 'a') as log_file:
            for command in commands:
                try:
                    await self.log_command_response(client, command, log_file)
                except Exception as e:
                    print(f"❌ Command failed: {command} | Error: {e}")
                    traceback.print_exc()
                    raise

    async def execute_chunk(self, chunk: list[str]) -> None:
        """Execute a chunk of commands with retry logic."""
        client = None
        for attempt in range(1, self.max_retries + 1):
            client = BleakClient(self.device_mac)
            try:
                print(f"🔄 Attempt {attempt}: Connecting to device...")
                await client.connect()
                if not client.is_connected:
                    raise ConnectionError("❌ Failed to connect.")

                print("✅ Connected successfully!")
                await client.start_notify(self.notify_uuid, self.notification_handler)
                print("✅ Subscribed to notifications.")

                await self.execute_commands(client, chunk)
                print("✅ Chunk executed successfully!")
                return

            except Exception as e:
                print(f"❌ Chunk attempt {attempt} failed: {e}")
                traceback.print_exc()
                await asyncio.sleep(self.retry_delay)

            finally:
                if client and client.is_connected:
                    try:
                        await client.stop_notify(self.notify_uuid)
                        await client.disconnect()
                        print("🔌 Disconnected after attempt.")
                    except:
                        pass

        raise RuntimeError(f"Chunk failed after {self.max_retries} attempts")

    async def connect_and_execute(self, commands: list[str]) -> None:
        """Main execution method - splits commands into chunks and executes."""
        chunks = self.chunk_commands(commands, self.chunk_length)

        for index, chunk in enumerate(chunks):
            print(f"\n🚀 Processing chunk {index + 1}/{len(chunks)} with {len(chunk)} commands")
            try:
                await self.execute_chunk(chunk)
            except RuntimeError as e:
                print(f"🛑 Stopping further execution: {e}")
                break

            if index < len(chunks) - 1:
                print("⏳ Waiting before next chunk...")
                await asyncio.sleep(self.ble_timeout_interval)

    async def run(self) -> None:
        """Main entry point - determines command source and executes."""
        output_dir = os.path.dirname(self.log_file)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # Determine command source
        if self.manual_commands_input:
            commands = self.manual_commands_input.strip().split('\n')
            commands = [cmd.strip() for cmd in commands if cmd.strip()]
        elif self.test_by_collection:
            # Process collection mode
            process_command_master(self.csv_file, self.processed_commands_file)
            generate_combinations(self.processed_commands_file, self.combinations_file)
            commands = self.load_commands(self.combinations_file)
        else:
            commands = self.load_commands(self.csv_file)

        print(f"📋 Loaded {len(commands)} commands for execution")
        await self.connect_and_execute(commands)

    def default_notification_handler(self, sender: int, data: bytearray) -> None:
        """Default notification handler for class instance."""
        self.notification_handler(sender, data)

if __name__ == "__main__":
    # Example usage
    async def main():
        # Manual mode example
        tester = BLETestAutomation(
            device_mac="00:60:37:2D:CF:27",
            write_uuid="01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0",
            notify_uuid="01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0",
            manual_commands_input="FETCH,A,11:10*",
            test_by_collection=False
        )
        await tester.run()

    asyncio.run(main())
