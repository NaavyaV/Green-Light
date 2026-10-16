import {
  CFG, CAR, GAP, STOP, APPROACHES, MOVES, PHASES, SCENARIOS, TURN_SPLIT, DEMAND_WAVE_OFFSET, FORECAST_EVERY, HORIZON,
} from './constants.js';
import { ROUTES } from './geometry.js';
import { predict } from './mlModel.js';
import { decide } from './controller.js';

const CAR_COLORS = ['#cdd2d4', '#8f9ba3', '#5d6d79', '#b7bdc1', '#e4e0d6', '#6e8075', '#9b8e81', '#46525a', '#a9b4bd', '#d8cfc0'];
const HISTORY_LEN = 90; // samples kept for sparklines (one every 2s = 3 minutes)

/**
 * Traffic simulation for one 4-way intersection.
 * Owns the cars, the signal state machine and the measurements. Every 5 sim-seconds it calls the
 * ML model (`predict`) and then the controller (`decide`).
 */
export class Simulation {
  constructor(scenario = 'balanced') {
    this.reset(scenario);
  }

  reset(scenario = this.scenario) {
    this.T = 0;
    this.scenario = scenario;
    this.carId = 0;
    this.lanes = {}; // cars still approaching, front car first. Keys: 'NL' (left lane), 'NT' (through/right lane)...
    this.backlog = {}; // vehicles that arrived but have no room to enter the visible lane yet
    APPROACHES.forEach((a) => {
      this.lanes[a + 'L'] = []; this.lanes[a + 'T'] = [];
      this.backlog[a + 'L'] = []; this.backlog[a + 'T'] = [];
    });
    this.free = []; // cars past the stop line
    this.arrivals = []; // {t, mv}
    this.crossed = []; // {t, wait}
    this.sig = { phase: 1, stage: 'G', t: 0, target: 14, next: 3, nextDur: 14, manual: false, manualPhase: null };
    this.lastEnd = [0, 0, 0, 0]; // when each phase last ended
    this.forecast = null;
    this.decision = null;
    this.mlLog = [];
    this.decisionLog = [];
    this.history = { wait: [], queue: [], thru: [], max: [] };
  }

  setScenario(s) { this.scenario = s; }

  /** Expected arrivals in veh/s for one movement at time t. */
  rate(a, m, t) {
    const perMin = SCENARIOS[this.scenario].rates[a];
    return (perMin / 60) * TURN_SPLIT[m] * (1 + 0.22 * Math.sin((2 * Math.PI * t) / 150 + DEMAND_WAVE_OFFSET[a]));
  }

  /** 'G' | 'Y' | 'R' for a movement key such as 'NL'. */
  moveState(mv) {
    if (!PHASES[this.sig.phase].moves.includes(mv)) return 'R';
    return this.sig.stage === 'G' ? 'G' : this.sig.stage === 'Y' ? 'Y' : 'R';
  }

  // ---------- stepping ----------
  advance(seconds) {
    let left = seconds;
    while (left > 0) {
      const h = Math.min(1 / 30, left);
      this.step(h);
      left -= h;
    }
  }

  step(dt) {
    this.T += dt;
    this.spawn(dt);
    this.stepSignals(dt);
    this.stepCars(dt);
    const T = this.T;
    if (Math.floor((T - dt) / FORECAST_EVERY) !== Math.floor(T / FORECAST_EVERY)) this.runCycle();
    if (Math.floor((T - dt) / 2) !== Math.floor(T / 2)) this.sampleHistory();
  }

  /** One 5-second cycle: model forecast, then controller decision. */
  runCycle() {
    const f = predict(this);
    this.forecast = f;
    const r = f.recommendation;
    this.mlLog.unshift({ t: this.T, phase: r.phase, duration: r.duration, confidence: r.confidence });
    if (this.mlLog.length > 6) this.mlLog.pop();
    this.pushDecision(decide(this, f));
  }

  pushDecision(d) {
    this.decision = d;
    this.decisionLog.unshift({ t: d.t, action: d.action, agreement: d.agreement });
    if (this.decisionLog.length > 5) this.decisionLog.pop();
  }

