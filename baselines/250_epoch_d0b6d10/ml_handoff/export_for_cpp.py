"""
Export the Green Light MLP (teammate's models/traffic_mlp.pth) for the C++ team.

Run from the Green-Light repo root:
    KMP_DUPLICATE_LIB_OK=TRUE OMP_NUM_THREADS=1 python ml_handoff/export_for_cpp.py

Writes into ml_handoff/:
    model_weights.txt   plain-text weights + scaler (no libraries needed in C++)
    test_vectors.csv    5 example inputs with the exact outputs Python gives
    ML_INTERFACE.md     input/output spec for the C++ team
"""
import os, sys
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, MinMaxScaler


DATA, MODEL, OUT = "data/dataset_60_12.csv", "models/traffic_mlp.pth", "ml_handoff"
LAYERS = (0, 2, 4, 6)                       # indices of the Linear layers inside nn.Sequential
KEYS = [f"net.{i}.{p}" for i in LAYERS for p in ("weight", "bias")]


def forward(w, X):
    """Same math as the PyTorch model: 3 hidden Linear+ReLU layers, then a linear output."""
    h = X
    for j, i in enumerate(LAYERS):
        h = h @ w[f"net.{i}.weight"].T + w[f"net.{i}.bias"]
        if j < len(LAYERS) - 1:
            h = np.maximum(h, 0)
    return h


def fmt(a):
    return " ".join("%.9g" % v for v in np.ravel(a))


def write_weights(path, w, mean, scale, target_min, target_scale):
    sizes = [w["net.0.weight"].shape[1]] + [w[f"net.{i}.weight"].shape[0] for i in LAYERS]
    with open(path, "w") as f:
        f.write(f"{len(sizes)} {' '.join(map(str, sizes))}\n")
        f.write(fmt(mean) + "\n")
        f.write(fmt(scale) + "\n")
        f.write(fmt(target_min) + "\n")
        f.write(fmt(target_scale) + "\n")
        for i in LAYERS:
            for row in w[f"net.{i}.weight"]:          # one output neuron per line
                f.write(fmt(row) + "\n")
            f.write(fmt(w[f"net.{i}.bias"]) + "\n")
    return sizes


DOC = """# ML -> C++ interface (Green Light)

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
@@INPUTS@@

## Output vector (12 values, in exactly this order)
@@OUTPUTS@@

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
@@SCALE@@

@@SPEED@@
## Limitations
- Trained on NGSIM Lankershim Boulevard data; the pipeline is in the ML branch `scripts/`.
- Training used a random train/test split (not chronological), so reported error is likely optimistic.
- Pedestrians are not modeled.
"""


def run(weights, df):
    x_cols = [c for c in df.columns if not c.startswith("target_")]
    y_cols = [c for c in df.columns if c.startswith("target_")]
    if len(x_cols) != 60 or len(y_cols) != 12:
        sys.exit(f"Expected 60 inputs / 12 targets, found {len(x_cols)}/{len(y_cols)}: {list(df.columns)}")
    X, y = df[x_cols].values, df[y_cols].values

    # Rebuild the scaler exactly as the training script did (it never saved it).
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
    sc = StandardScaler().fit(Xtr)

    target_sc = MinMaxScaler().fit(ytr)
    pred_scaled = forward(weights, sc.transform(Xte))
    pred = target_sc.inverse_transform(pred_scaled)
    mae = np.abs(pred - yte).mean()
    rmse = np.sqrt(((pred - yte) ** 2).mean())
    base = np.abs(ytr.mean(0) - yte).mean()
    print(f"Rows: {len(df)}  (test rows: {len(Xte)})")
    print(f"Test MAE  = {mae:.4f}")
    print(f"Test RMSE = {rmse:.4f}")
    print(f"(Always-guess-the-average MAE = {base:.4f})")
    print(">>> Compare MAE/RMSE with the numbers printed when your teammate trained.")
    print(">>> They should match to ~3-4 decimals. If not, do NOT hand this off yet.")

    os.makedirs(OUT, exist_ok=True)
    sizes = write_weights(
        os.path.join(OUT, "model_weights.txt"),
        weights,
        sc.mean_,
        sc.scale_,
        target_sc.min_,
        target_sc.scale_,
    )

    idx = np.linspace(0, len(Xte) - 1, 5).astype(int)
    raw = Xte[idx]
    pred_scaled = forward(weights, sc.transform(raw))
    pred_counts = target_sc.inverse_transform(pred_scaled)
    tv = np.hstack([raw, pred_counts])
    pd.DataFrame(tv, columns=x_cols + ["pred_" + c for c in y_cols]).to_csv(
        os.path.join(OUT, "test_vectors.csv"), index=False, float_format="%.9g")

    inputs = "\n".join(f"| {i} | {c} |" for i, c in enumerate(x_cols))
    outputs = "\n".join(f"{i}. {c}" for i, c in enumerate(y_cols))
    scale = "\n".join(f"| {c} | {df[c].mean():.2f} | {df[c].max():.0f} |" for c in y_cols)
    sp = [c for c in x_cols if "speed" in c.lower()]
    speed = ""
    if sp:
        s = df[sp].values
        speed = (f"Speed inputs (`{sp[0]}` etc.) range from {s.min():.1f} to {s.max():.1f} "
                 f"(mean {s.mean():.1f}) in the training data. Use the same units.\n")
    doc = (DOC.replace("@@INPUTS@@", inputs).replace("@@OUTPUTS@@", outputs)
              .replace("@@SCALE@@", scale).replace("@@SPEED@@", speed))
    with open(os.path.join(OUT, "ML_INTERFACE.md"), "w") as f:
        f.write(doc)
    print(f"\nWrote model_weights.txt (sizes {sizes}), test_vectors.csv, ML_INTERFACE.md in {OUT}/")


def main():
    if not (os.path.exists(DATA) and os.path.exists(MODEL)):
        sys.exit("Run this from the Green-Light repo root (needs data/ and models/).")
    import torch
    sd = torch.load(MODEL, map_location="cpu")
    weights = {k: v.detach().cpu().numpy().astype(np.float64) for k, v in sd.items()}
    missing = [k for k in KEYS if k not in weights]
    if missing:
        sys.exit(f"Unexpected model layout. Missing {missing}. Found keys: {list(weights)}")
    run(weights, pd.read_csv(DATA))


if __name__ == "__main__":
    main()
