import { CFG, PHASES } from './constants.js';

/**
 * STAND-IN for the C++ controller.
 *
 * Runs right after each forecast. It takes the model's recommendation, applies traffic rules
 * (min/max green, clearance intervals, starvation guard) and writes the schedule into `sim.sig`:
 *   sig.target   seconds of green for the current phase (counted from its start)
 *   sig.next     phase index to serve after clearance
 *   sig.nextDur  planned green for that next phase
 * When the real engine is connected, apply its schedule to the same fields and return the same shape.
 *
 * @returns {{ t:number, action:string, reason:string,
 *   agreement:'ok'|'adj'|'ovr'|'op', mlPhase:number, finalPhase:number }}
 */
export function decide(sim, forecast) {
  const rec = forecast.recommendation;
  const sig = sim.sig;
  const q = sim.queues();
  const cur = sig.phase;
  const el = sig.t;
  const name = (p) => PHASES[p].name;
  const demand = (p) => PHASES[p].moves.reduce((s, mv) => s + q[mv], 0);
  let action;
  let reason;
  let agreement;
  let finalPhase;

  if (sig.manual) {
    action = `MANUAL · ${name(sig.manualPhase)}`;
    reason = 'Operator override is active. Model output is logged but not applied.';
    agreement = 'op';
    finalPhase = sig.manualPhase;
  } else if (sig.stage !== 'G') {
    if (sig.next === null || sig.next === cur) sig.next = rec.phase !== cur ? rec.phase : sim.bestOther(cur);
    sig.nextDur = sig.next === rec.phase ? rec.duration : sim.durFor(sig.next);
    action = `CLEARANCE → ${name(sig.next)}`;
    reason = `${sig.stage === 'Y' ? 'Yellow' : 'All-red'} interval running. Next green is locked in.`;
    agreement = sig.next === rec.phase ? 'ok' : 'adj';
    finalPhase = sig.next;
  } else {
    const starving = [0, 1, 2, 3].filter((p) => p !== cur && demand(p) > 0 && sim.T - sim.lastEnd[p] > CFG.STARVE);
    if (starving.length && starving[0] !== rec.phase) {
      const sp = starving[0];
      sig.next = sp;
      sig.nextDur = sim.durFor(sp);
      if (el >= CFG.MIN) { sig.target = el; action = `SWITCH → ${name(sp)}`; }
      else { sig.target = CFG.MIN; action = `HOLD ${Math.ceil(CFG.MIN - el)}s, then → ${name(sp)}`; }
      reason = `Starvation guard: ${name(sp)} has waited ${Math.round(sim.T - sim.lastEnd[sp])}s (limit ${CFG.STARVE}s). Overrides the model.`;
      agreement = 'ovr';
      finalPhase = sp;
    } else if (rec.phase === cur) {
      if (el >= CFG.MAX - 0.5) {
        const nx = sim.bestOther(cur);
        sig.next = nx;
        sig.nextDur = sim.durFor(nx);
        sig.target = el;
        action = `SWITCH → ${name(nx)}`;
        reason = `Model wants to keep ${name(cur)}, but max green (${CFG.MAX}s) is reached.`;
        agreement = 'ovr';
        finalPhase = nx;
      } else {
        let need = 0;
        for (const mv of PHASES[cur].moves) {
          const sat = mv[1] === 'L' ? CFG.SAT_L : CFG.SAT_T;
          need = Math.max(need, q[mv] / sat + 1.5);
        }
        const ext = Math.round(Math.max(3, Math.min(10, need)));
        const newTarget = Math.min(CFG.MAX, el + ext);
        const capped = newTarget < el + ext;
        sig.target = Math.max(sig.target, newTarget);
        action = `HOLD ${name(cur)} green +${Math.round(sig.target - el)}s`;
        reason = capped
          ? `Extension capped by max green (${CFG.MAX}s).`
          : `Predicted demand still favors this phase. ${demand(cur)} vehicles left to clear.`;
        agreement = capped ? 'adj' : 'ok';
        finalPhase = cur;
        sig.next = null;
      }
    } else {
      sig.next = rec.phase;
      sig.nextDur = rec.duration;
      if (el < CFG.MIN) {
        sig.target = CFG.MIN;
        action = `HOLD ${Math.ceil(CFG.MIN - el)}s, then → ${name(rec.phase)}`;
        reason = `Min green (${CFG.MIN}s) not met yet. Switch is queued.`;
        agreement = 'adj';
      } else {
        sig.target = el;
        action = `SWITCH → ${name(rec.phase)}`;
        reason = `Forecast pressure on ${name(rec.phase)} exceeds the current phase. Starting yellow.`;
        agreement = 'ok';
      }
      finalPhase = rec.phase;
    }
  }
  return { t: sim.T, action, reason, agreement, mlPhase: rec.phase, finalPhase };
}
