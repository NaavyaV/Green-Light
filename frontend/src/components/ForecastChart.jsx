import { useState } from 'react';
import { APPROACHES, AP_NAME, SERIES_TOKEN, FORECAST_STEPS, FORECAST_EVERY } from '../sim/constants.js';

const W = 520; const Hh = 210; const PAD = { l: 34, r: 40, t: 10, b: 26 };
const IW = W - PAD.l - PAD.r; const IH = Hh - PAD.t - PAD.b;
const niceMax = (v) => [5, 10, 15, 20, 30, 40, 60, 80, 100].find((x) => x >= v) || Math.ceil(v / 20) * 20;
const mono = 'JetBrains Mono, monospace';

/** Predicted queue per approach, now → +30s. Hover for exact values. */
export default function ForecastChart({ forecast, theme }) {
  const [hover, setHover] = useState(null);
  const { series } = forecast;
  const ymax = niceMax(Math.max(4, ...APPROACHES.flatMap((a) => series[a])) * 1.1);
  const x = (i) => PAD.l + (i / FORECAST_STEPS) * IW;
  const y = (v) => PAD.t + IH - (v / ymax) * IH;
  const label = (i) => (i ? `+${i * FORECAST_EVERY}s` : 'now');

  // End labels, nudged apart so they never overlap
  const ends = APPROACHES.map((a) => ({ a, y: y(series[a][FORECAST_STEPS]) })).sort((p, q) => p.y - q.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;

  const onMove = (e) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(FORECAST_STEPS, Math.round(((sx - PAD.l) / IW) * FORECAST_STEPS)));
    setHover({ i, px: (x(i) / W) * r.width, width: r.width });
  };

  return (
    <>
      <div className="legend">
        {APPROACHES.map((a) => <span key={a}><i style={{ background: `var(${SERIES_TOKEN[a]})` }} />{AP_NAME[a]}</span>)}
        <span style={{ color: 'var(--fg-3)' }}>queued vehicles, under the scheduled signal plan</span>
      </div>
      <div className="chartwrap">
        <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Predicted queue length per approach over the next 30 seconds">
          {[0, ymax / 2, ymax].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={theme['--line']} strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fontFamily={mono} fill={theme['--fg-3']}>{t}</text>
            </g>
          ))}
          {[0, 2, 4, 6].map((i) => (
            <text key={i} x={x(i)} y={Hh - 6} textAnchor="middle" fontSize="11" fontFamily={mono} fill={theme['--fg-3']}>{label(i)}</text>
          ))}
          {APPROACHES.map((a) => {
            const col = theme[SERIES_TOKEN[a]];
            const d = series[a].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
            return (
              <g key={a}>
                <path d={d} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(0)} cy={y(series[a][0])} r="3" fill={col} stroke={theme['--panel']} strokeWidth="2" />
                <circle cx={x(FORECAST_STEPS)} cy={y(series[a][FORECAST_STEPS])} r="4" fill={col} stroke={theme['--panel']} strokeWidth="2" />
              </g>
            );
          })}
          {ends.map((e) => (
            <text key={e.a} x={x(FORECAST_STEPS) + 9} y={e.y + 4} fontSize="12" fontWeight="600" fontFamily="Barlow Semi Condensed, sans-serif" fill={theme['--fg-2']}>
              {e.a} {Math.round(series[e.a][FORECAST_STEPS])}
            </text>
          ))}
          {hover && (
            <g>
              <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD.t} y2={PAD.t + IH} stroke={theme['--fg-3']} strokeDasharray="3 3" />
              {APPROACHES.map((a) => (
                <circle key={a} cx={x(hover.i)} cy={y(series[a][hover.i])} r="4" fill={theme[SERIES_TOKEN[a]]} stroke={theme['--panel']} strokeWidth="2" />
              ))}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={IW} height={IH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hover && (
          <div className="tip" style={{ left: Math.min(hover.width - 140, Math.max(4, hover.px + 12)), top: 8 }}>
            <div className="label" style={{ marginBottom: 4 }}>{hover.i ? `+${hover.i * FORECAST_EVERY}s` : 'Now'}</div>
            {APPROACHES.map((a) => (
              <div key={a} className="row">
                <span><i style={{ background: `var(${SERIES_TOKEN[a]})` }} />{AP_NAME[a]}</span>
                <b className="num">{series[a][hover.i].toFixed(1)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
