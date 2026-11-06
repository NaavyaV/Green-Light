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
  };
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

  state.frames.push({ view, raw });
  if (state.frames.length > KEEP_FRAMES) state.frames.shift();

  if (view.sig.stage === 'G') state.lastGreen[view.sig.phase] = T;

  if (view.forecast && view.forecast.generatedAt === T) {
    state.mlLog.unshift({ t: T, arrivals: view.forecast.arrivals });
    if (state.mlLog.length > LOG_LEN) state.mlLog.pop();
  }

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
    engine: {
      controllerMode: view.controllerMode,
      decisionSource: view.decisionSource,
      modelStatus: view.modelStatus,
      bridge: { ...state.bridge },
    },
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
