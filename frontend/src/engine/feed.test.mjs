// Tests for feed.js using real output from the C++ engine.
//   npm test          (from frontend/)
// Needs a built engine at ../build/green_light[.exe] (or GL_ENGINE).
// Each value is checked against an independent calculation from the raw
// snapshots, not against feed.js's own formulas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseReplay } from '../../../integration/replay.mjs';
import { CAR, PHASES, STOP } from '../sim/constants.js';
import { EngineSim, LANE_SLOTS } from './EngineSim.js';
import { applyHello, applySnapshot, applyStatus, buildView, createFeedState } from './feed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENGINE = process.env.GL_ENGINE ??
  path.join(ROOT, 'build', process.platform === 'win32' ? 'green_light.exe' : 'green_light');
const WEIGHTS = path.join(ROOT, 'ml_handoff', 'model_weights.txt');

function runEngine(seconds, seed, controller = 'predictive') {
  assert.ok(fs.existsSync(ENGINE), `Engine not built at ${ENGINE}; build it before running these tests.`);
  const r = spawnSync(ENGINE, [String(seconds), String(seed), '--controller', controller,
    '--demand', 'normal', '--ml-impute-speed', WEIGHTS, '--format', 'jsonl'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr);
  return parseReplay(r.stdout);
}

const RUN = runEngine(400, 42);
const BRIDGE = { status: 'running', paused: false, speed: 1, settings: { seed: 42, controller: 'predictive', demand: 'normal' }, error: null };

// Feed snapshots [0, n) and return the view after the last one.
function viewAfter(n, frames = RUN, startState) {
  const state = startState ?? applyHello(createFeedState(), { ...BRIDGE, history: [] });
  for (let i = 0; i < n; i++) applySnapshot(state, frames[i]);
  return { state, view: buildView(state) };
}

// Travel direction (engine) -> entry approach (dashboard), written out independently.
const ENTRY = {
  N_LEFT: 'SL', N_THROUGH: 'ST', N_RIGHT: 'SR', S_LEFT: 'NL', S_THROUGH: 'NT', S_RIGHT: 'NR',
  E_LEFT: 'WL', E_THROUGH: 'WT', E_RIGHT: 'WR', W_LEFT: 'EL', W_THROUGH: 'ET', W_RIGHT: 'ER',
};
const ENGINE_PHASES = ['NS_LEFT', 'NS_THROUGH_RIGHT', 'EW_LEFT', 'EW_THROUGH_RIGHT'];
const byEntry = (raw, field) =>
  Object.fromEntries(raw.movement_order.map((m, i) => [ENTRY[m], raw[field][i]]));

// Rebuild every vehicle's wait from arrivals and departures (the engine's queues are FIFO).
function departuresWithWaits(frames) {
  const queues = Object.fromEntries(Object.keys(ENTRY).map((m) => [m, []]));
  const out = []; // { T, wait }
  for (const raw of frames) {
    raw.movement_order.forEach((m, i) => {
      for (let k = 0; k < raw.arrivals[i]; k++) queues[m].push(raw.time_seconds);
      for (let k = 0; k < raw.departures[i]; k++) out.push({ T: raw.time_seconds, wait: raw.time_seconds - queues[m].shift() });
    });
  }
  return out;
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// ----- tests -----------------------------------------------------------------

test('queues are mapped from travel direction to entry approach, and totals add up', () => {
  for (const n of [1, 75, 400]) {
    const { view } = viewAfter(n);
    const raw = RUN[n - 1];
    assert.deepEqual(view.stats.queues, byEntry(raw, 'queues'));
    assert.equal(view.stats.totalQueued, raw.queues.reduce((s, q) => s + q, 0));
    for (const a of ['N', 'S', 'E', 'W']) {
      assert.equal(view.approachTotals[a], ['L', 'T', 'R'].reduce((s, m) => s + view.stats.queues[a + m], 0));
    }
    PHASES.forEach((p, i) => {
      assert.equal(view.phaseQueued[i], p.moves.reduce((s, mv) => s + view.stats.queues[mv], 0));
    });
  }
});

test('signal fields follow the snapshot', () => {
  for (let n = 1; n <= 200; n++) {
    const { view } = viewAfter(n);
    const raw = RUN[n - 1];
    assert.equal(view.T, raw.time_seconds);
    assert.equal(view.sig.phase, ENGINE_PHASES.indexOf(raw.phase));
    assert.equal(view.sig.stage, { green: 'G', yellow: 'Y', all_red: 'AR' }[raw.light_state]);
    assert.equal(view.sig.t, raw.phase_elapsed_seconds);
    const next = ENGINE_PHASES.indexOf(raw.decision.next_phase);
    assert.equal(view.sig.next, next === view.sig.phase ? null : next);
  }
});

test('the next phase shows during clearance and not while holding green', () => {
  let sawClearanceNext = false;
  for (let n = 1; n <= 400; n++) {
    const { view } = viewAfter(n);
    const raw = RUN[n - 1];
    if (raw.decision.action === 'hold') assert.equal(view.sig.next, null);
    if (raw.light_state === 'all_red' && view.sig.next !== null) sawClearanceNext = true;
  }
  assert.ok(sawClearanceNext, 'never saw the upcoming phase during all-red');
});

test('rolling throughput and average wait match a vehicle-by-vehicle reconstruction', () => {
  const waits = departuresWithWaits(RUN);
  // The reconstruction agrees with the engine's own running mean.
  const all = waits.reduce((s, d) => s + d.wait, 0) / waits.length;
  close(all, RUN.at(-1).mean_completed_wait_seconds, 'reconstructed mean vs engine');

  for (const n of [30, 60, 61, 120, 250, 400]) {
    const { view } = viewAfter(n);
    const T = RUN[n - 1].time_seconds;
    const inWindow = waits.filter((d) => d.T > T - 60 && d.T <= T);
    const seconds = Math.min(60, n);
    close(view.stats.throughput, (inWindow.length * 60) / seconds, `throughput at ${T}`);
    const expected = inWindow.length ? inWindow.reduce((s, d) => s + d.wait, 0) / inWindow.length : 0;
    close(view.stats.avgWait, expected, `avg wait at ${T}`);
  }
});

test('measured arrival rates are arrivals per approach over the last 60 s', () => {
  const { view } = viewAfter(300);
  const window = RUN.slice(240, 300);
  for (const a of ['N', 'S', 'E', 'W']) {
    const n = window.reduce((s, raw) => {
      const arr = byEntry(raw, 'arrivals');
      return s + arr[a + 'L'] + arr[a + 'T'] + arr[a + 'R'];
    }, 0);
    close(view.measuredRates[a], n, `rate ${a}`);
  }
});

test('sparklines sample every 2 s and keep 90 samples', () => {
  const { view } = viewAfter(400);
  assert.equal(view.history.queue.length, 90);
  assert.equal(view.history.wait.length, 90);
  assert.equal(view.history.thru.length, 90);
  assert.deepEqual(view.history.max, []); // no per-vehicle waits from the engine
  // Samples are the even seconds 222, 224, ..., 400.
  const expected = RUN.filter((r) => r.time_seconds % 2 === 0).slice(-90)
    .map((r) => r.queues.reduce((s, q) => s + q, 0));
  assert.deepEqual(view.history.queue, expected);
  assert.equal(viewAfter(9).view.history.queue.length, 4); // seconds 2, 4, 6, 8
});

test('the forecast is null while warming up, then mapped like the queues', () => {
  for (const n of [1, 30, 59]) {
    const { view } = viewAfter(n);
    assert.equal(view.forecast, null);
    assert.equal(view.engine.modelStatus, 'warming_up');
  }
  const { view, state } = viewAfter(67);
  const raw = RUN[66];
  assert.equal(view.engine.modelStatus, 'ready');
  assert.equal(view.forecast.generatedAt, raw.forecast.generated_at_seconds);
  assert.deepEqual(view.forecast.arrivals,
    Object.fromEntries(raw.movement_order.map((m, i) => [ENTRY[m], raw.forecast.arrivals[i]])));
  // A new forecast every 5 s from second 60: 60 and 65 so far, newest first.
  assert.deepEqual(state.mlLog.map((l) => l.t), [65, 60]);
});

test('nextForecastIn counts down to the 5-second forecast rhythm', () => {
  const values = [61, 62, 63, 64, 65].map((T) => viewAfter(T).view.nextForecastIn);
  assert.deepEqual(values, [4, 3, 2, 1, 5]);
});

test('longest phase wait matches an independent count', () => {
  for (const n of [50, 150, 400]) {
    const { view } = viewAfter(n);
    const lastGreen = [0, 0, 0, 0];
    for (const raw of RUN.slice(0, n)) {
      if (raw.light_state === 'green') lastGreen[ENGINE_PHASES.indexOf(raw.phase)] = raw.time_seconds;
    }
    const raw = RUN[n - 1];
    const current = ENGINE_PHASES.indexOf(raw.phase);
    const queues = byEntry(raw, 'queues');
    let expected = 0;
    PHASES.forEach((p, i) => {
      const waiting = p.moves.reduce((s, mv) => s + queues[mv], 0);
      if (i !== current && waiting > 0) expected = Math.max(expected, raw.time_seconds - lastGreen[i]);
    });
    assert.equal(view.longestPhaseWait, expected);
  }
});

test('joining mid-run: unknown phases give null, and the wait window starts after our first frame', () => {
  const state = applyHello(createFeedState(), { ...BRIDGE, history: RUN.slice(99, 130) }); // seconds 100-130
  const view = buildView(state);
  assert.equal(view.T, 130);
  // Some phase with waiting cars has not been green since second 100.
  const raw = RUN[129];
  const greensSeen = new Set(RUN.slice(99, 130).filter((r) => r.light_state === 'green').map((r) => r.phase));
  const queues = byEntry(raw, 'queues');
  const blind = PHASES.some((p, i) => ENGINE_PHASES[i] !== raw.phase && !greensSeen.has(ENGINE_PHASES[i]) &&
    p.moves.some((mv) => queues[mv] > 0));
  assert.ok(blind, 'test setup: expected a waiting phase that was not green in seconds 100-130');
  assert.equal(view.longestPhaseWait, null);

  const waits = departuresWithWaits(RUN).filter((d) => d.T > 100 && d.T <= 130);
  const expected = waits.length ? waits.reduce((s, d) => s + d.wait, 0) / waits.length : 0;
  close(view.stats.avgWait, expected, 'avg wait after joining');
  close(view.stats.throughput, (waits.length * 60) / 30, 'throughput after joining');
});

test('a second hello (restart) replaces all earlier state', () => {
  const { state } = viewAfter(300);
  const other = runEngine(20, 7, 'fixed');
  applyHello(state, { ...BRIDGE, settings: { seed: 7, controller: 'fixed', demand: 'normal' }, history: other });
  const view = buildView(state);
  assert.equal(view.T, 20);
  assert.equal(view.engine.controllerMode, 'fixed');
  assert.equal(view.engine.bridge.settings.seed, 7);
  assert.equal(state.frames.length, 20);
  assert.deepEqual(state.mlLog, []);
  assert.equal(view.history.queue.length, 10);
});

test('status messages update the bridge info without touching traffic data', () => {
  const { state } = viewAfter(50);
  applyStatus(state, { ...BRIDGE, paused: true, speed: 4 });
  const view = buildView(state);
  assert.equal(view.engine.bridge.paused, true);
  assert.equal(view.engine.bridge.speed, 4);
  assert.equal(view.T, 50);
});

test('fields the engine does not send are null, never zero or invented', () => {
  const { view } = viewAfter(100);
  assert.equal(view.stats.maxWait, null);
  assert.equal(view.stats.maxWaitApproach, null);
  assert.equal(view.plan, null);
  assert.equal(view.sig.target, null);
  for (const key of ['series', 'recommendation', 'error', 'latencyMs']) assert.equal(view.forecast[key], null, key);
  for (const key of ['agreement', 'mlPhase']) assert.equal(view.decision[key], null, key);
  for (const lamp of Object.values(view.lamps)) assert.equal(lamp.text, null);
  assert.equal(buildView(createFeedState()), null); // nothing received yet
});

test('lamps and the canvas sim show each movement light from the engine', () => {
  const sim = new EngineSim();
  assert.equal(sim.moveState('NL'), 'R'); // before any snapshot
  const colors = new Set();
  for (let n = 1; n <= 120; n++) {
    const { view, state } = viewAfter(n);
    const raw = RUN[n - 1];
    sim.update(state.frames.at(-1).view);
    assert.equal(sim.T, raw.time_seconds);
    for (const [movement, color] of Object.entries(raw.lights)) {
      const key = ENTRY[movement];
      const expected = { green: 'G', yellow: 'Y', red: 'R' }[color];
      assert.equal(sim.moveState(key), expected);
      if (key in view.lamps) assert.equal(view.lamps[key].state, expected);
      colors.add(color);
    }
  }
  assert.deepEqual([...colors].sort(), ['green', 'red', 'yellow']);
});

// ----- forecast scoring, signal history, rule checks ---------------------------

// Arrivals per entry-approach movement summed over snapshots with time in [from, to].
function arrivalsBetween(from, to) {
  const out = Object.fromEntries(Object.values(ENTRY).map((k) => [k, 0]));
  for (const raw of RUN) {
    if (raw.time_seconds < from || raw.time_seconds > to) continue;
    const a = byEntry(raw, 'arrivals');
    for (const k in out) out[k] += a[k];
  }
  return out;
}
const mae = (p, a) => Object.keys(a).reduce((s, k) => s + Math.abs(p[k] - a[k]), 0) / Object.keys(a).length;

test('each forecast is scored against the arrivals in the 30 s after it, and against a naive guess', () => {
  const { view } = viewAfter(400);
  const score = view.forecastScore;
  // Forecasts at 60, 65, ..., 370 have had their 30 s by second 400.
  const scored = [];
  for (let g = 60; g + 30 <= 400; g += 5) scored.push(g);
  assert.equal(score.count, scored.length);
  assert.equal(score.latest.generatedAt, 370);
  assert.equal(score.latest.scoredAt, 400);

  let modelSum = 0;
  let naiveSum = 0;
  for (const g of scored) {
    const raw = RUN[g - 1];
    const predicted = Object.fromEntries(raw.movement_order.map((m, i) => [ENTRY[m], raw.forecast.arrivals[i]]));
    const actual = arrivalsBetween(g + 1, g + 30);
    const naive = arrivalsBetween(g - 29, g);
    modelSum += mae(predicted, actual);
    naiveSum += mae(naive, actual);
    if (g === 370) {
      assert.deepEqual(score.latest.actual, actual);
      close(score.latest.modelError, mae(predicted, actual), 'latest model error');
      close(score.latest.naiveError, mae(naive, actual), 'latest naive error');
      close(score.latest.actualTotal, Object.values(actual).reduce((s, v) => s + v, 0), 'actual total');
    }
  }
  close(score.meanModelError, modelSum / scored.length, 'mean model error');
  close(score.meanNaiveError, naiveSum / scored.length, 'mean naive error');
  assert.equal(score.recent.length, 10);
  assert.equal(score.nextScoreIn, 375 + 30 - 400);
});

test('the dashboard score agrees with the engine\'s own forecast_error, when the engine sends one', (t) => {
  const withScores = RUN.filter((raw) => raw.forecast_error && typeof raw.forecast_error === 'object');
  if (!withScores.length) {
    t.skip('this engine build does not report forecast_error');
    return;
  }
  let compared = 0;
  for (const raw of withScores) {
    const { generated_at_seconds: g, evaluated_at_seconds: at, mae_vehicles: engineMae } = raw.forecast_error;
    if (at !== raw.time_seconds) continue; // compare when the score is fresh
    const { view } = viewAfter(raw.time_seconds);
    assert.equal(view.forecastScore.latest.generatedAt, g);
    close(view.forecastScore.latest.modelError, engineMae, `MAE for the forecast from ${g}`);
    compared += 1;
  }
  assert.ok(compared > 10, `only ${compared} scores compared`);
});

test('nothing is scored before a forecast has had its full 30 s', () => {
  const { view } = viewAfter(89);
  assert.equal(view.forecastScore.count, 0);
  assert.equal(view.forecastScore.latest, null);
  assert.equal(view.forecastScore.nextScoreIn, 1); // the forecast from second 60 is scored at 90
  assert.equal(viewAfter(90).view.forecastScore.count, 1);
});

test('signal history is the last 30 s as runs of identical states', () => {
  const { view } = viewAfter(250);
  const runs = view.signalHistory;
  assert.equal(runs.reduce((s, r) => s + r.seconds, 0), 30);
  const expanded = runs.flatMap((r) => Array(r.seconds).fill(`${r.phase}${r.stage}`));
  const expected = RUN.slice(220, 250).map((raw) =>
    `${ENGINE_PHASES.indexOf(raw.phase)}${{ green: 'G', yellow: 'Y', all_red: 'AR' }[raw.light_state]}`);
  assert.deepEqual(expanded, expected);
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i].phase !== runs[i - 1].phase || runs[i].stage !== runs[i - 1].stage);
  }
});

