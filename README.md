# Green Light - Machine Learning Traffic Prediction Module

## Project Overview
This machine learning module processes vehicle trajectory data from the US DOT NGSIM dataset (Lankershim Boulevard) to predict traffic arrivals across 12 distinct intersection movements over a future 30-second window.

## Pipeline Architecture
1. `scripts/01_preprocess.py`: Extracts vehicle trajectories, filters for target intersections, and maps lanes into 12 movement direction codes.
2. `scripts/02_create_features.py`: Aggregates historical traffic data into rolling 5-second sampling steps to produce input features (X = 60) and future target counts (y = 12).
3. `scripts/03_train_model.py`: Trains a PyTorch Multi-Layer Perceptron (MLP) model, saves weights to `models/traffic_mlp.pth`, and outputs performance metrics.

## Model I/O Specifications

### Inputs (Shape: 1 x 60)
For each of the 12 movements (`N_LEFT`, `N_THROUGH`, `N_RIGHT`, `S_LEFT`, `S_THROUGH`, `S_RIGHT`, `E_LEFT`, `E_THROUGH`, `E_RIGHT`, `W_LEFT`, `W_THROUGH`, `W_RIGHT`), 5 features are calculated:
- `arr_5`: Vehicle arrivals in the past 5 seconds
- `arr_15`: Vehicle arrivals in the past 15 seconds
- `arr_30`: Vehicle arrivals in the past 30 seconds
- `arr_60`: Vehicle arrivals in the past 60 seconds
- `avg_speed`: Average speed over the past 60 seconds

### Outputs (Shape: 1 x 12)
Predicted vehicle arrival counts over the next 30 seconds for each movement:
`[N_LEFT, N_THROUGH, N_RIGHT, S_LEFT, S_THROUGH, S_RIGHT, E_LEFT, E_THROUGH, E_RIGHT, W_LEFT, W_THROUGH, W_RIGHT]`

## Network Architecture
- Input Layer: 60 units
- Hidden Layer 1: 128 units + ReLU activation
- Hidden Layer 2: 64 units + ReLU activation
- Hidden Layer 3: 32 units + ReLU activation
- Output Layer: 12 units
