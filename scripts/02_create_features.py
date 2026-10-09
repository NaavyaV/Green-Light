import pandas as pd
import numpy as np

MOVEMENTS = [
    'N_LEFT', 'N_THROUGH', 'N_RIGHT',
    'S_LEFT', 'S_THROUGH', 'S_RIGHT',
    'E_LEFT', 'E_THROUGH', 'E_RIGHT',
    'W_LEFT', 'W_THROUGH', 'W_RIGHT'
]

def generate_training_data_fast(df, step_size=5):
    print("Pre-aggregating vehicle data for speed...")
    
    # Floor time into 5-second buckets for fast lookup
    df['Time_Bucket'] = (df['Time_Sec'] // step_size) * step_size
    
    # Pre-group counts per movement per 5s bucket
    grouped_counts = df.groupby(['Time_Bucket', 'Movement_Code'])['Vehicle_ID'].nunique().unstack(fill_value=0)
    grouped_speeds = df.groupby(['Time_Bucket', 'Movement_Code'])['v_Vel'].mean().unstack(fill_value=0)

    # Ensure all 12 movements exist in columns
    for m in MOVEMENTS:
        if m not in grouped_counts.columns:
            grouped_counts[m] = 0
        if m not in grouped_speeds.columns:
            grouped_speeds[m] = 0

    max_bucket = int(df['Time_Bucket'].max())
    rows = []

    # Process timestamps in 5s increments
    for t in range(60, max_bucket - 30, step_size):
        feature_row = {}
        
        for m in MOVEMENTS:
            # Historical arrivals
            f_arr5  = grouped_counts.loc[(grouped_counts.index >= t - 5)  & (grouped_counts.index < t), m].sum()
            f_arr15 = grouped_counts.loc[(grouped_counts.index >= t - 15) & (grouped_counts.index < t), m].sum()
            f_arr30 = grouped_counts.loc[(grouped_counts.index >= t - 30) & (grouped_counts.index < t), m].sum()
            f_arr60 = grouped_counts.loc[(grouped_counts.index >= t - 60) & (grouped_counts.index < t), m].sum()
            
            # Historical speed
            f_speed = grouped_speeds.loc[(grouped_speeds.index >= t - 60) & (grouped_speeds.index < t), m].mean()
            
            feature_row[f"{m}_arr5"] = f_arr5
            feature_row[f"{m}_arr15"] = f_arr15
            feature_row[f"{m}_arr30"] = f_arr30
            feature_row[f"{m}_arr60"] = f_arr60
            feature_row[f"{m}_avg_speed"] = 0.0 if np.isnan(f_speed) else f_speed

        # Future targets (next 30s)
        for m in MOVEMENTS:
            target_arr = grouped_counts.loc[(grouped_counts.index >= t) & (grouped_counts.index < t + 30), m].sum()
            feature_row[f"target_{m}"] = target_arr

        rows.append(feature_row)

    return pd.DataFrame(rows)

if __name__ == "__main__":
    print("Loading cleaned dataset...")
    df = pd.read_csv("data/ngsim_cleaned.csv", low_memory=False)
    
    # Process up to first 1,000 seconds to generate a solid training dataset instantly
    if df['Time_Sec'].max() > 1000:
        df = df[df['Time_Sec'] <= 1000]

    dataset = generate_training_data_fast(df)
    dataset.to_csv("data/dataset_60_12.csv", index=False)
    print(f"Done! Created dataset with {len(dataset)} samples saved to data/dataset_60_12.csv")