test('rule checks report what the engine actually did, and the engine obeys its rules', () => {
  const { view } = viewAfter(400);
  const rc = view.ruleChecks;
  // Independent: a state's length is the elapsed counter in its last second.
  const lengths = { green: [], yellow: [], all_red: [] };
  for (let i = 1; i < RUN.length; i++) {
    const a = RUN[i - 1];
    const b = RUN[i];
    if (a.phase !== b.phase || a.light_state !== b.light_state) lengths[a.light_state].push(a.phase_elapsed_seconds);
  }
  const check = (got, values) => {
    assert.equal(got.count, values.length);
    assert.equal(got.min, Math.min(...values));
    assert.equal(got.max, Math.max(...values));
  };
  check(rc.green, lengths.green);
  check(rc.yellow, lengths.yellow);
  check(rc.allRed, lengths.all_red);
  // Sid's engine rules (min green 5, max 40, yellow 3, all-red 2), as observed.
  assert.ok(rc.green.min >= 5 && rc.green.max <= 40);
  assert.ok(rc.yellow.min === 3 && rc.yellow.max === 3);
  assert.ok(rc.allRed.min === 2 && rc.allRed.max === 2);
  assert.equal(rc.conflicts.secondsChecked, 400);
  assert.equal(rc.conflicts.secondsInConflict, 0);
  const last = RUN[399];
  assert.equal(rc.currentGreen, last.light_state === 'green' ? last.phase_elapsed_seconds : null);
});

