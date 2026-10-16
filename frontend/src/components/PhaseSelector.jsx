import { useEffect, useRef } from 'react';
import { PHASES, AP_NAME } from '../sim/constants.js';
import { drawPhaseGlyph } from '../canvas/drawIntersection.js';

function PhaseGlyph({ phase, sig, selected, theme }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round((c.getBoundingClientRect().width || 48) * dpr);
    if (c.width !== px) { c.width = px; c.height = px; }
    drawPhaseGlyph(c.getContext('2d'), px, { phase, sig, selected, theme });
  }, [phase, sig.phase, sig.stage, selected, theme]);
  return <canvas ref={ref} aria-hidden="true" />;
}

function StateChip({ p, view }) {
  const { sig, decision } = view;
  if (sig.phase === p && sig.stage === 'G') return <span className="chip g"><span className="dot" />{sig.manual ? 'HELD' : 'GREEN'}</span>;
  if (sig.phase === p && sig.stage === 'Y') return <span className="chip a"><span className="dot" />YELLOW</span>;
  if (sig.next === p || (decision && decision.finalPhase === p && sig.phase !== p)) return <span className="chip">NEXT</span>;
  return null;
}

/** Four phase cards. Selecting one previews it on the map; Force puts it on manual hold. */
export default function PhaseSelector({ view, theme, selected, onSelect, onForce, onResume }) {
  const { sig, forecast, phaseQueued } = view;
  let note;
  if (selected !== null) {
    const ph = PHASES[selected];
    const q = phaseQueued[selected];
    const rel = ph.moves.map((mv) => `${AP_NAME[mv[0]][0]}${mv[1]}`).join(' ');
    const isNow = sig.phase === selected && sig.stage === 'G';
    note = (
      <span>
        Preview <b>{ph.name}</b> ({rel}) · <b>{q}</b> waiting {q === 1 ? 'car' : 'cars'} {isNow ? 'moving now' : 'would be released'}
      </span>
    );
  } else {
    note = <span style={{ color: 'var(--fg-3)' }}>Select a phase below to highlight the cars it would release</span>;
  }

  return (
    <div className="phasebar">
      <div className="phases" role="group" aria-label="Signal phases">
        {PHASES.map((p) => {
          const predicted = forecast ? Math.round(p.moves.reduce((s, mv) => s + forecast.arrivals[mv], 0)) : 0;
          return (
            <button key={p.id} type="button" className="phase" aria-pressed={selected === p.id} onClick={() => onSelect(p.id)}>
              <PhaseGlyph phase={p.id} sig={sig} selected={selected} theme={theme} />
              <span className="txt">
                <span className="pn">{p.name}</span>
                <span className="ps">{phaseQueued[p.id]} queued · +{predicted} next 30s</span>
                <span className="state"><StateChip p={p.id} view={view} /></span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="phase-actions">
        <div className="preview-note">{note}</div>
        <button type="button" className="btn primary" onClick={onForce}
          disabled={selected === null || (sig.manual && sig.manualPhase === selected)}>Force phase</button>
        <button type="button" className="btn" onClick={onResume} disabled={!sig.manual}>Resume auto</button>
      </div>
    </div>
  );
}
