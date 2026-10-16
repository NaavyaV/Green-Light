const W = 110;

/** Small trend line with an area fill and an emphasized last point. */
export default function Sparkline({ values }) {
  if (!values.length) return <svg viewBox="0 0 110 34" aria-hidden="true" />;
  const max = Math.max(1, ...values) * 1.1;
  const n = Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => [(i / n) * W, 32 - (v / max) * 30]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 110 34" aria-hidden="true">
      <path d={`${d} L110 33 L0 33 Z`} style={{ fill: 'var(--fg-2)' }} opacity=".14" />
      <path d={d} fill="none" style={{ stroke: 'var(--fg-2)' }} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" style={{ fill: 'var(--fg-2)' }} />
    </svg>
  );
}
