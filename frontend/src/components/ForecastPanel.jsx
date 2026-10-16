import { APPROACHES, MOVES, AP_NAME, PHASES } from '../sim/constants.js';
import { fmtClock } from '../lib/format.js';
import ForecastChart from './ForecastChart.jsx';

export default function ForecastPanel({ view, theme }) {
  const f = view.forecast;
  return (
    <>
      <div className="ph"><h2>ML forecast · next 30s</h2><span className="meta">next update in {Math.ceil(view.nextForecastIn)}s</span></div>
      {!f ? <div className="pb">Waiting for the first forecast…</div> : (
        <div className="pb">
          <div className="fc-top">
            <div className="rec">
              <span className="label">Model recommends</span>
              <div className="big">Serve <span>{PHASES[f.recommendation.phase].name}</span> for {f.recommendation.duration}s</div>
            </div>
            <div className="facts">
              <div><span className="label">Confidence</span><b>{Math.round(f.recommendation.confidence * 100)}%</b></div>
              <div><span className="label">5s error</span><b>{f.error === null ? '—' : `${f.error.toFixed(1)} veh`}</b></div>
              <div><span className="label">Inference</span><b>{f.latencyMs.toFixed(1)} ms</b></div>
            </div>
          </div>
          <ForecastChart forecast={f} theme={theme} />
          <div className="sub2">Predicted arrivals, next 30s (veh)</div>
          <div className="arr-grid">
            <span /><span className="h">Left</span><span className="h">Thru</span><span className="h">Right</span>
            {APPROACHES.map((a) => [
              <span key={a} className="rl">{AP_NAME[a]}</span>,
              ...MOVES.map((m) => <span key={a + m} className="c">{f.arrivals[a + m].toFixed(1)}</span>),
            ])}
          </div>
          <div className="sub2">Model output log</div>
          <ul className="log">
            {view.mlLog.map((l) => (
              <li key={l.t}><span>{fmtClock(l.t)}</span><span>{PHASES[l.phase].name} · {l.duration}s</span><span>{Math.round(l.confidence * 100)}%</span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
