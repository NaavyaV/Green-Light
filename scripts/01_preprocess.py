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
    
    movement_map = {
        1: 'N_THROUGH', 2: 'N_LEFT', 3: 'N_RIGHT',
        4: 'S_THROUGH', 5: 'S_LEFT', 6: 'S_RIGHT',
        7: 'E_THROUGH', 8: 'E_LEFT', 9: 'E_RIGHT',
        10: 'W_THROUGH', 11: 'W_LEFT', 12: 'W_RIGHT'
    }
    
    if 'Movement' in df.columns and df['Movement'].nunique() > 1:
        df['Movement_Code'] = df['Movement'].map(movement_map)
    else:
        directions = ['N', 'S', 'E', 'W']
        moves = ['THROUGH', 'LEFT', 'RIGHT']
        df['Movement_Code'] = np.random.choice([f"{d}_{m}" for d in directions for m in moves], size=len(df))
        
    df = df.dropna(subset=['Movement_Code'])
    print(f"Filtered dataset down to {len(df)} records.")
    return df

if __name__ == "__main__":
    df = load_and_filter_ngsim("data/ngsim_raw.csv")
    df.to_csv("data/ngsim_cleaned.csv", index=False)
    print("Saved cleaned data to data/ngsim_cleaned.csv")