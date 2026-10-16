import { APPROACHES, AP_NAME } from '../sim/constants.js';
import { fmtClock } from '../lib/format.js';

function Lamp({ lamp }) {
  return <span className={`lamp ${lamp.state}`}><i />{lamp.text}</span>;
}

export default function QueuesPanel({ view, intersection }) {
  const { stats, lamps, measuredRates, sig } = view;
  const q = stats.queues;
  // Pedestrians cross the N/S legs while E/W through traffic is green, and vice versa
  const walk = (a) => sig.stage === 'G' && sig.phase === (a === 'N' || a === 'S' ? 3 : 1);
  return (
    <>
      <div className="ph"><h2>Signals &amp; queues</h2><span className="meta">{fmtClock(view.T)} · {stats.totalQueued} queued</span></div>
      <div className="pb tw">
        <table className="sig">
          <thead>
            <tr><th>Approach</th><th>Left</th><th>Thru / Right</th><th>Ped</th><th>Queue L · T · R</th><th>Arrivals</th><th style={{ width: '14%' }}>Load</th></tr>
          </thead>
          <tbody>
            {APPROACHES.map((a) => {
              const ql = q[a + 'L']; const qt = q[a + 'T']; const qr = q[a + 'R']; const tot = ql + qt + qr;
              const loadColor = tot >= 14 ? 'var(--sig-red)' : tot >= 8 ? 'var(--sig-amber)' : 'var(--fg-3)';
              return (
                <tr key={a}>
                  <td><span className="appr">{AP_NAME[a]}<small>{a === 'N' || a === 'S' ? intersection.ns : intersection.ew}</small></span></td>
                  <td><Lamp lamp={lamps[a + 'L']} /></td>
                  <td><Lamp lamp={lamps[a + 'T']} /></td>
                  <td className="ped" style={{ color: walk(a) ? 'var(--sig-green)' : 'var(--fg-3)' }}>{walk(a) ? 'WALK' : 'DON’T'}</td>
                  <td>
                    <div className="qcells">
                      <span className={`qc ${ql >= 6 ? 'hot' : ''}`}>{ql}</span>
                      <span className={`qc ${qt >= 10 ? 'hot' : ''}`}>{qt}</span>
                      <span className="qc">{qr}</span>
                    </div>
                  </td>
                  <td className="num">{measuredRates[a].toFixed(0)}<span style={{ color: 'var(--fg-3)' }}>/min</span></td>
                  <td><div className="qbar"><i style={{ width: `${Math.min(100, (tot / 22) * 100)}%`, background: loadColor }} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note">Countdowns: a green or yellow light shows time left. A red light shows the estimated wait (~) until it turns green, based on the controller&apos;s current schedule.</p>
      </div>
    </>
  );
}
