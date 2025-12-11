from PCANBasic import *
import time
import csv
import sys
import os

class TimerWriteCSV():

    # Defines
    #region

    # Sets the PCANHandle (Hardware Channel)
    PcanHandle = PCAN_USBBUS1

    # Sets the desired connection mode (CAN = false / CAN-FD = true)
    IsFD = False

    # Sets the bitrate for normal CAN devices
    Bitrate = PCAN_BAUD_500K

    # Sets the bitrate for CAN FD devices. 
    BitrateFD = b"f_clock_mhz=20, nom_brp=5, nom_tseg1=2, nom_tseg2=1, nom_sjw=1, data_brp=2, data_tseg1=3, data_tseg2=1, data_sjw=1"

    #endregion

    # Members
    #region

    # Shows if DLL was found
    m_DLLFound = False

    #endregion

    def __init__(self, filename="commands.csv"):
        """
        Create an object starts the programm
        """
        self.ShowConfigurationHelp() ## Shows information about this sample
        
        # Default to script directory if not absolute
        if not os.path.isabs(filename):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            self.filename = os.path.join(script_dir, filename)
        else:
            self.filename = filename

        self.results = [] # Store results for summary

        ## Checks if PCANBasic.dll is available, if not, the program terminates
        try:
            self.m_objPCANBasic = PCANBasic()        
            self.m_DLLFound = self.CheckForLibrary()
        except:
            print("Unable to find the library: PCANBasic.dll !")
            self.getInput("Press <Enter> to quit...")
            self.m_DLLFound = False
            return

        ## Initialization of the selected channel
        if self.IsFD:
            stsResult = self.m_objPCANBasic.InitializeFD(self.PcanHandle,self.BitrateFD)
        else:
            stsResult = self.m_objPCANBasic.Initialize(self.PcanHandle,self.Bitrate)

        if stsResult != PCAN_ERROR_OK:
            print("Can not initialize. Please check the defines in the code.")
            self.ShowStatus(stsResult)
            print("")
            print("Press enter to close")
            input()
            return

        print("Successfully initialized.")
        try:
            self.ProcessCSV()
        except KeyboardInterrupt:
            print("\nStopped by user.")
        except Exception as e:
            print(f"Error processing CSV: {e}")
        
        print("Finished processing.")
        self.getInput("Press <Enter> to exit...")

    def __del__(self):
        if self.m_DLLFound:
            self.m_objPCANBasic.Uninitialize(PCAN_NONEBUS)

    def getInput(self, msg="Press <Enter> to continue...", default=""):
        res = default
        if sys.version_info[0] >= 3:
            res = input(msg + " ")
        else:
            res = raw_input(msg + " ")
        if len(res) == 0:
            res = default
        return res

    def ParseInput(self, val_str, expected_bytes):
        """
        Parses a string (Hex 0x... or Decimal) into a list of bytes.
        Pads with 0s at the BEGINNING (Big Endian logic usually) or END?
        Typically message data is populated index 0 to N.
        If user says "0x0102" for 2 bytes -> [0x01, 0x02]
        If user says "10" for 2 bytes -> [0x00, 0x0A]
        """
        if not val_str or val_str.strip() == "":
            return [0] * expected_bytes
        
        try:
            # Handle '0x' prefix automatically with base=0
            val_int = int(val_str, 0)
        except ValueError:
            print(f"Warning: Could not parse '{val_str}', defaulting to 0")
            val_int = 0
            
        # Convert to bytes
        # We need exactly 'expected_bytes'
        # If the number is too big, it will be truncated or raise error.
        # We'll try to fit it.
        try:
            byte_data = val_int.to_bytes(expected_bytes, byteorder='big')
        except OverflowError:
            # If value is too large, mask it
            mask = (1 << (expected_bytes * 8)) - 1
            val_int &= mask
            byte_data = val_int.to_bytes(expected_bytes, byteorder='big')
            
        return list(byte_data)

    def ProcessCSV(self):
        if not os.path.exists(self.filename):
            print(f"File {self.filename} not found.")
            return

        with open(self.filename, 'r') as csvfile:
            reader = csv.reader(csvfile)
            headers = next(reader, None) # Skip header
            
            row_idx = 1
            for row in reader:
                if not row: continue
                # Expected columns: ID, CmdType, Payload, TimerInterval, Repeat
                
                # Defaults
                can_id_str = row[0] if len(row) > 0 else "0"
                cmd_type_str = row[1] if len(row) > 1 else "0"
                payload_str = row[2] if len(row) > 2 else "0"
                interval_str = row[3] if len(row) > 3 else "0"
                repeat_str = row[4] if len(row) > 4 else "0"
                
                # Parse ID
                try:
                    can_id = int(can_id_str, 0)
                except:
                    can_id = 0
                    
                # Parse Data
                # CmdType captures bytes 0 and 1
                cmd_bytes = self.ParseInput(cmd_type_str, 2)
                
                # Payload captures bytes 2, 3, 4, 5, 6, 7 (6 bytes)
                payload_bytes = self.ParseInput(payload_str, 6)
                
                full_data = cmd_bytes + payload_bytes # Total 8 bytes
                
                # Parse Interval and Repeat
                try:
                    interval_ms = int(interval_str)
                except:
                    interval_ms = 0
                
                try:
                    repeat = int(repeat_str)
                except:
                    repeat = 0
                
                # Logic: Repeat column = Total Count (1 = Send Once, 2 = Send Twice)
                # If explicit 0 or empty, we default to 1 (Send Once) per user requirement "if no values then default 0".
                # But strictly, Repeat=0 usually means "Don't Repeat" (Just send once) OR "Don't Send" (Skip).
                # The user observed "sending 2 times if repeat in 0". 
                # This suggests they might want 0 to be 0 sends? Or 1?
                # We will default 0 -> 1 and Log it.
                if repeat <= 0:
                    repeat = 1
                    # print(f"  Note: Repeat was 0/Empty, defaulting to 1 send.")

                
                print(f"Row {row_idx}: ID=0x{can_id:X}, Data={full_data}, Interval={interval_ms}ms, SendCount={repeat}")
                
                # ID 1280 + [129, 130] (Exclude 131 per user request)
                allowed_response_ids = [1280 + 129, 1280 + 130]
                
                for i in range(repeat):
                    self.WriteMessage(can_id, full_data)
                    
                    # Instead of just sleep, we poll for response during the interval
                    start_time = time.time()
                    wait_seconds = 0
                    if interval_ms > 0:
                        wait_seconds = interval_ms / 1000.0
                    
                    # We always wait at least a tiny bit or the full interval
                    found_response = False
                    
                    while True:
                        # Check for incoming messages
                        status, msg, timestamp = self.m_objPCANBasic.Read(self.PcanHandle)
                        
                        if status == PCAN_ERROR_OK:
                            # Process message if it matches our list
                            if msg.ID in allowed_response_ids:
                                # Found match!
                                data_str = "-".join([f"{b:02X}" for b in msg.DATA[:msg.LEN]])
                                # print(f"  <- Received Response: ID=0x{msg.ID:X} Data={data_str}")
                                # Store result in memory
                                self.results.append({
                                    "SentID": f"0x{can_id:X}",
                                    "ResponseID": f"0x{msg.ID:X}",
                                    "Data": data_str
                                })
                                found_response = True
                        
                        # Check time
                        elapsed = time.time() - start_time
                        if elapsed >= wait_seconds:
                            break
                        
                        # Sleep a tiny bit to not hog CPU if we are polling
                        time.sleep(0.001)

                row_idx += 1
            
            # Print Summary at the end
            self.PrintSummary()

    def PrintSummary(self):
        print("\n" + "="*60)
        print("SUMMARY OF RESULTS")
        print("="*60)
        print(f"{'SentID':<10} | {'ResponseID':<12} | {'ResponseData'}")
        print("-" * 60)
        if not self.results:
            print("No matching responses received.")
        else:
            for res in self.results:
                print(f"{res['SentID']:<10} | {res['ResponseID']:<12} | {res['Data']}")
        print("="*60 + "\n")

    def WriteMessage(self, can_id, data):
        """
        Function for writing messages on CAN devices
        """
        msgCanMessage = TPCANMsg()
        msgCanMessage.ID = can_id
        msgCanMessage.LEN = 8
        msgCanMessage.MSGTYPE = PCAN_MESSAGE_EXTENDED.value # Defaulting to Extended as per user usage? 
        # Base code used Extended 0x100.
        # User didn't specify. I'll match the base code's default or check ID value.
        # If ID > 0x7FF, must be Extended.
        if can_id > 0x7FF:
            msgCanMessage.MSGTYPE = PCAN_MESSAGE_EXTENDED.value
        else:
            msgCanMessage.MSGTYPE = PCAN_MESSAGE_STANDARD.value
            
        for i in range(8):
            msgCanMessage.DATA[i] = data[i]
            
        stsResult = self.m_objPCANBasic.Write(self.PcanHandle, msgCanMessage)
        
        if stsResult != PCAN_ERROR_OK:
            self.ShowStatus(stsResult)
        else:
            print(f"  -> Sent: ID=0x{can_id:X} Data={[hex(x) for x in data]}")

    # Help-Functions
    #region
    def CheckForLibrary(self):
        """
        Checks for availability of the PCANBasic library
        """
        ## Check for dll file
        try:
            self.m_objPCANBasic.Uninitialize(PCAN_NONEBUS)
            return True
        except :
            return False 

    def ShowConfigurationHelp(self):
        print("=========================================================================================")
        print("|                        PCAN-Basic CSV Sender                                          |")
        print("=========================================================================================")

    def ShowStatus(self,status):
        print("=========================================================================================")
        print(self.GetFormattedError(status))
        print("=========================================================================================")
    
    def GetFormattedError(self, error):
        stsReturn = self.m_objPCANBasic.GetErrorText(error,0x09)
        if stsReturn[0] != PCAN_ERROR_OK:
            return "An error occurred. Error-code's text ({0:X}h) couldn't be retrieved".format(error)
        else:
            message = str(stsReturn[1])
            return message.replace("'","",2).replace("b","",1)
    #endregion

if __name__ == '__main__':
    TimerWriteCSV()
