import { useEffect, useState } from 'react';
import { parseReplay, toReplayView } from './replay.mjs';
import './replay.css';

const movementLabel = value => value.replaceAll('_', ' ').toLowerCase();
const phaseLabel = value => value ? movementLabel(value) : 'Unavailable';
const statuses = {
  disabled: 'Model disabled',
  warming_up: 'Warming up',
  ready: 'Ready',
  invalid_output: 'Invalid forecast · reactive fallback',
};

export function ReplayDashboard({ frames }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [movement, setMovement] = useState('N_THROUGH');
  useEffect(() => {
    if (!playing || index >= frames.length - 1) return;
    const timer = setTimeout(() => setIndex(index + 1), 1000);
    return () => clearTimeout(timer);
  }, [frames.length, index, playing]);
  const frame = frames[index];
  const view = toReplayView(frame);
  const curve = frame.queue_forecast?.[movement];
  const maxQueue = curve ? Math.max(1, ...curve) : 1;
  const last = index === frames.length - 1;
  const forecast = frame.forecast;
  return (
    <main className="replay">
      <header className="replay-controls">
        <h1>Green Light · engine replay</h1>
        <button type="button" onClick={() => {
          if (last) setIndex(0);
          setPlaying(last || !playing);
        }}>{last ? 'Replay' : playing ? 'Pause' : 'Play'}</button>
        <label>Simulated second <input type="range" min="0" max={frames.length - 1}
          value={index} onChange={event => {
            setPlaying(false);
            setIndex(Number(event.target.value));
          }} /></label>
        <output>{view.T}s</output>
      </header>
      <section className="replay-panel">
        <h2>Signals and queues</h2>
        <p>Phase {phaseLabel(frame.phase)} · {phaseLabel(frame.light_state)} · {frame.phase_elapsed_seconds}s elapsed{frame.seconds_left != null && ` · ${frame.seconds_left}s left`}</p>
        <p>{view.stats.totalQueued} queued · {view.stats.completedVehicles} completed · {view.stats.meanCompletedWaitSeconds.toFixed(1)}s mean completed wait</p>
        <p>Cars illustrate queue counts. Movement labels use direction of travel.</p>
        <div className="replay-queues">
          {frame.movement_order.map((name, i) => {
            const queue = frame.queues[i];
            const cap = 6;
            const light = frame.lights?.[name] ?? 'unavailable';
            return <div key={name} className="replay-lane">
              <b>{movementLabel(name)}</b>
              <span className={`replay-light replay-${light}`}>{light}</span>
              <span className="replay-cars" aria-hidden="true">
                {Array.from({ length: Math.min(queue, cap) }, (_, j) => <i key={j} />)}
              </span>
              <span>{queue} queued {queue > cap && <b>+{queue - cap}</b>}</span>
            </div>;
          })}
        </div>
      </section>
      <section className="replay-panel">
        <h2>Controller</h2>
        <p>{view.controllerMode} · {view.decision?.source ?? 'controller timing'}</p>
        <p>{view.decision?.text ?? 'Decision unavailable'}</p>
        <p>Next interval · {phaseLabel(view.decision?.next_phase)} · {phaseLabel(view.decision?.next_light_state)}</p>
      </section>
      <section className="replay-panel">
        <h2>30-second arrival forecast</h2>
        <p role="status">{statuses[view.modelStatus] ?? 'Forecast status unavailable'}</p>
        {forecast && <>
          <p>Issued at {forecast.generated_at_seconds}s · speed inputs use training-mean imputation</p>
          <div className="replay-queues">
            {frame.movement_order.map((name, i) => <div key={name}>{movementLabel(name)} <b>{forecast.arrivals[i].toFixed(1)}</b></div>)}
          </div>
        </>}
        <p>{frame.forecast_error
          ? `Completed forecast MAE: ${frame.forecast_error.mae_vehicles.toFixed(2)} vehicles (issued at ${frame.forecast_error.generated_at_seconds}s, evaluated at ${frame.forecast_error.evaluated_at_seconds}s)`
          : 'Forecast error appears after the first full prediction window completes.'}</p>
      </section>
      <section className="replay-panel">
        <h2>Projected schedule and queue</h2>
        <p>What-if estimate using uniformly spaced forecast arrivals and the current controller. Future engine decisions can change.</p>
        {frame.schedule ? <>
          <ul>{frame.schedule.map(segment => <li key={segment.start}>
            {segment.start}–{segment.end}s · {phaseLabel(segment.phase)} · {phaseLabel(segment.light_state)}
          </li>)}</ul>
          <label>Queue curve <select value={movement} onChange={event => setMovement(event.target.value)}>
            {frame.movement_order.map(name => <option value={name} key={name}>{movementLabel(name)}</option>)}
          </select></label>
          {curve && <>
            <svg className="replay-curve" viewBox="0 0 300 100" role="img"
              aria-label={`Projected ${movementLabel(movement)} queue from ${curve[0]} to ${curve.at(-1)} vehicles`}>
              <polyline fill="none" stroke="currentColor" strokeWidth="2"
                points={curve.map((q, i) => `${i * 10},${95 - q / maxQueue * 90}`).join(' ')} />
            </svg>
            <p>Now {curve[0]} queued · at +30s {curve.at(-1)} queued · scale 0–{maxQueue} vehicles</p>
          </>}
        </> : <p>Projection unavailable until a forecast is ready.</p>}
      </section>
    </main>
  );
}

export default function ReplayApp() {
  const [result, setResult] = useState(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${import.meta.env.BASE_URL}replay.jsonl`, { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
      return response.text();
    }).then(text => {
      const frames = parseReplay(text);
      if (!frames.length) throw new Error('Replay recording is empty');
      if (!abort.signal.aborted) setResult({ frames });
    }).catch(error => {
      if (!abort.signal.aborted) setResult({ error: error.message });
    });
    return () => abort.abort();
  }, []);
  if (!result) return <p role="status">Loading engine replay…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return <ReplayDashboard frames={result.frames} />;
}
