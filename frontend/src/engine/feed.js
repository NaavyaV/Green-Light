// Turns the live bridge's engine snapshots into the `view` object the
// dashboard panels read. Pure functions: no React and no browser APIs, so
// Node can test them (feed.test.mjs).
//
// Values the engine does not send stay null. They are never filled with 0
// or estimated, so the panels can show them as unavailable.

import { toReplayView } from '../../../integration/replay.mjs';
import { APPROACHES, MOVES, PHASES, FORECAST_EVERY } from '../sim/constants.js';

const WINDOW = 60; // seconds for rolling throughput, wait and arrival rates
const SAMPLE_EVERY = 2; // seconds between sparkline samples (matches the browser sim)
const HISTORY_LEN = 90; // sparkline samples kept (3 minutes)
const KEEP_FRAMES = WINDOW + 1; // a window needs one frame before it as a baseline
const LOG_LEN = 5;
const HORIZON = 30; // seconds a forecast covers (the engine's horizon_seconds)
const TIMELINE = 30; // seconds of signal history for the Controller tab
const SCORES_KEPT = 10;

// The engine's phase names, in the same order as PHASES ids 0-3.
const ENGINE_PHASES = ['NS_LEFT', 'NS_THROUGH_RIGHT', 'EW_LEFT', 'EW_THROUGH_RIGHT'];
const LIGHT = { green: 'G', yellow: 'Y', red: 'R' };
const STAGE = { green: 'G', yellow: 'Y', all_red: 'AR' };

export function createFeedState() {
  return {
    bridge: { status: 'connecting', paused: false, speed: 1, settings: null, error: null },
    frames: [], // recent seconds, oldest first: { view, raw }
    history: { wait: [], queue: [], thru: [], max: [] },
    firstTime: null, // first second seen since the last hello
    lastGreen: [null, null, null, null], // last second each phase showed green
    mlLog: [],
    decisionLog: [],
    // Forecast scoring: forecasts waiting for their 30 s to pass, and the results.
    pendingForecasts: [],
    scores: [], // newest first
    scoreTotals: { count: 0, modelError: 0, naiveError: 0 },
    // Observed light-state lengths, for the rule checks.
    durations: { G: [], Y: [], AR: [] }, // seconds each completed state lasted
    conflicts: { secondsChecked: 0, secondsInConflict: 0 },
  };
}

const sumOver = (frames, key) => frames.reduce((s, f) => s + f.view.arrivals[key], 0);
const movementKeys = (record) => Object.keys(record);

// Mean absolute error per movement between two { key: count } records.
function meanAbsError(predicted, actual) {
  const keys = movementKeys(actual);
  return keys.reduce((s, k) => s + Math.abs(predicted[k] - actual[k]), 0) / keys.length;
}

// Score forecasts whose 30 seconds have now fully passed. A forecast made at
// second G covers the arrivals reported in seconds G+1 ... G+30. The naive
// baseline guesses that those 30 seconds repeat the 30 seconds before G.
function scoreForecasts(state, T) {
  const frames = state.frames;
  for (const p of state.pendingForecasts) {
    if (T !== p.generatedAt + HORIZON) continue;
    const window = frames.slice(-HORIZON);
    const consecutive = window.length === HORIZON && window[0].view.T === p.generatedAt + 1;
    if (!consecutive) continue; // missed seconds: cannot score honestly
    const actual = {};
    for (const k of movementKeys(p.predicted)) actual[k] = sumOver(window, k);
    const total = (r) => Object.values(r).reduce((s, v) => s + v, 0);
    const score = {
      generatedAt: p.generatedAt,
      scoredAt: T,
      predicted: p.predicted,
      actual,
      predictedTotal: total(p.predicted),
      actualTotal: total(actual),
      modelError: meanAbsError(p.predicted, actual),
      naiveError: p.naive ? meanAbsError(p.naive, actual) : null,
    };
    state.scores.unshift(score);
    if (state.scores.length > SCORES_KEPT) state.scores.pop();
    if (score.naiveError !== null) {
      state.scoreTotals.count += 1;
      state.scoreTotals.modelError += score.modelError;
      state.scoreTotals.naiveError += score.naiveError;
    }
  }
  state.pendingForecasts = state.pendingForecasts.filter((p) => p.generatedAt + HORIZON > T);
}

function recordDuration(state, stage, seconds) {
  const d = state.durations[stage];
  d.push(seconds);
  if (d.length > 200) d.shift(); // plenty for min/max; bounded memory on long runs
}

// The bridge's first message, and the message after every restart: start over.
export function applyHello(state, hello) {
  const fresh = createFeedState();
  Object.assign(state, fresh);
  applyStatus(state, hello);
  for (const snapshot of hello.history) applySnapshot(state, snapshot);
  return state;
}

export function applyStatus(state, status) {
  state.bridge = {
    status: status.status,
    paused: status.paused,
    speed: status.speed,
    settings: status.settings,
    error: status.error,
  };
  return state;
}

