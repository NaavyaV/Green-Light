import { INTERSECTIONS, SCENARIOS, FORECAST_EVERY } from '../sim/constants.js';
import { ENGINE_DEMANDS } from '../config.js';
import { fmtClock } from '../lib/format.js';

const RING = 56.5; // circumference of the countdown ring
const LIVE_TAG = {
  live: ['LIVE · C++ ENGINE', 'live'],
  paused: ['PAUSED · C++ ENGINE', 'paused'],
  offline: ['ENGINE OFFLINE', 'offline'],
  connecting: ['CONNECTING', 'paused'],
};

export default function Header({ view, intersection, onIntersection, scenario, onScenario, speed, onSpeed, running, onToggleRun, connection, onDemand }) {
  const offset = RING * (1 - view.nextForecastIn / FORECAST_EVERY);
  const engine = view.engine; // only set when the data comes from the C++ engine
  const [tagText, tagCls] = engine ? LIVE_TAG[connection.status] : ['SIMULATED', ''];
  return (
    <header className="top">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
        <div>
          <h1>Green Light</h1>
          <small>Adaptive signal control · GDG ML track</small>
        </div>
      </div>
      <div className="ctrls">
        {/* In engine mode this would only rename the streets (the engine has one
            intersection), so it is shown for the browser demo only. */}
        {!engine && (
          <label className="field">
            <span className="label">Intersection</span>
            <select id="isect" aria-label="Intersection" value={intersection} onChange={(e) => onIntersection(Number(e.target.value))}>
              {INTERSECTIONS.map((x, i) => <option key={x.name} value={i}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">Demand</span>
          {engine ? (
            // The engine's demand presets; changing one restarts the engine.
            <select id="scen" aria-label="Engine demand" value={engine.bridge.settings?.demand ?? 'normal'}
              onChange={(e) => onDemand(e.target.value)}>
              {Object.entries(ENGINE_DEMANDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          ) : (
            <select id="scen" aria-label="Demand scenario" value={scenario} onChange={(e) => onScenario(e.target.value)}>
              {Object.entries(SCENARIOS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          )}
        </label>
        <div className="seg" role="group" aria-label="Simulation speed">
          {[1, 2, 4].map((v) => (
            <button key={v} type="button" aria-pressed={speed === v} onClick={() => onSpeed(v)}>{v}×</button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onToggleRun} aria-label={running ? 'Pause simulation' : 'Play simulation'}>
          {running ? 'Pause' : 'Play'}
        </button>
        <div className="clock" title="Simulation clock and time until the next model forecast">
          <svg className="ring" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9" fill="none" style={{ stroke: 'var(--line-2)' }} strokeWidth="3" />
            <circle cx="11" cy="11" r="9" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={RING} strokeDashoffset={offset.toFixed(1)} transform="rotate(-90 11 11)" />
          </svg>
          <b>{fmtClock(view.T)}</b>
          <span className={`sim-tag ${tagCls}`}>{tagText}</span>
        </div>
      </div>
    </header>
  );
}
