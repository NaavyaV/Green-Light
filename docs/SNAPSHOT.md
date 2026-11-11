# Green-Light snapshot contract (team review draft)

Status: proposed for review by Sanjit and Sanjana. The existing JSONL v1
fields remain compatible. The fields below are additive. Coordinate any
future rename or semantic change with consumers before publishing it.

One JSON object per completed simulated second. See the
[full v1 schema](../src/engine/README.md#snapshot-schema-version-1)
for time, active phase, elapsed signal state, queue, arrivals, departures,
cumulative throughput, completed wait, movement order, and forecast fields.

| Field | Meaning |
|---|---|
| `model_status` | `disabled`, `warming_up`, `ready`, or `invalid_output`. |
| `forecast` | Existing 12 next-30-second counts and generation timestamp. Null unless ready. Speed provenance remains `imputed_training_mean`. |
| `lights` | All 12 movement names mapped to `green`, `yellow`, or `red` for the completed interval. |
| `decision.source` | Same value as existing `decision_source`. Null for fixed/reactive modes. |
| `decision.action` | `hold` for continued green, `switch` when green ends and yellow starts, or `clearance` while advancing through yellow/all-red. |
| `decision.text` | Factual summary of the controller update. |
| `decision.next_phase`, `decision.next_light_state` | Actual signal phase and light state for the next simulated interval. These describe one interval only. |
| `decision.recommendation`, `decision.agrees_with_model` | Null. The MLP predicts arrivals and makes no signal recommendation. |
| `seconds_left` | Exact remaining seconds during fixed green or clearance. Adaptive green is null until a transition is committed, when the value is zero. |
| `projection_method` | `uniform_arrivals_frozen_forecast` when a forecast is available, otherwise null. |
| `schedule` | Projected phase and light-state segments with absolute `start` and exclusive `end` times covering [t,t+30). Null without a forecast. |
| `queue_forecast` | Per-movement projected queue series with 31 points from now through +30 seconds. Null without a forecast. |
| `vehicles` | Null. The queue model does not track vehicle coordinates. A capped queue visualization can use counts and a `+N` label. |
| `forecast_error` | Latest completed score with `generated_at_seconds`, `evaluated_at_seconds`, and `mae_vehicles` across the 12 movements. Null before second 90. |

Confidence is omitted. The current model supplies no calibrated confidence.
Map C++ travel direction to the opposite entry approach in the existing
React adapter. Render null fields as unavailable and use `model_status` to
distinguish warm-up from unavailable inference.


The projection runs a copy of the current controller and queues for 30 seconds.
It spreads the latest forecast uniformly, floors cumulative arrivals to whole
vehicles, and caps projected arrivals at one vehicle per movement per second to
match the simulator. The forecast remains fixed during projection. The projection
uses neither future random arrivals nor future model updates. Its first signal
interval matches the controller's actual next state. Later intervals are estimates.

A forecast issued at t is scored against actual arrivals in [t,t+30). The latest
completed error is retained until another forecast matures. The first forecast at
second 60 therefore gets scored at second 90.
