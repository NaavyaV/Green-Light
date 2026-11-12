import { PHASES } from '../sim/constants.js';
import IntersectionCanvas from './IntersectionCanvas.jsx';
import PhaseSelector from './PhaseSelector.jsx';

export default function IntersectionPanel({ sim, view, theme, onFrame, intersection, selected, onSelect, onForce, onResume }) {
  const { sig } = view;
  const stageCls = sig.stage === 'G' ? 'g' : sig.stage === 'Y' ? 'a' : 'r';
  const stageText = sig.stage === 'AR'
    ? 'ALL RED'
    : `${PHASES[sig.phase].name.toUpperCase()} · ${sig.stage === 'G' ? `GREEN ${Math.floor(sig.t)}s` : 'YELLOW'}`;
  return (
    <section className="panel stagepanel">
      <div className="ph">
        <h2>Live intersection</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`chip ${sig.manual ? 'acc' : ''}`}><span className="dot" />{sig.manual ? 'MANUAL' : 'AUTO'}</span>
          <span className={`chip ${stageCls}`}><span className="dot" />{stageText}</span>
        </div>
      </div>
      <IntersectionCanvas sim={sim} theme={theme} onFrame={onFrame} selected={selected} intersection={intersection} />
      <PhaseSelector view={view} theme={theme} selected={selected} onSelect={onSelect} onForce={onForce} onResume={onResume} />
    </section>
  );
}
