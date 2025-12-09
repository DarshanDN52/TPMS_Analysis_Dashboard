
import csv

def generate_combinations(input_file, output_file, prefix):
    with open(input_file, "r") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    # Generate combinations
    combinations = []
    for row in rows:
        command_key = row["Command Key"]
        for col in ["Default Value", "Minimum Value", "Maximum Value", "lessThanMin", "greaterThanMax"]:
            value = row[col].strip()
            if value:  # Skip empty values
                combinations.append(f"{prefix}{command_key}:{value}*")

    # Write to output CSV
    with open(output_file, "a", newline="") as f:
        writer = csv.writer(f)
        for combo in combinations:
            writer.writerow([combo])

    print(f"✅ Generated {len(combinations)} combinations and saved them to {output_file}.")


def clear_output_file(output_file):
    """Clears the content of the output file before writing new data."""
    with open(output_file, "w", newline="") as f:
        writer = csv.writer(f)

