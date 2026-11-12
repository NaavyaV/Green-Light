import { WORLD, C, H, D, CAR, STOP, APPROACHES, FWD, PHASES } from '../sim/constants.js';
import { ROUTES, posAt, pointFor as P } from '../sim/geometry.js';

const sigColor = (th, st) => (st === 'G' ? th['--sig-green'] : st === 'Y' ? th['--sig-amber'] : th['--sig-red']);

function drawRoads(g, th) {
  g.fillStyle = th['--ground']; g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = th['--curb']; g.fillRect(C - H - 6, 0, 2 * H + 12, WORLD); g.fillRect(0, C - H - 6, WORLD, 2 * H + 12);
  g.fillStyle = th['--asphalt']; g.fillRect(C - H, 0, 2 * H, WORLD); g.fillRect(0, C - H, WORLD, 2 * H);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
    const x = C + sx * H; const y = C + sy * H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + sx * 14, y); g.quadraticCurveTo(x, y, x, y + sy * 14); g.closePath(); g.fill();
  });
}

function drawMarkings(g, th) {
  const edge = H + 22;
  APPROACHES.forEach((a) => {
    g.strokeStyle = th['--paint-y']; g.lineWidth = 1.6;
    [-1.6, 1.6].forEach((o) => { g.beginPath(); g.moveTo(...P(a, -D, o)); g.lineTo(...P(a, -edge, o)); g.stroke(); });
    g.strokeStyle = th['--paint']; g.globalAlpha = 0.75; g.lineWidth = 1.4; g.setLineDash([10, 10]);
    [24, -24].forEach((o) => { g.beginPath(); g.moveTo(...P(a, -D, o)); g.lineTo(...P(a, -edge - 6, o)); g.stroke(); });
    g.setLineDash([]); g.globalAlpha = 1;
    // crosswalk
    g.fillStyle = th['--paint']; g.globalAlpha = 0.85;
    for (let b = -H + 3; b < H - 2; b += 8) {
      g.beginPath(); g.moveTo(...P(a, -H - 4, b)); g.lineTo(...P(a, -H - 18, b)); g.lineTo(...P(a, -H - 18, b + 4.5)); g.lineTo(...P(a, -H - 4, b + 4.5)); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // painted lane arrows
    g.save(); g.globalAlpha = 0.45; g.strokeStyle = th['--paint']; g.lineWidth = 2; g.lineCap = 'round';
    const f = FWD[a]; const ang = Math.atan2(f[1], f[0]);
    [[12, 'L'], [36, 'T']].forEach(([off, k]) => {
      const [x, y] = P(a, -edge - 40, off);
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(-9, 0); g.lineTo(5, 0);
      if (k === 'L') { g.moveTo(1, 0); g.quadraticCurveTo(6, 0, 6, -6); g.moveTo(3, -4); g.lineTo(6, -8); g.lineTo(9, -4); }
      else { g.moveTo(5, 0); g.lineTo(1, -3); g.moveTo(5, 0); g.lineTo(1, 3); g.moveTo(-1, 0); g.quadraticCurveTo(3, 0, 3, 5); g.moveTo(0.5, 3.5); g.lineTo(3, 7); g.lineTo(5.5, 3.5); }
      g.stroke(); g.restore();
    });
    g.restore();
  });
}

function drawSignals(g, th, sim) {
  APPROACHES.forEach((a) => {
    const f = FWD[a]; const ang = Math.atan2(f[1], f[0]);
    // stop bar per lane, coloured by its signal
    [['L', 12], ['T', 36]].forEach(([k, off]) => {
      const st = sim.moveState(a + k); const col = sigColor(th, st);
      g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'butt'; g.shadowColor = col; g.shadowBlur = st === 'R' ? 4 : 10;
      g.beginPath(); g.moveTo(...P(a, -H - 22, off - 11)); g.lineTo(...P(a, -H - 22, off + 11)); g.stroke(); g.shadowBlur = 0;
    });
    // signal head on the far-right corner: [left arrow lamp, through lamp]
    const [hx, hy] = P(a, H + 14, H + 16);
    g.save(); g.translate(hx, hy); g.rotate(ang + Math.PI / 2);
    g.fillStyle = '#0b0e10'; g.strokeStyle = '#3a4448'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(-13, -6, 26, 12, 3); g.fill(); g.stroke();
    [[-6, sim.moveState(a + 'L')], [6, sim.moveState(a + 'T')]].forEach(([x, s]) => {
      const col = sigColor(th, s); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8;
      g.beginPath(); g.arc(x, 0, 3.6, 0, 7); g.fill();
    });
    g.shadowBlur = 0; g.restore();
  });
}

function drawCar(g, th, c, T, dim, highlight) {
  const p = posAt(c.route, c.s);
  g.save(); g.translate(p.x, p.y); g.rotate(p.ang); g.globalAlpha = dim ? 0.28 : 1;
  if (highlight) { g.shadowColor = th['--accent']; g.shadowBlur = 12; }
  g.fillStyle = c.color; g.beginPath(); g.roundRect(-CAR / 2, -5, CAR, 10, 3); g.fill(); g.shadowBlur = 0;
  if (highlight) { g.strokeStyle = th['--accent']; g.lineWidth = 2; g.stroke(); }
  g.fillStyle = 'rgba(10,14,18,.6)';
  g.beginPath(); g.roundRect(1, -4, 4.5, 8, 1.5); g.fill();
  g.beginPath(); g.roundRect(-7, -3.5, 3, 7, 1); g.fill();
  // turn signal
  if (c.m !== 'T' && c.s < STOP + 70 && Math.floor((T + c.blink) * 2.4) % 2 === 0) {
    g.fillStyle = '#ffb21e'; const y = c.m === 'L' ? -4.5 : 4.5;
    g.beginPath(); g.arc(CAR / 2 - 1.5, y, 1.8, 0, 7); g.arc(-CAR / 2 + 1.5, y, 1.8, 0, 7); g.fill();
  }
  // brake lights
  if (c.v < 10 && c.s < STOP + 5) { g.fillStyle = '#ff3b30'; g.fillRect(-CAR / 2, -4.5, 1.6, 2.6); g.fillRect(-CAR / 2, 1.9, 1.6, 2.6); }
  g.restore();
}

/** Movement arrow over the box for one route. Also used by the phase glyphs. */
export function drawArrow(g, route, color, w) {
  const s0 = STOP - 30; const s1 = route.arrowEnd;
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  let first = true;
  for (const p of route.pts) {
    if (p.s < s0) continue;
    if (p.s > s1) break;
    if (first) { g.moveTo(p.x, p.y); first = false; } else g.lineTo(p.x, p.y);
  }
  g.stroke();
  const e = posAt(route, s1); const hs = w * 2.4;
  g.fillStyle = color; g.save(); g.translate(e.x, e.y); g.rotate(e.ang);
  g.beginPath(); g.moveTo(hs * 1.2, 0); g.lineTo(-hs * 0.6, -hs); g.lineTo(-hs * 0.6, hs); g.closePath(); g.fill(); g.restore();
}

function drawLabels(g, th, intersection) {
  g.font = '600 12px "Barlow Semi Condensed", sans-serif'; g.fillStyle = th['--fg-2']; g.textAlign = 'center';
  g.fillText(`N · ${intersection.ns}`, C + H + 60, 20);
  g.fillText(`S · ${intersection.ns}`, C - H - 60, WORLD - 12);
  g.save(); g.translate(WORLD - 14, C + H + 64); g.rotate(Math.PI / 2); g.fillText(`E · ${intersection.ew}`, 0, 0); g.restore();
  g.save(); g.translate(14, C - H - 64); g.rotate(-Math.PI / 2); g.fillText(`W · ${intersection.ew}`, 0, 0); g.restore();
}

/** Draw the whole intersection. `selected` = previewed phase index or null. */
export function drawIntersection(ctx, canvasPx, { sim, theme, selected, intersection }) {
  const s = canvasPx / WORLD;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  drawRoads(ctx, theme);
  drawMarkings(ctx, theme);
  const preview = selected !== null ? PHASES[selected].moves : null;
  if (preview) {
    ctx.globalAlpha = 0.55;
    preview.forEach((mv) => drawArrow(ctx, ROUTES[mv], theme['--accent'], 5));
    ctx.globalAlpha = 1;
  }
  for (const c of sim.allCars()) {
    const inPreview = preview && preview.includes(c.mv);
    drawCar(ctx, theme, c, sim.T, preview && !inPreview && !c.crossed, inPreview && !c.crossed);
  }
  if (sim.laneLabels) drawLaneLabels(ctx, theme, sim.laneLabels());
  drawSignals(ctx, theme, sim);
  drawLabels(ctx, theme, intersection);
}

/** "+N" chips for lanes with more queued cars than fit on screen (engine data only). */
function drawLaneLabels(g, th, labels) {
  // Lanes are 24 units apart, so chips stay narrower than that to keep neighbours apart.
  g.font = '700 9px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const { lane, hidden } of labels) {
    const [x, y] = P(lane[0], -D + 52, lane[1] === 'L' ? 12 : 36); // just behind the last drawn car
    const text = `+${hidden}`;
    const w = Math.min(22, g.measureText(text).width + 4);
    g.fillStyle = th['--accent']; g.beginPath(); g.roundRect(x - w / 2, y - 7, w, 14, 3); g.fill();
    g.fillStyle = th['--accent-ink']; g.fillText(text, x, y + 0.5);
  }
  g.textBaseline = 'alphabetic';
}

/** Small top-down icon of one phase's movements. */
export function drawPhaseGlyph(ctx, canvasPx, { phase, sig, selected, theme }) {
  const span = 240; const o = C - span / 2; const k = canvasPx / span;
  ctx.setTransform(k, 0, 0, k, -o * k, -o * k);
  ctx.fillStyle = theme['--ground']; ctx.fillRect(o, o, span, span);
  ctx.fillStyle = theme['--asphalt']; ctx.fillRect(C - H, o, 2 * H, span); ctx.fillRect(o, C - H, span, 2 * H);
  const active = sig.phase === phase && sig.stage !== 'AR';
  const col = active ? (sig.stage === 'G' ? theme['--sig-green'] : theme['--sig-amber']) : (selected === phase ? theme['--accent'] : theme['--paint']);
  ctx.globalAlpha = active || selected === phase ? 1 : 0.8;
  PHASES[phase].moves.forEach((mv) => drawArrow(ctx, ROUTES[mv], col, 6));
  ctx.globalAlpha = 1;
}
