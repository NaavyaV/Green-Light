import { APPROACHES, AP_NAME } from '../sim/constants.js';
import Sparkline from './Sparkline.jsx';

function Kpi({ label, value, unit, sub, values }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <div className="val">{value}<small>{unit}</small></div>
      <Sparkline values={values} />
      <span className="sub">{sub}</span>
    </div>
  );
}

export default function KpiStrip({ view }) {
  const { stats, approachTotals, history } = view;
  const worst = [...APPROACHES].sort((a, b) => approachTotals[b] - approachTotals[a])[0];
  return (
    <section className="kpis" aria-label="Intersection statistics">
      <Kpi label="Avg wait · 60s" value={stats.avgWait.toFixed(1)} unit="s" sub="per vehicle at the stop line" values={history.wait} />
      <Kpi label="Vehicles queued" value={stats.totalQueued} unit="veh" sub={`worst: ${AP_NAME[worst]} (${approachTotals[worst]})`} values={history.queue} />
      <Kpi label="Throughput" value={stats.throughput.toFixed(0)} unit="veh/min" sub="crossed the stop line" values={history.thru} />
      <Kpi label="Longest wait" value={Math.round(stats.maxWait)} unit="s"
        sub={stats.maxWait > 0 && stats.maxWaitApproach ? `${AP_NAME[stats.maxWaitApproach]} approach` : 'no one waiting'} values={history.max} />
    </section>
  );
}
