# Green Light dashboard (frontend)

React + Vite dashboard for Green Light, the adaptive traffic signal project. It shows a simulated 4-way intersection, the ML model's 30-second forecast, and the C++ controller's signal decision, all updating live.

Right now the model and the controller are **stand-ins written in JavaScript** so the dashboard runs on its own. Each one sits in a single file with a fixed input/output shape, so the real PyTorch model and C++ engine can replace them without touching the UI.

## Run it

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

Requires Node 18 or newer.

## What's on screen

| Area | What it shows |
| --- | --- |
| Stats strip | Avg wait (last 60s), vehicles queued, throughput (veh/min), longest current wait, each with a 3-minute trend |
| Live intersection | Top-down simulation. Two inbound lanes per approach (left, through/right). Stop bars and signal heads show red/yellow/green |
| Signal phases | N/S Left, N/S Through, E/W Left, E/W Through. Click one to highlight the cars it would release. **Force phase** holds it manually, **Resume auto** hands control back |
| Queues tab | Each approach's left and through lights with countdowns, pedestrian WALK, queue by turn, measured arrivals |
| ML forecast tab | Recommended phase and duration, confidence, predicted queue per approach for the next 30s, predicted arrivals, output log |
| Controller tab | The decision (HOLD / SWITCH / CLEARANCE / MANUAL), whether it matched the model, the 30s signal schedule, rule checks, history |

On desktop everything fits on one screen. On phones the page scrolls and the tabs move to the top.

## How it works

Every animation frame the simulation moves the cars. Every **5 seconds** it runs one cycle:

1. `predict(sim)` (ML model) forecasts the next 30 seconds and recommends a phase.
2. `decide(sim, forecast)` (controller) checks that recommendation against the traffic rules and sets the signal schedule.
3. The panels show both, and the lights follow the schedule.

## Project structure

```
src/
  sim/
    constants.js     timing rules, phases, intersections, demand scenarios
    geometry.js      lane paths for every movement
    engine.js        Simulation class: cars, signal state machine, measurements, snapshot()
    mlModel.js       STAND-IN for the PyTorch model    ← replace with the real model
    controller.js    STAND-IN for the C++ controller   ← replace with the real engine
  canvas/
    drawIntersection.js   canvas drawing for the map and the phase icons
  hooks/
    useSimulation.js  runs the sim on requestAnimationFrame, gives React a snapshot 4x per second
    useTheme.js       reads CSS color tokens for canvas/SVG drawing
  components/        Header, KpiStrip, IntersectionPanel, PhaseSelector, SidePanel,
                     QueuesPanel, ForecastPanel, ForecastChart, ControllerPanel
  styles.css         design tokens (dark + light) and layout
```

## Plugging in the real model and controller

**ML model** (`src/sim/mlModel.js`). `predict` must return:

```js
{
  t: 72.0,                                    // sim time of the forecast
  series: { N: [5, 6, ...], S: [...], E: [...], W: [...] }, // queued vehicles at +0, +5, ..., +30s (7 values)
  arrivals: { NL: 1.4, NT: 4.1, NR: 0.9, ... },             // predicted arrivals per movement, next 30s
  recommendation: { phase: 3, duration: 14, confidence: 0.82 }, // phase index 0-3, seconds, 0-1
  error: 0.7,                                 // optional: error of the previous +5s prediction
  latencyMs: 3.1,
}
```

**Controller** (`src/sim/controller.js`). `decide` sets the schedule on `sim.sig` (`target` = green seconds for the current phase, `next` = next phase, `nextDur` = its planned green) and returns:

```js
{ t, action: 'HOLD N/S Through green +8s', reason: '...', agreement: 'ok' | 'adj' | 'ovr' | 'op', mlPhase, finalPhase }
```

Phase indexes: `0` N/S Left, `1` N/S Through (+ right), `2` E/W Left, `3` E/W Through (+ right).

When the backend is ready, the simplest swap is to have these two functions call it (for example, `fetch` a model endpoint) and map the response into the shapes above.

## Stand-in traffic rules

| Rule | Value |
| --- | --- |
| Min green | 7s |
| Max green | 40s |
| Yellow | 3s |
| All-red clearance | 1.5s |
| Starvation guard | no phase with waiting cars goes unserved for more than 80s |

All in `src/sim/constants.js`.

## Deploy (Cloudflare Pages)

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