export function applySnapshot(state, raw) {
  const view = toReplayView(raw);
  const T = view.T;
  if (state.firstTime === null) {
    state.firstTime = T;
    // If we saw the run from its first second, every phase "last ended" at 0,
    // as in the browser sim. Otherwise we cannot know until it shows green.
    if (T === 1) state.lastGreen = [0, 0, 0, 0];
  }

  // A light state ended: record how long it lasted. The engine's elapsed
  // counter covers the whole state even if we joined part-way through it.
  const prev = state.frames[state.frames.length - 1];
  if (prev && prev.view.T === T - 1 &&
      (prev.view.sig.phase !== view.sig.phase || prev.view.sig.stage !== view.sig.stage)) {
    recordDuration(state, prev.view.sig.stage, prev.view.sig.t);
  }

  // No north-south movement may be green at the same time as an east-west one.
  if (view.lights) {
    const green = (k) => view.lights[k] === 'green';
    const ns = ['N', 'S'].some((a) => MOVES.some((m) => green(a + m)));
    const ew = ['E', 'W'].some((a) => MOVES.some((m) => green(a + m)));
    state.conflicts.secondsChecked += 1;
    if (ns && ew) state.conflicts.secondsInConflict += 1;
  }

  state.frames.push({ view, raw });
  if (state.frames.length > KEEP_FRAMES) state.frames.shift();

  if (view.sig.stage === 'G') state.lastGreen[view.sig.phase] = T;

  if (view.forecast && view.forecast.generatedAt === T) {
    state.mlLog.unshift({ t: T, arrivals: view.forecast.arrivals });
    if (state.mlLog.length > LOG_LEN) state.mlLog.pop();
    // Queue it for scoring, with the naive "last 30 s repeat" guess if we saw them.
    const before = state.frames.slice(-HORIZON);
    const naive = before.length === HORIZON && before[0].view.T === T - HORIZON + 1
      ? Object.fromEntries(movementKeys(view.forecast.arrivals).map((k) => [k, sumOver(before, k)]))
      : null;
    state.pendingForecasts.push({ generatedAt: T, predicted: view.forecast.arrivals, naive });
  }
  scoreForecasts(state, T);

  if (raw.decision && raw.decision.action === 'switch') {
    state.decisionLog.unshift({
      t: T,
      action: raw.decision.action,
      text: raw.decision.text,
      fromPhase: view.sig.phase,
      source: raw.decision.source,
    });
    if (state.decisionLog.length > LOG_LEN) state.decisionLog.pop();
  }

  if (T % SAMPLE_EVERY === 0) {
    const m = rollingMetrics(state.frames);
    const push = (key, value) => {
      const h = state.history[key];
      h.push(value);
      if (h.length > HISTORY_LEN) h.shift();
    };
    push('wait', m.avgWait);
    push('queue', view.stats.totalQueued);
    push('thru', m.throughput);
    // history.max stays empty: the engine does not report individual waits.
  }
  return state;
}

// Running totals at the end of a frame. The engine reports a running mean
// wait of all completed vehicles; mean x count turns it back into a total.
function totals(frame) {
  const s = frame.view.stats;
  return { count: s.completedVehicles, wait: s.meanCompletedWaitSeconds * s.completedVehicles };
}

// Throughput, mean wait and arrival rates over the last WINDOW seconds.
// The window is measured against the running totals just before it starts:
//  - enough frames: the frame right before the window;
//  - we saw the run from second 1: zero;
//  - we joined mid-run with less history: our first frame, which is then left
//    out of the window because its departures' waits cannot be separated.
function rollingMetrics(frames) {
  let base;
  let window;
  if (frames.length > WINDOW) {
    base = totals(frames[frames.length - WINDOW - 1]);
    window = frames.slice(-WINDOW);
  } else if (frames[0].view.T === 1) {
    base = { count: 0, wait: 0 };
    window = frames;
  } else {
    base = totals(frames[0]);
    window = frames.slice(1);
  }

  let departed = 0;
  const arrivals = Object.fromEntries(APPROACHES.map((a) => [a, 0]));
  for (const { view } of window) {
    for (const key in view.departures) departed += view.departures[key];
    for (const key in view.arrivals) arrivals[key[0]] += view.arrivals[key];
  }

  const now = totals(frames[frames.length - 1]);
  const left = now.count - base.count; // equals `departed`
  const perMinute = (n) => (window.length ? (n * 60) / window.length : 0);
  return {
    throughput: perMinute(departed),
    avgWait: left > 0 ? (now.wait - base.wait) / left : 0,
    measuredRates: Object.fromEntries(APPROACHES.map((a) => [a, perMinute(arrivals[a])])),
  };
}