// ----- EngineSim: cars drawn from the engine's counts --------------------------

function laneCounts(sim) {
  const per = {};
  for (const lane of Object.values(sim.lanes)) for (const c of lane) per[c.mv] = (per[c.mv] ?? 0) + 1;
  return per;
}

test('the canvas always holds exactly the engine queue, movement by movement', () => {
  const sim = new EngineSim();
  const state = applyHello(createFeedState(), { ...BRIDGE, history: [] });
  let clock = 0;
  for (const raw of RUN) {
    applySnapshot(state, raw);
    sim.update(state.frames.at(-1).view);
    sim.allCars((clock += 1000)); // animate a second between snapshots
    const queues = byEntry(raw, 'queues');
    const per = laneCounts(sim);
    for (const [mv, q] of Object.entries(queues)) assert.equal(per[mv] ?? 0, q, `${mv} at ${raw.time_seconds}`);
    assert.equal(sim.queuedCount(), raw.queues.reduce((s, q) => s + q, 0));
  }
});

test('cars that depart drive off and disappear; queued cars stop behind the line', () => {
  const sim = new EngineSim();
  const state = applyHello(createFeedState(), { ...BRIDGE, history: [] });
  let sawDeparting = false;
  let clock = 0;
  for (const raw of RUN.slice(0, 120)) {
    applySnapshot(state, raw);
    sim.update(state.frames.at(-1).view);
    for (let f = 0; f < 10; f++) sim.allCars((clock += 100));
    if (sim.departing.length) sawDeparting = true;
    for (const c of sim.departing) assert.equal(c.crossed, true);
    for (const lane of Object.values(sim.lanes)) {
      for (const c of lane) assert.ok(c.s <= STOP, `queued car past the stop line (s=${c.s})`);
    }
  }
  assert.ok(sawDeparting, 'no departing cars were animated');
  // With no new snapshots, every departing car eventually leaves the screen.
  for (let f = 0; f < 200; f++) sim.allCars((clock += 100));
  assert.equal(sim.departing.length, 0);
});

