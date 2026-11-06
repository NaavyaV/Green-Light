import { useEffect, useRef } from 'react';
import { drawIntersection } from '../canvas/drawIntersection.js';

const FIT_QUERY = '(min-width:1100px) and (min-height:620px)';

/**
 * Top-down canvas of the intersection. Sizes itself to the largest square that fits its stage
 * (one-screen desktop layout) or to the stage width (scrolling layout), and redraws every frame.
 */
export default function IntersectionCanvas({ sim, theme, onFrame, selected, intersection }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const props = useRef({});
  props.current = { sim, theme, selected, intersection };

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const resize = () => {
      const cs = getComputedStyle(stage);
      const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const size = Math.max(240, Math.floor(matchMedia(FIT_QUERY).matches ? Math.min(w, h) : w));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    window.addEventListener('resize', resize);
    const ctx = canvas.getContext('2d');
    const off = onFrame(() => drawIntersection(ctx, canvas.width, props.current));
    return () => { ro.disconnect(); window.removeEventListener('resize', resize); off(); };
  }, [onFrame]);

  return (
    <div className="stage" ref={stageRef}>
      <canvas ref={canvasRef} aria-label="Top-down view of a four-way signalized intersection with simulated cars" />
    </div>
  );
}
