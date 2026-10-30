# Fixed-time C++ engine (Stages 1–2)

From the repository root:

```sh
cmake -S . -B /tmp/green-light-build -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/green-light-build
ctest --test-dir /tmp/green-light-build --output-on-failure
/tmp/green-light-build/green_light 60 42
```

Arguments are duration in simulated seconds and random seed. Configuration is in
`SimulationConfig`: twelve independent Bernoulli probabilities (0–1 arrivals per
movement per second), service capacity per green second, and a fixed signal plan.
The default seed is 42. No physical speed or ML input is inferred from these queues.

The queue list in each status line follows ML_INTERFACE.md exactly:
N_LEFT, N_THROUGH, N_RIGHT, S_LEFT, S_THROUGH, S_RIGHT,
E_LEFT, E_THROUGH, E_RIGHT, W_LEFT, W_THROUGH, W_RIGHT.
Directions indicate travel direction, as in ML preprocessing.

Four protected phase groups cycle: NS left; NS through/right; EW left; EW
through/right. Default greens are 10/20/10/20 seconds, bounded by 5–40 seconds.
Every green ends with 3 seconds of yellow and 2 seconds of all-red. No departures
occur during clearance. Right-on-red, pedestrians, shared-lane constraints, travel
speeds, vehicle positions, reactive control and predictive control are not modeled.
Different phase groups are conservatively considered conflicting; no greens from
different groups are shown simultaneously.

Each step represents [t,t+1): arrivals join at t, FIFO service occurs at t under
the interval's signal, and remaining queued vehicles accrue one second of wait.
An arrival served immediately has zero wait. The status timestamp is t+1 and its
signal identifies the interval just completed (not the following interval).
Queues are unbounded; vehicles never disappear or spill back into other movements.
Throughput is cumulative departures. `avg_wait` is the mean queue wait among
**departed** vehicles; it excludes vehicles still queued. Per-movement state also
retains cumulative queued vehicle-seconds (including ongoing waits), departed wait,
arrivals/departures for the last second, and their cumulative totals. No statistics
claim real-world validation. This is an abstract queue simulation, separate from React.

`Prediction` is only a future integration data structure. `TrafficState::prediction`
is empty throughout these stages. The fixed controller never reads forecasts.
The ML handoff and standalone demo are unchanged.