  spawn(dt) {
    APPROACHES.forEach((a) => MOVES.forEach((m) => {
      if (Math.random() < this.rate(a, m, this.T) * dt) {
        this.backlog[a + (m === 'L' ? 'L' : 'T')].push({ m, t: this.T });
        this.arrivals.push({ t: this.T, mv: a + m });
      }
    }));
    for (const k in this.lanes) {
      const L = this.lanes[k];
      const B = this.backlog[k];
      if (!B.length) continue;
      const last = L[L.length - 1];
      if (!last || last.s > CAR + GAP + 4) {
        const e = B.shift();
        const a = k[0];
        this.carId += 1;
        L.push({
          id: this.carId, a, m: e.m, mv: a + e.m, route: ROUTES[a + e.m],
          s: 0, v: last ? Math.min(CFG.VMAX, last.v) : CFG.VMAX * 0.9,
          react: 0, commit: null, wait: this.T - e.t, crossed: false,
          color: CAR_COLORS[(this.carId * 7) % CAR_COLORS.length], blink: Math.random() * 6,
        });
      }
    }
  }

  moveCar(c, limit, dt) {
    const gap = limit - c.s;
    let vd = gap <= 0 ? 0 : Math.min(CFG.VMAX, Math.sqrt(2 * CFG.DEC * Math.max(0, gap - 0.5)));
    if (c.v < 0.5 && gap > 4) {
      c.react += dt;
      if (c.react < CFG.REACT) vd = 0;
    } else if (c.v >= 0.5) c.react = 0;
    c.v = vd > c.v ? Math.min(vd, c.v + CFG.ACC * dt) : vd;
    c.s += c.v * dt;
    if (c.s < STOP && c.v < 6) c.wait += dt;
    if (!c.crossed && c.s > STOP) {
      c.crossed = true;
      this.crossed.push({ t: this.T, wait: c.wait });
    }
  }

  stepCars(dt) {
    for (const k in this.lanes) {
      const L = this.lanes[k];
      for (let i = 0; i < L.length; i++) {
        const c = L[i];
        let limit = i > 0 ? L[i - 1].s - CAR - GAP : 1e9;
        if (c.s <= STOP + 0.5) {
          const st = this.moveState(c.mv);
          if (st === 'G') c.commit = null;
          else if (st === 'Y') {
            if (c.commit === null) c.commit = STOP - c.s < (c.v * c.v) / (2 * CFG.DEC) + 2 ? 'go' : 'stop';
            if (c.commit === 'stop') limit = Math.min(limit, STOP);
          } else if (c.commit !== 'go') limit = Math.min(limit, STOP);
        }
        this.moveCar(c, limit, dt);
      }
      while (L.length && L[0].s > STOP + 40) this.free.push(L.shift());
    }
    for (let i = this.free.length - 1; i >= 0; i--) {
      const c = this.free[i];
      this.moveCar(c, 1e9, dt);
      if (c.s > c.route.len) this.free.splice(i, 1);
    }
  }

  stepSignals(dt) {
    const sig = this.sig;
    sig.t += dt;
    if (sig.stage === 'G') {
      if (sig.manual) {
        if (sig.manualPhase !== null && sig.manualPhase !== sig.phase) { sig.next = sig.manualPhase; this.toYellow(); }
      } else if (sig.t >= sig.target) this.toYellow();
    } else if (sig.stage === 'Y') {
      if (sig.t >= CFG.YEL) { sig.stage = 'AR'; sig.t = 0; }
    } else if (sig.t >= CFG.AR) {
      sig.phase = sig.next;
      sig.stage = 'G';
      sig.t = 0;
      sig.target = Math.max(CFG.MIN, Math.min(CFG.MAX, sig.nextDur || CFG.MIN + 5));
      sig.next = null;
    }
  }

  toYellow() {
    const sig = this.sig;
    this.lastEnd[sig.phase] = this.T;
    if (sig.next === null || sig.next === sig.phase) {
      sig.next = this.bestOther(sig.phase);
      sig.nextDur = this.durFor(sig.next);
    }
    sig.stage = 'Y';
    sig.t = 0;
  }

