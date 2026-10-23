import os
import pandas as pd
 
# NGSIM Lankershim codes
#   Direction: 1 = Eastbound, 2 = Northbound, 3 = Westbound, 4 = Southbound
#   Movement:  1 = Through,   2 = Left,       3 = Right
# Movement_Code uses the vehicle's direction of travel, e.g. N_LEFT = northbound vehicle turning left.
DIRECTION_MAP = {1: 'E', 2: 'N', 3: 'W', 4: 'S'}
TURN_MAP = {1: 'THROUGH', 2: 'LEFT', 3: 'RIGHT'}
 
 
def assign_movement_codes(df):
    """Combine Direction + Movement into one of the 12 movement codes (e.g. 'S_LEFT')."""
    for col in ('Direction', 'Movement'):
        if col not in df.columns:
            raise ValueError(f"NGSIM data is missing the '{col}' column, can't label movements.")
    d = df['Direction'].map(DIRECTION_MAP)
    m = df['Movement'].map(TURN_MAP)
    df['Movement_Code'] = d + '_' + m          # NaN if either code is unknown
    before = len(df)
    df = df.dropna(subset=['Movement_Code'])
    print(f"Labeled {len(df)} records ({before - len(df)} dropped with unknown Direction/Movement).")
    return df
 
 
def load_and_filter_ngsim(filepath):
    print("Loading NGSIM data... (this might take 30-60 seconds)")
 
    cols = ['Vehicle_ID', 'Global_Time', 'Local_X', 'Local_Y',
            'v_Vel', 'v_Acc', 'Lane_ID', 'Int_ID', 'Direction', 'Movement']
 
    df = pd.read_csv(filepath, usecols=lambda c: c in cols)
 
    if 'Int_ID' in df.columns:
        df = df[df['Int_ID'] == 1]
 
    df['Timestamp'] = pd.to_datetime(df['Global_Time'], unit='ms')
    df['Time_Sec'] = (df['Global_Time'] - df['Global_Time'].min()) / 1000.0
 
    df = assign_movement_codes(df)
    print(f"Filtered dataset down to {len(df)} records.")
    return df
 
 
if __name__ == "__main__":
    if os.path.exists("data/ngsim_raw.csv"):
        df = load_and_filter_ngsim("data/ngsim_raw.csv")
    else:
        # Raw file is gitignored. Re-label the existing cleaned file instead.
        print("data/ngsim_raw.csv not found, re-labeling data/ngsim_cleaned.csv")
        df = assign_movement_codes(pd.read_csv("data/ngsim_cleaned.csv", low_memory=False))
    df.to_csv("data/ngsim_cleaned.csv", index=False)
    print("Saved cleaned data to data/ngsim_cleaned.csv")
    print(df['Movement_Code'].value_counts().sort_index().to_string())