test('cars never drive through each other on the approach (shared through/right lane included)', () => {
  // Through and right turns share one drawn lane, and their routes are the
  // same until the stop area, so compare every pair in a lane up to there.
  const SHARED_UNTIL = STOP + 20;
  let worst = Infinity;
  let where = '';
  for (const frames of [RUN, runEngine(400, 7, 'fixed')]) {
  const sim = new EngineSim();
  const state = applyHello(createFeedState(), { ...BRIDGE, history: [] });
  let clock = 0;
  for (const raw of frames) {
    applySnapshot(state, raw);
    sim.update(state.frames.at(-1).view);
    for (let f = 0; f < 20; f++) {
      const cars = sim.allCars((clock += 50)).filter((c) => c.s < SHARED_UNTIL);
      const byLane = {};
      for (const c of cars) (byLane[c.mv[0] + (c.mv[1] === 'L' ? 'L' : 'T')] ??= []).push(c);
      for (const [lane, list] of Object.entries(byLane)) {
        list.sort((a, b) => a.s - b.s);
        for (let i = 1; i < list.length; i++) {
          const gap = list[i].s - list[i - 1].s;
          if (gap < worst) { worst = gap; where = `${lane} at ${raw.time_seconds}s (${list[i - 1].mv} / ${list[i].mv})`; }
        }
      }
    }
  }
  }
  assert.ok(worst >= CAR - 0.5, `cars overlapped: centres ${worst.toFixed(1)} apart in ${where} (car length ${CAR})`);
});

