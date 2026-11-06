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
| `seconds_left`, `schedule` | Null. A one-step decision does not establish a 30-second signal schedule. |
| `queue_forecast` | Null. Needs time-distributed arrivals and a service plan. |
| `vehicles` | Null. The queue model does not track vehicle coordinates. A capped queue visualization can use counts and a `+N` label. |
| `forecast_error` | Null until implemented. Score a forecast issued at t against actual arrivals in [t,t+30), once second t+30 completes. |

Confidence is omitted. The current model supplies no calibrated confidence.
Map C++ travel direction to the opposite entry approach in the existing
React adapter. Render null fields as unavailable and use `model_status` to
distinguish warm-up from unavailable inference.
