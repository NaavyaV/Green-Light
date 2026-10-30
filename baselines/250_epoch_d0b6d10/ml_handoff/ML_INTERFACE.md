# ML -> C++ interface (Green Light)

The model reads **60 numbers** describing recent traffic and returns **12 numbers**: the predicted
number of vehicles that will arrive at each movement over the **next 30 seconds**.
Call it every **5 simulated seconds**.

## Files
- `model_weights.txt` - the trained network and input scaling (format below)
- `traffic_mlp.hpp` - reference C++ loader + forward pass (header only, no dependencies)
- `test_mlp.cpp` - checks that C++ reproduces Python's outputs (see "Verify")
- `test_vectors.csv` - 5 example inputs with the exact outputs from Python

## Input vector (60 values, in exactly this order)
Per the ML README: `arr_5/15/30/60` are vehicle arrivals in the past 5/15/30/60 seconds, and
`avg_speed` is average speed over the past 60 seconds. Names below are the training-data column names.

| # | name |
|---|------|
| 0 | N_LEFT_arr5 |
| 1 | N_LEFT_arr15 |
| 2 | N_LEFT_arr30 |
| 3 | N_LEFT_arr60 |
| 4 | N_LEFT_avg_speed |
| 5 | N_THROUGH_arr5 |
| 6 | N_THROUGH_arr15 |
| 7 | N_THROUGH_arr30 |
| 8 | N_THROUGH_arr60 |
| 9 | N_THROUGH_avg_speed |
| 10 | N_RIGHT_arr5 |
| 11 | N_RIGHT_arr15 |
| 12 | N_RIGHT_arr30 |
| 13 | N_RIGHT_arr60 |
| 14 | N_RIGHT_avg_speed |
| 15 | S_LEFT_arr5 |
| 16 | S_LEFT_arr15 |
| 17 | S_LEFT_arr30 |
| 18 | S_LEFT_arr60 |
| 19 | S_LEFT_avg_speed |
| 20 | S_THROUGH_arr5 |
| 21 | S_THROUGH_arr15 |
| 22 | S_THROUGH_arr30 |
| 23 | S_THROUGH_arr60 |
| 24 | S_THROUGH_avg_speed |
| 25 | S_RIGHT_arr5 |
| 26 | S_RIGHT_arr15 |
| 27 | S_RIGHT_arr30 |
| 28 | S_RIGHT_arr60 |
| 29 | S_RIGHT_avg_speed |
| 30 | E_LEFT_arr5 |
| 31 | E_LEFT_arr15 |
| 32 | E_LEFT_arr30 |
| 33 | E_LEFT_arr60 |
| 34 | E_LEFT_avg_speed |
| 35 | E_THROUGH_arr5 |
| 36 | E_THROUGH_arr15 |
| 37 | E_THROUGH_arr30 |
| 38 | E_THROUGH_arr60 |
| 39 | E_THROUGH_avg_speed |
| 40 | E_RIGHT_arr5 |
| 41 | E_RIGHT_arr15 |
| 42 | E_RIGHT_arr30 |
| 43 | E_RIGHT_arr60 |
| 44 | E_RIGHT_avg_speed |
| 45 | W_LEFT_arr5 |
| 46 | W_LEFT_arr15 |
| 47 | W_LEFT_arr30 |
| 48 | W_LEFT_arr60 |
| 49 | W_LEFT_avg_speed |
| 50 | W_THROUGH_arr5 |
| 51 | W_THROUGH_arr15 |
| 52 | W_THROUGH_arr30 |
| 53 | W_THROUGH_arr60 |
| 54 | W_THROUGH_avg_speed |
| 55 | W_RIGHT_arr5 |
| 56 | W_RIGHT_arr15 |
| 57 | W_RIGHT_arr30 |
| 58 | W_RIGHT_arr60 |
| 59 | W_RIGHT_avg_speed |

## Output vector (12 values, in exactly this order)
0. target_N_LEFT
1. target_N_THROUGH
2. target_N_RIGHT
3. target_S_LEFT
4. target_S_THROUGH
5. target_S_RIGHT
6. target_E_LEFT
7. target_E_THROUGH
8. target_E_RIGHT
9. target_W_LEFT
10. target_W_THROUGH
11. target_W_RIGHT

## Scaling and post-processing
1. Standardize inputs: `x_scaled[i] = (x[i] - mean[i]) / scale[i]`.
2. Run the network (3 hidden ReLU layers and a linear output).
3. Convert normalized outputs back to vehicle counts:
   `y_counts[i] = (y_scaled[i] - target_min[i]) / target_scale[i]`.
4. Clamp negative vehicle counts to 0 in `predict()`.

## `model_weights.txt` format (whitespace-separated numbers)
- Line 1: `5 60 128 64 32 12`
- Line 2: input scaler means (60 numbers).
- Line 3: input scaler scales (60 numbers).
- Line 4: target MinMaxScaler `min_` (12 numbers).
- Line 5: target MinMaxScaler `scale_` (12 numbers).
- Remaining lines: network weights and biases for each layer.

## Verify (Week 4: "C++ receives the same predictions as Python")
```
g++ -std=c++17 -O2 test_mlp.cpp -o test_mlp
./test_mlp model_weights.txt test_vectors.csv     # should print PASS
```

## What the simulator must supply
- For each of the 12 movements: arrivals over the last 5, 15, 30 and 60 simulated seconds, plus average speed.
- At least **60 seconds of history** before the first valid prediction.
- **Gap to decide as a team:** `TrafficState` currently has no speed. The simulator must either produce a
  plausible average speed per movement, or the model must be retrained without the speed features.

## Typical scale in the training data (for realistic fake arrivals)
Next-30-second arrivals per movement:

| movement | mean | max |
|---|---|---|
| target_N_LEFT | 5.80 | 17 |
| target_N_THROUGH | 9.97 | 40 |
| target_N_RIGHT | 3.41 | 10 |
| target_S_LEFT | 6.12 | 16 |
| target_S_THROUGH | 15.41 | 44 |
| target_S_RIGHT | 3.65 | 11 |
| target_E_LEFT | 4.08 | 10 |
| target_E_THROUGH | 12.07 | 45 |
| target_E_RIGHT | 1.83 | 8 |
| target_W_LEFT | 3.31 | 10 |
| target_W_THROUGH | 9.94 | 38 |
| target_W_RIGHT | 2.14 | 7 |

Speed inputs (`N_LEFT_avg_speed` etc.) range from 0.0 to 26.1 (mean 7.9) in the training data. Use the same units.

## Limitations
- Trained on NGSIM Lankershim Boulevard data; the pipeline is in the ML branch `scripts/`.
- Training used a random train/test split (not chronological), so reported error is likely optimistic.
- Pedestrians are not modeled.
