/** Sim clock label, e.g. T+01:05 */
export function fmtClock(t) {
  const s = Math.max(0, Math.floor(t));
  return `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const AGREEMENT = {
  ok: { cls: 'g', label: 'Matches ML', short: 'matches ML' },
  adj: { cls: 'a', label: 'Rule-adjusted', short: 'adjusted' },
  ovr: { cls: 'r', label: 'Overrode ML', short: 'override' },
  op: { cls: 'acc', label: 'Operator override', short: 'manual' },
};
