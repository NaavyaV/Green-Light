# ML → C++ Interface (Green Light)

The model reads **60 numbers** describing recent traffic and returns **12 numbers**: the predicted number of vehicles arriving at each movement over the **next 30 seconds**.

Call it every **5 simulated seconds**.

## Files

- `model_weights.txt` — The trained network and input scaling parameters.
- `traffic_mlp.hpp` — Reference C++ loader and forward pass (header-only, no dependencies).
- `test_mlp.cpp` — Checks that C++ reproduces Python's outputs.
- `test_vectors.csv` — Five example inputs with the corresponding outputs from Python.

## Input Vector (60 Values, in Exactly This Order)

According to the ML README, `arr_5`, `arr_15`, `arr_30`, and `arr_60` represent vehicle arrivals over the previous 5, 15, 30, and 60 seconds. `avg_speed` represents average speed over the previous 60 seconds.

The names below are the training-data column names.

| Index | Feature |
|---:|---|
| 0 | `N_LEFT_arr5` |
| 1 | `N_LEFT_arr15` |
| 2 | `N_LEFT_arr30` |
| 3 | `N_LEFT_arr60` |
| 4 | `N_LEFT_avg_speed` |
| 5 | `N_THROUGH_arr5` |
| 6 | `N_THROUGH_arr15` |
| 7 | `N_THROUGH_arr30` |
| 8 | `N_THROUGH_arr60` |
| 9 | `N_THROUGH_avg_speed` |
| 10 | `N_RIGHT_arr5` |
| 11 | `N_RIGHT_arr15` |
| 12 | `N_RIGHT_arr30` |
| 13 | `N_RIGHT_arr60` |
| 14 | `N_RIGHT_avg_speed` |
| 15 | `S_LEFT_arr5` |
| 16 | `S_LEFT_arr15` |
| 17 | `S_LEFT_arr30` |
| 18 | `S_LEFT_arr60` |
| 19 | `S_LEFT_avg_speed` |
| 20 | `S_THROUGH_arr5` |
| 21 | `S_THROUGH_arr15` |
| 22 | `S_THROUGH_arr30` |
| 23 | `S_THROUGH_arr60` |
| 24 | `S_THROUGH_avg_speed` |
| 25 | `S_RIGHT_arr5` |
| 26 | `S_RIGHT_arr15` |
| 27 | `S_RIGHT_arr30` |
| 28 | `S_RIGHT_arr60` |
| 29 | `S_RIGHT_avg_speed` |
| 30 | `E_LEFT_arr5` |
| 31 | `E_LEFT_arr15` |
| 32 | `E_LEFT_arr30` |
| 33 | `E_LEFT_arr60` |
| 34 | `E_LEFT_avg_speed` |
| 35 | `E_THROUGH_arr5` |
| 36 | `E_THROUGH_arr15` |
| 37 | `E_THROUGH_arr30` |
| 38 | `E_THROUGH_arr60` |
| 39 | `E_THROUGH_avg_speed` |
| 40 | `E_RIGHT_arr5` |
| 41 | `E_RIGHT_arr15` |
| 42 | `E_RIGHT_arr30` |
| 43 | `E_RIGHT_arr60` |
| 44 | `E_RIGHT_avg_speed` |
| 45 | `W_LEFT_arr5` |
| 46 | `W_LEFT_arr15` |
| 47 | `W_LEFT_arr30` |
| 48 | `W_LEFT_arr60` |
| 49 | `W_LEFT_avg_speed` |
| 50 | `W_THROUGH_arr5` |
| 51 | `W_THROUGH_arr15` |
| 52 | `W_THROUGH_arr30` |
| 53 | `W_THROUGH_arr60` |
| 54 | `W_THROUGH_avg_speed` |
| 55 | `W_RIGHT_arr5` |
| 56 | `W_RIGHT_arr15` |
| 57 | `W_RIGHT_arr30` |
| 58 | `W_RIGHT_arr60` |
| 59 | `W_RIGHT_avg_speed` |

## Output Vector (12 Values, in Exactly This Order)

The model returns predicted vehicle counts in the following order:

| Index | Output |
|---:|---|
| 0 | `target_N_LEFT` |
| 1 | `target_N_THROUGH` |
| 2 | `target_N_RIGHT` |
| 3 | `target_S_LEFT` |
| 4 | `target_S_THROUGH` |
| 5 | `target_S_RIGHT` |
| 6 | `target_E_LEFT` |
| 7 | `target_E_THROUGH` |
| 8 | `target_E_RIGHT` |
| 9 | `target_W_LEFT` |
| 10 | `target_W_THROUGH` |
| 11 | `target_W_RIGHT` |

## Scaling and Post-Processing

1. Scale each input using:

   `x_scaled[i] = (x[i] - mean[i]) / scale[i]`

   The means and scales are stored on lines 2 and 3 of `model_weights.txt`.

2. Run the neural network, which has three hidden layers with ReLU activation and a linear output layer.

3. **Outputs are not scaled.** They represent predicted vehicle counts over the next 30 seconds.

4. Clamp negative predictions to zero. The network can return slightly negative values, and `predict()` in the C++ header handles this.

## `model_weights.txt` Format

The file contains whitespace-separated numbers.

- **Line 1:** Number of layer sizes, followed by the sizes: `5 60 128 64 32 12`.
- **Line 2:** Input-scaler means (60 numbers).
- **Line 3:** Input-scaler scales (60 numbers).
- **Remaining lines:** For each of the four network layers, the weight matrix (one line per output neuron, with one weight per input), followed by one line of biases.

## Verification

The goal is to verify that C++ reproduces the same predictions as Python.

Run the following commands from the `ml_handoff` directory:

```bash
g++ -std=c++17 -O2 test_mlp.cpp -o test_mlp
./test_mlp model_weights.txt test_vectors.csv