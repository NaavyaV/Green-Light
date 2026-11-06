import { APPROACHES, MOVES, PHASES, CFG, FORECAST_STEPS, FORECAST_EVERY } from './constants.js';

/**
 * STAND-IN for the PyTorch model.
 *
 * Runs every 5 seconds. Replace the body of `predict` with a call to the real model service
 * and return the same shape, and the dashboard keeps working unchanged.
 *
 * @returns {{
 *   t: number,                                  // sim time the forecast was made
 *   series: Record<'N'|'S'|'E'|'W', number[]>,  // predicted queued vehicles per approach at +0,+5,...,+30s
 *   arrivals: Record<string, number>,           // predicted arrivals per movement over the next 30s ('NL', 'NT', ...)
 *   recommendation: { phase: number, duration: number, confidence: number }, // phase index, seconds, 0..1
 *   error: number|null,                         // mean abs error of the previous forecast's +5s value (veh)
 *   latencyMs: number,
 * }}
 */
export function predict(sim) {
  const q = sim.queues();
  const totals = sim.approachTotals(q);
  const plan = sim.plan(FORECAST_STEPS * FORECAST_EVERY);
  const noise = {};
  const series = {};
  const arrivals = {};
  APPROACHES.forEach((a) => { series[a] = [totals[a]]; });
  APPROACHES.forEach((a) => MOVES.forEach((m) => {
    noise[a + m] = Math.max(0.6, 1 + gauss() * 0.15);
    arrivals[a + m] = 0;
  }));

  // Roll queues forward in 5s steps under the controller's current signal plan
  const qm = { ...q };
  for (let k = 1; k <= FORECAST_STEPS; k++) {
    const t0 = (k - 1) * FORECAST_EVERY;
    const t1 = k * FORECAST_EVERY;
    APPROACHES.forEach((a) => {
      const sharedLoad = qm[a + 'T'] + qm[a + 'R'] + 1e-6;
      MOVES.forEach((m) => {
        const mv = a + m;
        const lambda = sim.rate(a, m, sim.T + t0 + FORECAST_EVERY / 2) * noise[mv];
        const inflow = lambda * FORECAST_EVERY;
        arrivals[mv] += inflow;
        const green = greenOverlap(plan, mv, t0, t1);
        const capacity = m === 'L'
          ? CFG.SAT_L * green
          : CFG.SAT_T * green * ((qm[mv] + 0.01) / (sharedLoad + 0.02));
        qm[mv] = Math.max(0, qm[mv] + inflow - Math.min(qm[mv] + inflow, capacity));
      });
      series[a].push(MOVES.reduce((s, m) => s + qm[a + m], 0));
    });
  }

  // Recommend the phase with the most demand (queued + arriving)
  const scores = PHASES.map((p) => p.moves.reduce((s, mv) => s + q[mv] + arrivals[mv], 0));
  const order = scores.map((s, i) => [s, i]).sort((x, y) => y[0] - x[0]);
  const phase = order[0][1];
  const confidence = clamp(0.55 + 0.42 * (order[0][0] - order[1][0]) / (order[0][0] + 1), 0.52, 0.97);

  let error = null;
  if (sim.forecast) {
    error = APPROACHES.reduce((s, a) => s + Math.abs(sim.forecast.series[a][1] - totals[a]), 0) / APPROACHES.length;
  }

  return {
    t: sim.T,
    series,
    arrivals,
    noise,
    recommendation: { phase, duration: sim.durFor(phase), confidence },
    error,
    latencyMs: 2.1 + Math.random() * 2.6,
  };
}

function greenOverlap(plan, mv, a, b) {
  let g = 0;
  for (const s of plan) {
    if (s.kind === 'G' && PHASES[s.phase].moves.includes(mv)) g += Math.max(0, Math.min(b, s.t1) - Math.max(a, s.t0));
  }
  return g;
}
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.8; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
