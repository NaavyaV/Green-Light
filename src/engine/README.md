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
speeds and vehicle positions are outside the queue model.
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

`TrafficState::prediction` is populated in the optional forecast mode described
below. Only predictive mode uses forecasts for signal decisions.

## Reactive mode

```sh
/tmp/green-light-build/green_light 300 42 --controller fixed
/tmp/green-light-build/green_light 300 42 --controller reactive
```

Fixed remains the default; the original duration/seed syntax is unchanged.
Reactive decisions use queues at the end of each completed second. The simulator
records the actual FIFO head wait for each movement; no speed is inferred.
After minimum green, a nonempty phase normally holds for its nominal green batch
(10 seconds for left phases, 20 for through/right). After that batch, it switches
when alternative queue demand plus oldest wait / 5 exceeds current queue demand
multiplied by 1.5 plus current oldest wait / 5. This hysteresis amortizes the
five-second clearance cost. An empty phase releases early if another has demand.
Maximum green always forces a change. Phase selection ranks alternatives by
queue demand plus oldest wait / 5, resolving ties cyclically.

A continuously queued phase becomes overdue after twice (maximum green + yellow
+ all-red) seconds without green: 90 seconds by default. Overdue alternatives
outrank all others, ordered by their unserved duration. This overrides batching
and pressure after minimum green. Counters reset only on green or empty demand,
and continue during clearance. With four phases, persistent demand has a
conservative service-gap bound of threshold + four (maximum green + clearance)
intervals: 270 seconds by default. This bounds phase access, not individual
vehicle waiting under overloaded demand. Selected phases stay locked through
full yellow and all-red. Zero demand still cycles at maximum green.

The constants are shared across all seeds, with no per-seed tuning. The policy
uses no randomness or forecasts, and fixed-time logic is unchanged.

### Historical greedy comparison (before bounded policy, seed 42)

| Metric | Fixed | Reactive |
|---|---:|---:|
| Arrivals (identical each second and movement) | 706 | 706 |
| Cumulative departures / throughput | 519 | 417 |
| Final queued vehicles | 187 | 289 |
| Mean departed-vehicle wait (seconds) | 48.691715 | 48.446043 |
| Accrued queued vehicle-seconds | 34400 | 46160 |
| Accrued wait per arrival (seconds, including ongoing waits) | 48.725212 | 65.382436 |

Final queues in ML order:

- Fixed: `[17,32,2,6,40,1,3,25,4,19,36,2]`
- Reactive: `[43,30,1,32,41,0,21,32,3,45,40,1]`

Reactive performs worse in this run: fewer departures, a larger remaining queue,
and more accrued waiting. Its slightly lower departed-only mean excludes the
larger number of unserved vehicles and should not be read as an overall benefit.
These are finite-horizon results for one seed in the abstract queue model, not a
claim about general performance. A reference build of commit `66ecd33` produces
byte-identical fixed-mode output for the full 300-second run.

Tests additionally verify reactive minimum/maximum green, exact clearance timing,
locked next-phase selection, queue-based selection/extension, zero-demand ties,
nonconflicting green masks, conservation, deterministic replay, and identical
arrivals between modes over 5,000 seconds.


### Bounded policy comparison (300 seconds, default demand and timing)

Run the three-controller benchmark below to reproduce the fixed/reactive rows.
Historical greedy rows were reproduced from commit `7e9db92` with the same seeds.
Every mode receives identical per-second movement arrivals for each seed.

| Seed | Policy | Arrivals | Departures | Final queue | Queued vehicle-seconds | Clearance seconds |
|---|---|---:|---:|---:|---:|---:|
| 42 | Fixed | 706 | 519 | 187 | 34400 | 75 |
| 42 | Previous greedy | 706 | 417 | 289 | 46160 | 145 |
| 42 | Bounded reactive | 706 | 526 | 180 | 31928 | 80 |
| 7 | Fixed | 712 | 520 | 192 | 33550 | 75 |
| 7 | Previous greedy | 712 | 411 | 301 | 43821 | 149 |
| 7 | Bounded reactive | 712 | 527 | 185 | 28543 | 80 |
| 123 | Fixed | 707 | 526 | 181 | 30873 | 75 |
| 123 | Previous greedy | 707 | 413 | 294 | 44691 | 147 |
| 123 | Bounded reactive | 707 | 521 | 186 | 29703 | 79 |

The previous policy reconsidered small raw queue differences every second after
minimum green. Four-movement through/right groups also tended to dominate summed
demand over two-movement left groups. This produced short greens, almost half the
run lost to clearance, and unbounded service gaps. Batching, hysteresis, actual
head-wait pressure and overdue priority address these causes without forecasting.

