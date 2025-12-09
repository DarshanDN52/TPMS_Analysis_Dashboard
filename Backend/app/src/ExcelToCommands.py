import pandas as pd
import random
import re

def process_command_master(output_file: str, input_file: str = "src/VECS Embedded Command Master.xlsx",):
    """
    Process the Embedded Command Master Excel file:
    - Cleans Default, Min, Max values
    - Handles 'Characters' by generating hex strings
    - Adds lessThanMin and greaterThanMax columns
    - Skips rows where Command Information = 'Reserved'
    - Converts Command Key to integer
    - Saves cleaned data to CSV
    """

    # Function to generate random hexadecimal string of given length
    def generate_hex_string(length):
        return ''.join(random.choice('0123456789ABCDEF') for _ in range(length))

    # Load Excel and skip first 3 rows
    df = pd.read_excel(input_file, skiprows=3)

    # Strip spaces from column names
    df.columns = [col.strip() for col in df.columns]

    # Propagate merged rows for key columns
    df[['Command Key', 'Default Value', 'Minimum Value', 'Maximum Value']] = df[['Command Key', 'Default Value', 'Minimum Value', 'Maximum Value']].ffill()

    # Extract columns
    command_keys = df.get('Command Key', []).tolist()
    command_info = df.get('Command Information', []).tolist()
    default_values = df.get('Default Value', []).tolist()
    minimum_values = df.get('Minimum Value', []).tolist()
    maximum_values = df.get('Maximum Value', []).tolist()

    # Combine into tuples
    result_array = list(zip(command_keys, command_info, default_values, minimum_values, maximum_values))

    # Process each tuple
    cleaned_array = []
    for cmd, cmd_info, default_val, min_val, max_val in result_array:
        # Skip if Command Information is "Reserved"
        if str(cmd_info).strip().lower() == "reserved":
            continue

        cmd_clean = str(cmd).strip()

        # Clean values
        default_clean = str(default_val).strip().replace('"', '')
        min_clean = str(min_val).strip().replace('"', '')
        max_clean = str(max_val).strip().replace('"', '')

        # Initialize lessThanMin and greaterThanMax
        less_than_min = ""
        greater_than_max = ""

        # Default Value cleaning
        if "Characters" in default_clean or "characters" in default_clean:
            num_chars = int(re.findall(r'\d+', default_clean)[0])
            default_clean = generate_hex_string(num_chars)
        else:
            default_clean = default_clean.split(" ")[0]

        # Minimum Value cleaning
        if "Characters" in min_clean or "characters" in min_clean:
            min_chars = int(re.findall(r'\d+', min_clean)[0])
            min_clean = generate_hex_string(min_chars)
            less_than_min = generate_hex_string(min_chars - 1) if min_chars > 1 else ""
        else:
            try:
                min_num = int(float(min_clean.split(" ")[0]))
                less_than_min = str(min_num - 1)
            except ValueError:
                min_num = None
            min_clean = min_clean.split(" ")[0]

        # Maximum Value cleaning
        if "Characters" in max_clean or "characters" in max_clean:
            max_chars = int(re.findall(r'\d+', max_clean)[0])
            max_clean = generate_hex_string(max_chars)
            greater_than_max = generate_hex_string(max_chars + 1)
        else:
            try:
                max_num = int(float(max_clean.split(" ")[0]))
                greater_than_max = str(max_num + 1)
            except ValueError:
                max_num = None
            max_clean = max_clean.split(" ")[0]

        cleaned_array.append((cmd_clean, default_clean, min_clean, max_clean, less_than_min, greater_than_max))

    # Convert to DataFrame
    cleaned_df = pd.DataFrame(cleaned_array, columns=['Command Key', 'Default Value', 'Minimum Value', 'Maximum Value', 'lessThanMin', 'greaterThanMax'])

    # Convert Command Key to int if numeric
    cleaned_df['Command Key'] = cleaned_df['Command Key'].apply(lambda x: int(float(x)) if str(x).replace('.', '', 1).isdigit() else x)

    # Save to CSV
    cleaned_df.to_csv(output_file, index=False)
    print(f"✅ Cleaned data saved to {output_file}")
