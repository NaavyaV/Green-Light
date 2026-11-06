import { useRef, useState } from 'react';
import { AGREEMENT } from '../lib/format.js';
import QueuesPanel from './QueuesPanel.jsx';
import ForecastPanel from './ForecastPanel.jsx';
import ControllerPanel from './ControllerPanel.jsx';

const ICONS = {
  sig: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="8" y="2.5" width="8" height="19" rx="3" /><circle cx="12" cy="7" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="17" r="1.6" />
    </svg>
  ),
  fc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18l5-6 4 3 6-8" /><path d="M15 7h3v3" /><path d="M3 21h18" />
    </svg>
  ),
  ctl: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10l3 2-3 2" /><path d="M12 15h5" />
    </svg>
  ),
};

function initialTab() {
  try { const k = localStorage.getItem('gl-tab'); if (['sig', 'fc', 'ctl'].includes(k)) return k; } catch { /* storage unavailable */ }
  return 'sig';
}

/** Right-hand panel with vertical tabs. Each tab shows a live badge so hidden tabs still report status. */
export default function SidePanel({ view, theme, intersection }) {
  const [tab, setTab] = useState(initialTab);
  const refs = useRef({});
  const engine = view.engine; // only set when the data comes from the C++ engine
  const tabs = [
    { key: 'sig', label: 'Queues', badge: `${view.stats.totalQueued} queued` },
    { key: 'fc', label: 'ML forecast', badge: `in ${Math.ceil(view.nextForecastIn)}s` },
    {
      key: 'ctl',
      label: 'Controller',
      badge: engine ? (view.decision?.action ?? '—') : view.decision ? AGREEMENT[view.decision.agreement].short : '—',
    },
  ];
  // TEMPORARY (stage D1): engine versions of these two tabs arrive in stage D2.
  const pending = <div className="pb" style={{ color: 'var(--fg-3)' }}>Engine view of this tab is coming in stage D2.</div>;
  const select = (k, focus) => {
    setTab(k);
    try { localStorage.setItem('gl-tab', k); } catch { /* ignore */ }
    if (focus) refs.current[k]?.focus();
  };
  const onKey = (e, i) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    select(tabs[(i + d + tabs.length) % tabs.length].key, true);
  };

  return (
    <aside className="panel side">
      <nav className="rail" role="tablist" aria-label="Detail panels" aria-orientation="vertical">
        {tabs.map((t, i) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" className="tab" role="tab"
            id={`tab-${t.key}`} aria-controls={`tp-${t.key}`} aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1}
            onClick={() => select(t.key)} onKeyDown={(e) => onKey(e, i)}>
            {ICONS[t.key]}
            <span>{t.label}</span>
            <span className="badge">{t.badge}</span>
          </button>
        ))}
      </nav>
      <div className="tabbody">
        <section className="tp" role="tabpanel" id="tp-sig" aria-labelledby="tab-sig" hidden={tab !== 'sig'}>
          <QueuesPanel view={view} intersection={intersection} />
        </section>
        <section className="tp" role="tabpanel" id="tp-fc" aria-labelledby="tab-fc" hidden={tab !== 'fc'}>
          {engine ? pending : <ForecastPanel view={view} theme={theme} />}
        </section>
        <section className="tp" role="tabpanel" id="tp-ctl" aria-labelledby="tab-ctl" hidden={tab !== 'ctl'}>
          {engine ? pending : <ControllerPanel view={view} />}
        </section>
      </div>
    </aside>
  );
}