test('long queues show at most 10 cars per lane plus a "+N" label for the rest', () => {
  const r = spawnSync(ENGINE, ['900', '42', '--controller', 'fixed', '--demand', 'overloaded', '--format', 'jsonl'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr);
  const overloaded = parseReplay(r.stdout);
  let overflowed = false;
  for (const frames of [RUN, overloaded]) {
    const sim = new EngineSim();
    const state = applyHello(createFeedState(), { ...BRIDGE, history: [] });
    let clock = 0;
    for (const raw of frames) {
      applySnapshot(state, raw);
      sim.update(state.frames.at(-1).view);
      sim.allCars((clock += 1000)); // animate a second, as the page does
    }
    if (sim.laneLabels().length) overflowed = true;
    // Let any car that just arrived finish driving into its slot.
    for (let f = 0; f < 50; f++) sim.allCars((clock += 100));
    const drawn = sim.allCars((clock += 100)).filter((c) => !c.crossed);
    const perLane = {};
    for (const c of drawn) {
      const lane = c.mv[0] + (c.mv[1] === 'L' ? 'L' : 'T');
      perLane[lane] = (perLane[lane] ?? 0) + 1;
    }
    for (const [lane, cars] of Object.entries(sim.lanes)) {
      const label = sim.laneLabels().find((l) => l.lane === lane);
      if (cars.length > LANE_SLOTS) {
        assert.equal(perLane[lane], LANE_SLOTS - 1);
        assert.equal(label.hidden, cars.length - (LANE_SLOTS - 1)); // drawn + label = full count
      } else {
        assert.equal(perLane[lane] ?? 0, cars.length);
        assert.equal(label, undefined);
      }
    }
  }
  assert.ok(overflowed, 'expected overflowing lanes under overloaded demand');
});

test('a restart or a gap rebuilds the lanes from the counts, with cars already in place', () => {
  const sim = new EngineSim();
  const state = applyHello(createFeedState(), { ...BRIDGE, history: [] });
  for (const raw of RUN.slice(0, 200)) { applySnapshot(state, raw); sim.update(state.frames.at(-1).view); }
  // Jump back to second 50 (as after a restart): rebuild, no departing cars.
  const back = applyHello(createFeedState(), { ...BRIDGE, history: RUN.slice(0, 50) });
  sim.update(back.frames.at(-1).view);
  assert.equal(sim.departing.length, 0);
  assert.equal(sim.queuedCount(), RUN[49].queues.reduce((s, q) => s + q, 0));
  for (const lane of Object.values(sim.lanes)) {
    lane.forEach((c, i) => assert.equal(c.s, Math.max(0, STOP - 2 - i * 24)));
  }
});
