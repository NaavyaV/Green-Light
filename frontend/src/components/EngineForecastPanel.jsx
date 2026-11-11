import { APPROACHES, MOVES, AP_NAME, SERIES_TOKEN } from '../sim/constants.js';
import { MODEL_INFO } from '../config.js';
import { fmtClock } from '../lib/format.js';
import { decisionSourceLabel } from '../engine/labels.js';

const WARMUP = 60; // the model needs 60 s of arrival history

const approachTotal = (record, a) => MOVES.reduce((s, m) => s + record[a + m], 0);

/** Horizontal bars per approach; optional second bar for comparison (e.g. actual arrivals). */
function ApproachBars({ values, compare, compareLabel }) {
  const max = Math.max(1, ...APPROACHES.map((a) => Math.max(values[a], compare ? compare[a] : 0)));
  return (
    <div className="ebars" role="img" aria-label="Arrivals per approach">
      {APPROACHES.map((a) => (
        <div key={a} className="ebar-row">
          <span className="rl">{AP_NAME[a]}</span>
          <div className="ebar-track">
            <i style={{ width: `${(values[a] / max) * 100}%`, background: `var(${SERIES_TOKEN[a]})` }} />
            {compare && <i className="cmp" style={{ width: `${(compare[a] / max) * 100}%` }} title={compareLabel} />}
          </div>
          <b className="num">{values[a].toFixed(1)}{compare && <small> / {compare[a]}</small>}</b>
        </div>
      ))}
    </div>
  );
}

function Accuracy({ score }) {
  if (!score.latest) {
    return (
      <p className="note" style={{ marginTop: 0 }}>
        Each forecast is checked against the cars that actually arrive in its 30 seconds.
        {score.nextScoreIn !== null ? ` First score in ${score.nextScoreIn}s.` : ` First forecast at ${fmtClock(WARMUP)}.`}
      </p>
    );
  }
  const l = score.latest;
  const better = score.meanNaiveError !== null && score.meanModelError < score.meanNaiveError;
  const byApproach = (r) => Object.fromEntries(APPROACHES.map((a) => [a, approachTotal(r, a)]));
  return (
    <>
      <div className="facts" style={{ gridTemplateColumns: 'repeat(3,auto)' }}>
        <div><span className="label">Model error</span><b>{score.meanModelError.toFixed(2)}</b><small>veh / movement</small></div>
        <div><span className="label">Naive guess</span><b>{score.meanNaiveError.toFixed(2)}</b><small>last 30 s repeats</small></div>
        <div><span className="label">Scored</span><b>{score.count}</b><small>forecasts</small></div>
      </div>
      <p className="note" style={{ marginTop: 6 }}>
        {better ? 'The model is beating' : 'The model is not yet beating'} the naive guess on average.
        {' '}Next score in {score.nextScoreIn ?? '—'}s.
      </p>
      <div className="sub2">Forecast from {fmtClock(l.generatedAt)} · predicted / actual (scored at {fmtClock(l.scoredAt)})</div>
      <ApproachBars values={byApproach(l.predicted)} compare={byApproach(l.actual)} compareLabel="actual arrivals" />
      <ul className="log">
        {score.recent.slice(0, 5).map((s) => (
          <li key={s.generatedAt}>
            <span>{fmtClock(s.generatedAt)}</span>
            <span>predicted {s.predictedTotal.toFixed(0)} · actual {s.actualTotal}</span>
            <span>±{s.modelError.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** ML forecast tab when the data comes from the C++ engine. Shows only what the engine sends. */
export default function EngineForecastPanel({ view }) {
  const { engine, forecast: f, T } = view;
  const [source, sourceCls] = decisionSourceLabel(engine);
  let status;
  if (engine.modelStatus === 'warming_up') {
    status = <>Warming up: the model needs {WARMUP} s of arrival history. First forecast in {Math.max(0, WARMUP - T)} s.</>;
  } else if (engine.modelStatus === 'invalid_output') {
    status = <span style={{ color: 'var(--sig-red)' }}>The model returned an invalid value this cycle; the controller falls back to reactive control until the next forecast.</span>;
  } else if (engine.modelStatus === 'disabled') {
    status = 'The engine is running without the model.';
  } else {
    status = <>Forecast made at <b className="num">{fmtClock(f.generatedAt)}</b> for the next {f.horizonSeconds} s. Next forecast in {Math.ceil(view.nextForecastIn)} s.</>;
  }

  return (
    <>
      <div className="ph">
        <h2>ML forecast · next 30s</h2>
        <span className={`chip ${engine.modelStatus === 'ready' ? 'g' : engine.modelStatus === 'invalid_output' ? 'r' : 'a'}`}>
          <span className="dot" />{engine.modelStatus.replace('_', ' ')}
        </span>
      </div>
      <div className="pb">
        <div className="decision">
          <span className="label">Nakshatra&apos;s traffic model · running in C++</span>
          <div className="why">{status}</div>
        </div>
        <div className="facts" style={{ marginTop: 10, gridTemplateColumns: 'repeat(2,auto)' }}>
          <div><span className="label">Model</span><b style={{ fontSize: 13 }}>{MODEL_INFO}</b></div>
          <div><span className="label">Signal decided by</span><span className={`chip ${sourceCls}`} style={{ marginTop: 3 }}><span className="dot" />{source}</span></div>
          <div><span className="label">Speed inputs</span><span className="chip a" style={{ marginTop: 3 }} title="The simulator has no vehicle speeds, so the model's 12 speed inputs use the training-data average">imputed · training mean</span></div>
          <div><span className="label">Confidence / latency</span><b style={{ fontSize: 13, color: 'var(--fg-3)' }}>— not provided by the engine</b></div>
        </div>

        {f && (
          <>
            <div className="sub2">Predicted arrivals per approach, next 30s (veh)</div>
            <ApproachBars values={Object.fromEntries(APPROACHES.map((a) => [a, approachTotal(f.arrivals, a)]))} />
            <div className="arr-grid">
              <span /><span className="h">Left</span><span className="h">Thru</span><span className="h">Right</span>
              {APPROACHES.map((a) => [
                <span key={a} className="rl">{AP_NAME[a]}</span>,
                ...MOVES.map((m) => <span key={a + m} className="c">{f.arrivals[a + m].toFixed(1)}</span>),
              ])}
            </div>
          </>
        )}

        <div className="sub2">Forecast accuracy · scored live</div>
        <Accuracy score={view.forecastScore} />
      </div>
    </>
  );
}
