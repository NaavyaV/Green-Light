import { ENGINE_RULES, ENGINE_CONTROLLERS } from '../config.js';
import { fmtClock } from '../lib/format.js';
import { decisionSourceLabel, phaseName, STAGE_NAME } from '../engine/labels.js';

const TIMELINE = 30;

function Chip({ cls, children }) {
  return <span className={`chip ${cls}`}><span className="dot" />{children}</span>;
}

// Each rule, checked against what the engine has actually done since we started watching.
function rules(view) {
  const { green, yellow, allRed, currentGreen, conflicts } = view.ruleChecks;
  const { minGreen, maxGreen, yellow: yel, allRed: ar } = ENGINE_RULES;
  const waiting = ['', 'waiting'];
  const exact = (r, want) => (!r.count ? waiting : r.min === want && r.max === want ? ['g', `${r.count}× ok`] : ['r', `${r.min}–${r.max}s`]);
  const longest = Math.max(green.max ?? 0, currentGreen ?? 0);
  return [
    [`Min green ${minGreen}s`, !green.count ? waiting : green.min >= minGreen ? ['g', `shortest ${green.min}s`] : ['r', `${green.min}s`]],
    [`Max green ${maxGreen}s`, !green.count && currentGreen === null ? waiting : longest <= maxGreen ? ['g', `longest ${longest}s`] : ['r', `${longest}s`]],
    [`Yellow ${yel}s`, exact(yellow, yel)],
    [`All-red ${ar}s`, exact(allRed, ar)],
    ['Conflicting greens', conflicts.secondsInConflict === 0 ? ['g', `none in ${conflicts.secondsChecked}s`] : ['r', `${conflicts.secondsInConflict}s`]],
    ['Longest unserved phase', view.longestPhaseWait === null ? ['', 'watching'] : ['', `${view.longestPhaseWait}s`]],
  ];
}

function actionText(d, view) {
  if (!d) return '—';
  if (d.action === 'hold') return `HOLD ${phaseName(view.sig.phase)} green`;
  if (d.action === 'switch') return `END ${phaseName(view.sig.phase)} green`;
  return `CLEARANCE → ${phaseName(d.nextPhase)}`;
}

/** Controller tab when the data comes from the C++ engine. */
export default function EngineControllerPanel({ view, onRestart }) {
  const { engine, decision: d } = view;
  const [source, sourceCls] = decisionSourceLabel(engine);
  const settings = engine.bridge.settings;
  return (
    <>
      <div className="ph">
        <h2>C++ controller decision</h2>
        <Chip cls={sourceCls}>{source}</Chip>
      </div>
      <div className="pb">
        <div className="decision">
          <span className="label">Decision at {fmtClock(view.T)}</span>
          <div className="act">{actionText(d, view)}</div>
          <div className="why">{d ? d.text : ''}</div>
        </div>
        <div className="vs">
          <div><span className="label">Decided by</span><b>{source}</b></div>
          <div><span className="label">Next second</span><b>{d ? `${phaseName(d.nextPhase)} · ${STAGE_NAME[d.nextStage]}` : '—'}</b></div>
        </div>

        <div className="sub2">Signal history · last 30s</div>
        <div className="timeline">
          {view.signalHistory.map((s, i) => (
            <div key={`${i}-${s.phase}-${s.stage}`} className={`sg ${s.stage} ${i === view.signalHistory.length - 1 && s.stage === 'G' ? 'cur' : ''}`}
              style={{ width: `${(s.seconds / TIMELINE) * 100}%` }} title={`${phaseName(s.phase)} ${STAGE_NAME[s.stage]} · ${s.seconds}s`}>
              {s.stage === 'G' ? `${phaseName(s.phase)} ${s.seconds}s` : ''}
            </div>
          ))}
        </div>
        <div className="tl-axis"><span>−30s</span><span>−20s</span><span>−10s</span><span>now</span></div>

        <div className="sub2">Traffic rule checks · as observed</div>
        <ul className="rules">
          {rules(view).map(([name, [cls, text]]) => <li key={name}><span>{name}</span><Chip cls={cls}>{text}</Chip></li>)}
        </ul>

        <div className="sub2">Decision history</div>
        <ul className="log">
          {view.decisionLog.length === 0 && <li><span>—</span><span>No phase switches yet</span><span /></li>}
          {view.decisionLog.map((l) => (
            <li key={l.t}>
              <span>{fmtClock(l.t)}</span><span>Ended {phaseName(l.fromPhase)} green</span>
              <span className="chip" style={{ padding: '1px 6px' }}>
                {decisionSourceLabel({ decisionSource: l.source, controllerMode: engine.controllerMode })[0]}
              </span>
            </li>
          ))}
        </ul>

        {/* Kept out of the way on purpose: changing the controller restarts the engine. */}
        <details className="engine-settings">
          <summary>Engine settings</summary>
          <label className="field">
            <span className="label">Controller</span>
            <select aria-label="Engine controller" value={settings?.controller ?? engine.controllerMode}
              onChange={(e) => onRestart({ controller: e.target.value })}>
              {Object.entries(ENGINE_CONTROLLERS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <p className="note" style={{ marginTop: 6 }}>Changing the controller restarts the engine from second 1 (seed {settings?.seed ?? '—'}).</p>
        </details>
      </div>
    </>
  );
}
