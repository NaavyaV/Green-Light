import { CFG, PHASES, HORIZON } from '../sim/constants.js';
import { fmtClock, AGREEMENT } from '../lib/format.js';

function Chip({ cls, children }) {
  return <span className={`chip ${cls}`}><span className="dot" />{children}</span>;
}

function rules(view) {
  const { sig, longestPhaseWait: mw } = view;
  const G = sig.stage === 'G';
  return [
    [`Min green ${CFG.MIN}s`, G && sig.t < CFG.MIN ? ['a', 'enforcing'] : ['g', 'met']],
    [`Max green ${CFG.MAX}s`, G && sig.t > CFG.MAX - 8 && !sig.manual ? ['a', `${Math.floor(sig.t)}s`] : ['g', 'ok']],
    [`Yellow ${CFG.YEL}s · all-red ${CFG.AR}s`, !G ? ['a', 'active'] : ['g', 'ready']],
    ['Conflicting greens', ['g', 'none']],
    [`Starvation ≤ ${CFG.STARVE}s`, [mw > CFG.STARVE ? 'r' : mw > CFG.STARVE - 20 ? 'a' : 'g', `${Math.round(mw)}s`]],
    ['Ped clearance', G ? ['g', 'ok'] : ['a', 'clearing']],
  ];
}

export default function ControllerPanel({ view }) {
  const d = view.decision;
  const ag = d ? AGREEMENT[d.agreement] : null;
  return (
    <>
      <div className="ph">
        <h2>C++ controller decision</h2>
        {ag ? <Chip cls={ag.cls}>{ag.label}</Chip> : <span className="chip">—</span>}
      </div>
      <div className="pb">
        <div className="decision">
          <span className="label">{d ? `Decision at ${fmtClock(d.t)}` : 'Decision'}</span>
          <div className="act">{d ? d.action : '—'}</div>
          <div className="why">{d ? d.reason : ''}</div>
        </div>
        <div className="vs">
          <div><span className="label">ML suggested</span><b>{d ? `${PHASES[d.mlPhase].name}${view.forecast ? ` · ${view.forecast.recommendation.duration}s` : ''}` : '—'}</b></div>
          <div><span className="label">Controller scheduled</span><b>{d ? PHASES[d.finalPhase].name : '—'}</b></div>
        </div>

        <div className="sub2">Signal schedule · next 30s</div>
        <div className="timeline">
          {view.plan.map((s, i) => {
            const len = Math.min(HORIZON, s.t1) - s.t0;
            const title = s.kind === 'G' ? `${PHASES[s.phase].name} green` : s.kind === 'Y' ? 'Yellow' : 'All red';
            return (
              <div key={`${s.kind}-${s.t0.toFixed(2)}`} className={`sg ${s.kind} ${i === 0 && s.kind === 'G' ? 'cur' : ''}`}
                style={{ width: `${(len / HORIZON) * 100}%` }} title={title}>
                {s.kind === 'G' ? `${PHASES[s.phase].name} ${Math.round(len)}${s.t1 > HORIZON ? '+' : ''}s` : ''}
              </div>
            );
          })}
        </div>
        <div className="tl-axis"><span>now</span><span>+10s</span><span>+20s</span><span>+30s</span></div>

        <div className="sub2">Traffic rule checks</div>
        <ul className="rules">
          {rules(view).map(([name, [cls, text]]) => <li key={name}><span>{name}</span><Chip cls={cls}>{text}</Chip></li>)}
        </ul>

        <div className="sub2">Decision history</div>
        <ul className="log">
          {view.decisionLog.map((l) => (
            <li key={`${l.t}-${l.action}`}>
              <span>{fmtClock(l.t)}</span><span>{l.action}</span>
              <span className={`chip ${AGREEMENT[l.agreement].cls}`} style={{ padding: '1px 6px' }}>{AGREEMENT[l.agreement].label}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
