// Display wording for engine values, shared by the engine-mode panels.

import { PHASES } from '../sim/constants.js';
import { ENGINE_CONTROLLERS } from '../config.js';

/** What decided the current second: [label, chip colour class]. */
export function decisionSourceLabel(engine) {
  switch (engine.decisionSource) {
    case 'predictive_imputed_speed': return ['ML forecast', 'g'];
    case 'reactive_fallback': return ['Reactive fallback', 'a'];
    case 'safety_timing': return ['Safety timing', ''];
    default: return [ENGINE_CONTROLLERS[engine.controllerMode] ?? engine.controllerMode, ''];
  }
}

export const STAGE_NAME = { G: 'green', Y: 'yellow', AR: 'all-red' };

export function phaseName(phase) {
  return phase === null || phase === undefined ? '—' : PHASES[phase].name;
}
