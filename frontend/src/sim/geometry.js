import { APPROACHES, MOVES, FWD, C, H, D, STOP } from './constants.js';

/**
 * Point in world coordinates for an approach, `along` units in its travel direction from the centre
 * and `right` units to the driver's right.
 */
export function pointFor(approach, along, right) {
  const f = FWD[approach];
  const r = [-f[1], f[0]];
  return [C + f[0] * along + r[0] * right, C + f[1] * along + r[1] * right];
}

function buildRoute(a, m) {
  const P = (al, b) => pointFor(a, al, b);
  const segs = [];
  if (m === 'T') segs.push(['L', P(-D, 36), P(D, 36)]);
  if (m === 'R') segs.push(['L', P(-D, 36), P(-H, 36)], ['Q', P(-H, 36), P(-36, 36), P(-36, H)], ['L', P(-36, H), P(-36, D)]);
  if (m === 'L') segs.push(['L', P(-D, 12), P(-H, 12)], ['Q', P(-H, 12), P(12, 12), P(12, -H)], ['L', P(12, -H), P(12, -D)]);

  const pts = [];
  let len = 0;
  let prev = null;
  for (const g of segs) {
    const n = g[0] === 'L' ? Math.ceil(Math.hypot(g[2][0] - g[1][0], g[2][1] - g[1][1]) / 2) : 40;
    for (let i = pts.length ? 1 : 0; i <= n; i++) {
      const u = i / n;
      let x;
      let y;
      if (g[0] === 'L') {
        x = g[1][0] + (g[2][0] - g[1][0]) * u;
        y = g[1][1] + (g[2][1] - g[1][1]) * u;
      } else {
        const v = 1 - u;
        x = v * v * g[1][0] + 2 * v * u * g[2][0] + u * u * g[3][0];
        y = v * v * g[1][1] + 2 * v * u * g[2][1] + u * u * g[3][1];
      }
      if (prev) len += Math.hypot(x - prev[0], y - prev[1]);
      pts.push({ x, y, s: len });
      prev = [x, y];
    }
  }
  // Where a "movement arrow" drawn over this route should end (just past the box)
  let arrowEnd = len;
  for (const p of pts) {
    if (p.s > STOP && Math.max(Math.abs(p.x - C), Math.abs(p.y - C)) > H + 26) {
      arrowEnd = p.s;
      break;
    }
  }
  return { pts, len, arrowEnd };
}

/** Pre-sampled path for every movement, keyed 'NL', 'NT', ... */
export const ROUTES = {};
APPROACHES.forEach((a) => MOVES.forEach((m) => { ROUTES[a + m] = buildRoute(a, m); }));

/** Position and heading at distance s along a route. */
export function posAt(route, s) {
  const p = route.pts;
  let lo = 0;
  let hi = p.length - 1;
  if (s <= 0) return { x: p[0].x, y: p[0].y, ang: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) };
  if (s >= route.len) {
    const a = p[hi - 1];
    const b = p[hi];
    return { x: b.x, y: b.y, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid].s < s) lo = mid; else hi = mid;
  }
  const a = p[lo];
  const b = p[hi];
  const u = (s - a.s) / ((b.s - a.s) || 1);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}