export function buildView(state) {
  const latest = state.frames[state.frames.length - 1];
  if (!latest) return null;
  const { view, raw } = latest;
  const T = view.T;
  const m = rollingMetrics(state.frames);

  const queues = view.stats.queues;
  const approachTotals = Object.fromEntries(
    APPROACHES.map((a) => [a, MOVES.reduce((s, mv) => s + queues[a + mv], 0)]),
  );
  const phaseQueued = PHASES.map((p) => p.moves.reduce((s, mv) => s + queues[mv], 0));

  const nextPhase = raw.decision ? ENGINE_PHASES.indexOf(raw.decision.next_phase) : -1;
  const sig = {
    phase: view.sig.phase,
    stage: view.sig.stage,
    t: view.sig.t,
    manual: false,
    manualPhase: null,
    next: nextPhase >= 0 && nextPhase !== view.sig.phase ? nextPhase : null,
    target: null, // the engine publishes no planned green length
  };

  const lamps = {};
  for (const a of APPROACHES) {
    for (const mv of ['L', 'T']) {
      lamps[a + mv] = { state: view.lights ? LIGHT[view.lights[a + mv]] : null, text: null };
    }
  }

  return {
    T,
    nextForecastIn: FORECAST_EVERY - (T % FORECAST_EVERY),
    sig,
    stats: {
      throughput: m.throughput,
      avgWait: m.avgWait,
      totalQueued: view.stats.totalQueued,
      queues,
      maxWait: null,
      maxWaitApproach: null,
      completedVehicles: view.stats.completedVehicles,
      meanCompletedWaitSeconds: view.stats.meanCompletedWaitSeconds,
    },
    approachTotals,
    measuredRates: m.measuredRates,
    lamps,
    plan: null,
    phaseQueued,
    longestPhaseWait: longestPhaseWait(state, T, sig, phaseQueued),
    forecast: view.forecast && {
      t: view.forecast.generatedAt,
      generatedAt: view.forecast.generatedAt,
      horizonSeconds: view.forecast.horizonSeconds,
      speedInput: view.forecast.speedInput,
      arrivals: view.forecast.arrivals,
      series: null,
      recommendation: null,
      error: raw.forecast_error ?? null,
      latencyMs: null,
    },
    decision: raw.decision && {
      t: T,
      action: raw.decision.action,
      text: raw.decision.text,
      source: raw.decision.source,
      nextPhase: nextPhase >= 0 ? nextPhase : null,
      nextStage: raw.decision.next_light_state ? STAGE[raw.decision.next_light_state] : null,
      agreement: null,
      mlPhase: null,
      finalPhase: nextPhase >= 0 ? nextPhase : null,
    },
    mlLog: [...state.mlLog],
    decisionLog: [...state.decisionLog],
    history: {
      wait: [...state.history.wait],
      queue: [...state.history.queue],
      thru: [...state.history.thru],
      max: [...state.history.max],
    },
    forecastScore: forecastScore(state, T),
    signalHistory: signalHistory(state.frames),
    ruleChecks: ruleChecks(state, sig),
    engine: {
      controllerMode: view.controllerMode,
      decisionSource: view.decisionSource,
      modelStatus: view.modelStatus,
      bridge: { ...state.bridge },
    },
  };
}

// Latest scored forecast, recent results, running averages and when the next score lands.
function forecastScore(state, T) {
  const { count, modelError, naiveError } = state.scoreTotals;
  const next = state.pendingForecasts.length
    ? Math.min(...state.pendingForecasts.map((p) => p.generatedAt + HORIZON)) - T
    : null;
  return {
    latest: state.scores[0] ?? null,
    recent: state.scores.map((s) => ({
      generatedAt: s.generatedAt, predictedTotal: s.predictedTotal, actualTotal: s.actualTotal,
      modelError: s.modelError, naiveError: s.naiveError,
    })),
    count,
    meanModelError: count ? modelError / count : null,
    meanNaiveError: count ? naiveError / count : null,
    nextScoreIn: next,
  };
}

// The last 30 seconds of signal states, oldest first, as runs of identical states.
function signalHistory(frames) {
  const recent = frames.slice(-TIMELINE);
  const out = [];
  for (const { view } of recent) {
    const last = out[out.length - 1];
    if (last && last.phase === view.sig.phase && last.stage === view.sig.stage) last.seconds += 1;
    else out.push({ phase: view.sig.phase, stage: view.sig.stage, seconds: 1 });
  }
  return out;
}

// What the signal has actually done since we started watching, for the rule checks.
function ruleChecks(state, sig) {
  const range = (values) => (values.length
    ? { count: values.length, min: Math.min(...values), max: Math.max(...values) }
    : { count: 0, min: null, max: null });
  return {
    green: range(state.durations.G),
    yellow: range(state.durations.Y),
    allRed: range(state.durations.AR),
    currentGreen: sig.stage === 'G' ? sig.t : null,
    conflicts: { ...state.conflicts },
  };
}

// Longest time a phase with waiting cars has gone without green. Null if a
// phase with waiting cars has not shown green since we started watching.
function longestPhaseWait(state, T, sig, phaseQueued) {
  let longest = 0;
  for (let p = 0; p < PHASES.length; p++) {
    if (p === sig.phase || phaseQueued[p] === 0) continue;
    const last = state.lastGreen[p];
    if (last === null) return null;
    longest = Math.max(longest, T - last);
  }
  return longest;
}
