
import pandas as pd
import os
from pathlib import Path

def check_excel(path):
    p = Path(path)
    if not p.exists():
        print(f"File {p} does not exist.")
        return
    print(f"Checking {p} (Size: {p.stat().st_size} bytes)")
    try:
        xl = pd.ExcelFile(str(p), engine='openpyxl')
        print(f"Sheets: {xl.sheet_names}")
        for sheet in xl.sheet_names:
            df = pd.read_excel(str(p), sheet_name=sheet, engine='openpyxl')
            print(f"  Sheet '{sheet}': {len(df)} rows")
    except Exception as e:
        print(f"  Error reading {p}: {e}")

print("--- Checking dash1 directory ---")
check_excel("d:/zynrova projects/dash1/dash1/ubpl_Database.xlsx")
check_excel("d:/zynrova projects/dash1/dash1/ubpl_Dashboard_Output.xlsx")

print("\n--- Checking dash-frontend/api directory ---")
check_excel("d:/zynrova projects/dash1/dash-frontend/api/ubpl_Database.xlsx")
check_excel("d:/zynrova projects/dash1/dash-frontend/api/ubpl_Dashboard_Output.xlsx")