  // ---------- operator actions ----------
  forcePhase(p) {
    const sig = this.sig;
    sig.manual = true;
    sig.manualPhase = p;
    if (sig.phase !== p || sig.stage !== 'G') { sig.next = p; sig.nextDur = CFG.MIN; }
    this.pushDecision({
      t: this.T, action: `MANUAL · ${PHASES[p].name}`, reason: 'Operator forced this phase. Clearance intervals still apply.',
      agreement: 'op', mlPhase: this.forecast ? this.forecast.recommendation.phase : p, finalPhase: p,
    });
  }

  resumeAuto() {
    const sig = this.sig;
    sig.manual = false;
    sig.manualPhase = null;
    if (sig.stage === 'G') sig.target = Math.max(sig.t + 3, CFG.MIN);
    this.pushDecision({
      t: this.T, action: 'AUTO resumed', reason: 'Controller takes over at the next 5s forecast.',
      agreement: 'ok', mlPhase: this.forecast ? this.forecast.recommendation.phase : sig.phase, finalPhase: sig.phase,
    });
  }

  // ---------- measurements ----------
  /** Queued vehicles per movement (stopped or crawling before the stop line, plus backlog). */
  queues() {
    const q = {};
    APPROACHES.forEach((a) => MOVES.forEach((m) => { q[a + m] = 0; }));
    for (const k in this.lanes) {
      for (const c of this.lanes[k]) if (c.s < STOP && c.v < 8) q[c.mv] += 1;
      for (const e of this.backlog[k]) q[k[0] + e.m] += 1;
    }
    return q;
  }

  approachTotals(q) {
    const o = {};
    APPROACHES.forEach((a) => { o[a] = MOVES.reduce((s, m) => s + q[a + m], 0); });
    return o;
  }

