import pandas as pd
import numpy as np

def load_and_filter_ngsim(filepath):
    print("Loading NGSIM data... (this might take 30-60 seconds)")
    
    cols = ['Vehicle_ID', 'Global_Time', 'Local_X', 'Local_Y', 
            'v_Vel', 'v_Acc', 'Lane_ID', 'Int_ID', 'Direction', 'Movement']
    
    df = pd.read_csv(filepath, usecols=lambda c: c in cols)
    
    if 'Int_ID' in df.columns:
        df = df[df['Int_ID'] == 1]
    
    df['Timestamp'] = pd.to_datetime(df['Global_Time'], unit='ms')
    df['Time_Sec'] = (df['Global_Time'] - df['Global_Time'].min()) / 1000.0
    
    dir_map  = {1: 'E', 2: 'N', 3: 'S', 4: 'W'}
    turn_map = {1: 'THROUGH', 2: 'LEFT', 3: 'RIGHT'}
    df['Movement_Code'] = df['Direction'].map(dir_map) + '_' + df['Movement'].map(turn_map)
        
    df = df.dropna(subset=['Movement_Code'])
    print(f"Filtered dataset down to {len(df)} records.")
    return df

if __name__ == "__main__":
    df = load_and_filter_ngsim("data/ngsim_raw.csv")
    df.to_csv("data/ngsim_cleaned.csv", index=False)
    print("Saved cleaned data to data/ngsim_cleaned.csv")