Compared with the old reactive policy, throughput and queued vehicle-seconds
improve on all three seeds. Compared with fixed-time, queued vehicle-seconds
improve on all three; throughput improves on 42 and 7 but decreases by five on
123. These finite-horizon results do not establish universal superiority. Tests
cover persistent highly imbalanced queues, bounded phase access, batching,
waiting-aware selection, replay, conservation, and all safety transitions.

## Optional simulator forecasting

```sh
/tmp/gl-nov5-build/green_light 75 42 --controller reactive \
  --ml-impute-speed ml_handoff/model_weights.txt
```

The opt-in flag loads the frozen C++ MLP and adds forecast lines at simulated
seconds 60, 65, 70, and so on. Each forecast covers the following 30 seconds
and is retained in `TrafficState::prediction` until the next forecast. Fixed and reactive modes
leave the forecast out of their decisions. The original CLI output is unchanged by default.

At time `t`, the four windows count simulator arrivals in `[t-width,t)` in
vehicles, grouped by the exported movement order. Each movement's fifth
feature uses its exported training mean for speed, in the model's original
speed units. This is explicit mean imputation, not a simulated or measured
speed. It makes the standardized speed inputs zero. Queue length, throughput,
and waiting time cannot recover speed in this simulator because there are no
trajectories or distances. The training data counts distinct observed vehicles
per five-second bucket, which can include a vehicle in multiple buckets.
Simulator arrivals count entry events only, so the input distributions can differ.

This mode demonstrates runtime inference, not validated forecast quality.
A deployment needs compatible speed observations and evaluation on the intended
traffic stream, or a separately trained and validated model without speed.


## Predictive mode

From the repository root, build and run:

```sh
cmake -S . -B /tmp/green-light-build
cmake --build /tmp/green-light-build
ctest --test-dir /tmp/green-light-build --output-on-failure
/tmp/green-light-build/green_light 300 42 --controller predictive --ml-impute-speed ml_handoff/model_weights.txt
/tmp/green-light-build/green_light 300 42 --controller predictive
/tmp/green-light-build/controller_benchmark ml_handoff/model_weights.txt
```

The first predictive command opts into inference with imputed training-mean
speed. The second runs reactive fallback because the queue simulator supplies
no speed observations and no model is configured. Warm-up also uses fallback.
An explicitly configured model that fails to load remains a startup error.

The existing protected phase masks define the candidate movements:

| Phase | Movements |
|---|---|
| NS_LEFT | N_LEFT, S_LEFT |
| NS_THROUGH_RIGHT | N_THROUGH, N_RIGHT, S_THROUGH, S_RIGHT |
| EW_LEFT | E_LEFT, W_LEFT |
| EW_THROUGH_RIGHT | E_THROUGH, E_RIGHT, W_THROUGH, W_RIGHT |

For each phase, sum its movement queues and add the oldest FIFO wait in seconds
divided by five. Predictive mode also adds one-third of the sum of the phase's
predicted 30-second arrivals. That term estimates arrivals in ten seconds
under a uniform arrival assumption and is expressed in vehicles. After the
nominal green batch, an alternative's score must exceed the current phase's
score with its queue term multiplied by 1.5. The reactive rules still govern
empty-queue release, minimum and maximum green, cyclic tie-breaking, and
clearance. Overdue queued phases take priority using the existing service-gap
counters and queue-based tie-breaking. Forecast updates cannot change the next
phase once yellow starts.

Status lines describe the signal interval just served. In predictive mode the
`decision` label describes the subsequent controller update. It reads
`predictive_imputed_speed` when ranking uses the model, `reactive_fallback`
when ranking uses queues and waits alone, and `safety_timing` when clearance,
minimum green, or overdue priority governs the update. Forecasts first become
available at second 60 and refresh every five seconds.

The benchmark uses 300 seconds of identical seeded arrivals per controller.
Its fairness column measures the longest observed consecutive interval with a
nonempty movement queue and no green, including yellow and all-red. It is a
finite-run phase access measure. Individual vehicles may wait longer. For seeds
42, 7, and 123, predictive changed departures versus reactive by −5, +14, and +2,
and changed queued vehicle-seconds by +171, −69, and −18. The fairness measure
matched reactive on all three seeds. These runs exercise the controller with
imputed speed and synthetic arrivals. Accuracy with observed speeds and
performance on other traffic distributions remain unverified.