  /** Measured arrivals per approach, veh/min over the last 60s. */
  measuredRates() {
    const o = {};
    APPROACHES.forEach((a) => { o[a] = 0; });
    const w = Math.min(60, Math.max(this.T, 1));
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const e = this.arrivals[i];
      if (this.T - e.t > 60) break;
      o[e.mv[0]] += 1;
    }
    APPROACHES.forEach((a) => { o[a] = (o[a] * 60) / w; });
    return o;
  }

  stats() {
    const T = this.T;
    while (this.arrivals.length && T - this.arrivals[0].t > 90) this.arrivals.shift();
    while (this.crossed.length && T - this.crossed[0].t > 60) this.crossed.shift();
    const w = Math.min(60, Math.max(T, 1));
    const throughput = (this.crossed.length * 60) / w;
    const avgWait = this.crossed.length ? this.crossed.reduce((s, c) => s + c.wait, 0) / this.crossed.length : 0;
    const q = this.queues();
    const totalQueued = Object.values(q).reduce((s, v) => s + v, 0);
    let maxWait = 0;
    let maxWaitApproach = null;
    for (const k in this.lanes) {
      for (const c of this.lanes[k]) if (c.s < STOP && c.wait > maxWait) { maxWait = c.wait; maxWaitApproach = c.a; }
      for (const e of this.backlog[k]) { const ww = T - e.t; if (ww > maxWait) { maxWait = ww; maxWaitApproach = k[0]; } }
    }
    return { throughput, avgWait, totalQueued, queues: q, maxWait, maxWaitApproach };
  }

  sampleHistory() {
    const s = this.stats();
    const push = (k, v) => { const h = this.history[k]; h.push(v); if (h.length > HISTORY_LEN) h.shift(); };
    push('wait', s.avgWait); push('queue', s.totalQueued); push('thru', s.throughput); push('max', s.maxWait);
  }

  // ---------- planning helpers (used by the model and the controller) ----------
  /** Green time a phase needs to clear its queue plus ~18s of arrivals. */
  durFor(p) {
    const q = this.queues();
    let need = 0;
    for (const mv of PHASES[p].moves) {
      const sat = mv[1] === 'L' ? CFG.SAT_L : CFG.SAT_T;
      need = Math.max(need, (q[mv] + this.rate(mv[0], mv[1], this.T) * 18) / sat);
    }
    return Math.round(Math.max(CFG.MIN + 1, Math.min(CFG.MAX, need + 4)));
  }

  pressure(p, q) {
    let s = 0;
    for (const mv of PHASES[p].moves) s += q[mv] + this.rate(mv[0], mv[1], this.T) * 30 * (this.forecast ? this.forecast.noise[mv] : 1);
    return s;
  }

  /** Highest-pressure phase other than `cur`, with a small bonus for phases that have waited longer. */
  bestOther(cur) {
    const q = this.queues();
    let best = (cur + 1) % 4;
    let bestScore = -1;
    for (let p = 0; p < 4; p++) {
      if (p === cur) continue;
      const s = this.pressure(p, q) + (this.T - this.lastEnd[p]) * 0.04;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
  }

  /** Planned signal segments from now: [{kind:'G'|'Y'|'AR', phase, t0, t1}] (seconds from now). */
  plan(horizon) {
    const sig = this.sig;
    const segs = [];
    let t = 0;
    let next = sig.next;
    const push = (kind, phase, d) => { if (d <= 0) return; segs.push({ kind, phase, t0: t, t1: t + d }); t += d; };
    if (sig.stage === 'G') {
      push('G', sig.phase, sig.manual && sig.manualPhase === sig.phase ? horizon + 1 : Math.max(0, sig.target - sig.t));
      if (next === null || next === sig.phase) {
        next = sig.manual && sig.manualPhase !== null && sig.manualPhase !== sig.phase ? sig.manualPhase : this.bestOther(sig.phase);
      }
      push('Y', null, CFG.YEL); push('AR', null, CFG.AR);
    } else if (sig.stage === 'Y') {
      push('Y', null, CFG.YEL - sig.t); push('AR', null, CFG.AR);
    } else push('AR', null, CFG.AR - sig.t);
    let p = next;
    let d = sig.nextDur || CFG.MIN + 5;
    let guard = 0;
    while (t < horizon && guard++ < 12) {
      push('G', p, sig.manual ? horizon + 1 : d);
      push('Y', null, CFG.YEL); push('AR', null, CFG.AR);
      p = (p + 1) % 4;
      d = 12;
    }
    return segs;
  }

  // ---------- view model for React ----------
  /** Plain object with everything the panels render. Built ~4 times a second. */
  snapshot() {
    const sig = { ...this.sig };
    const st = this.stats();
    const q = st.queues;
    const longPlan = this.plan(150);
    const lamps = {};
    APPROACHES.forEach((a) => ['L', 'T'].forEach((m) => {
      const mv = a + m;
      const state = this.moveState(mv);
      let text;
      if (state === 'G') text = sig.manual ? 'hold' : `${Math.max(0, Math.ceil(sig.target - sig.t))}s`;
      else if (state === 'Y') text = `${Math.max(0, Math.ceil(CFG.YEL - sig.t))}s`;
      else {
        const seg = longPlan.find((x) => x.kind === 'G' && PHASES[x.phase].moves.includes(mv));
        text = seg ? `~${Math.ceil(seg.t0)}s` : '—';
      }
      lamps[mv] = { state, text };
    }));
    const demand = (p) => PHASES[p].moves.reduce((s, mv) => s + q[mv], 0);
    const waits = [0, 1, 2, 3].filter((p) => p !== sig.phase && demand(p) > 0).map((p) => this.T - this.lastEnd[p]);
    return {
      T: this.T,
      nextForecastIn: FORECAST_EVERY - (this.T % FORECAST_EVERY),
      sig,
      stats: st,
      approachTotals: this.approachTotals(q),
      measuredRates: this.measuredRates(),
      lamps,
      plan: this.plan(HORIZON).filter((s) => s.t0 < HORIZON),
      phaseQueued: PHASES.map((p) => demand(p.id)),
      longestPhaseWait: waits.length ? Math.max(...waits) : 0,
      forecast: this.forecast,
      decision: this.decision,
      mlLog: [...this.mlLog],
      decisionLog: [...this.decisionLog],
      history: {
        wait: [...this.history.wait], queue: [...this.history.queue], thru: [...this.history.thru], max: [...this.history.max],
      },
    };
  }

  /** Every car on the map, for drawing. */
  allCars() {
    const out = [];
    for (const k in this.lanes) out.push(...this.lanes[k]);
    out.push(...this.free);
    return out;
  }
}
