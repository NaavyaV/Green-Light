import { useCallback, useEffect, useRef, useState } from 'react';
import { Simulation } from '../sim/engine.js';

const UI_INTERVAL_MS = 250;
const WARMUP_SECONDS = 70; // open mid-traffic instead of on an empty road

/**
 * Runs the simulation on requestAnimationFrame.
 * - `sim` is the live, mutable Simulation (the canvas reads it every frame through `onFrame`).
 * - `view` is a plain snapshot for React panels, refreshed 4 times a second.
 */
export function useSimulation(initialScenario) {
  const simRef = useRef(null);
  if (!simRef.current) {
    simRef.current = new Simulation(initialScenario);
    simRef.current.advance(WARMUP_SECONDS);
  }
  const sim = simRef.current;
  const [view, setView] = useState(() => sim.snapshot());
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const frameListeners = useRef(new Set());
  const ctl = useRef({ running, speed });
  ctl.current = { running, speed };

  useEffect(() => {
    let raf;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (ctl.current.running) sim.advance(dt * ctl.current.speed);
      frameListeners.current.forEach((fn) => fn());
      if (now - lastUi > UI_INTERVAL_MS) { lastUi = now; setView(sim.snapshot()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  const refresh = useCallback(() => setView(sim.snapshot()), [sim]);
  const onFrame = useCallback((fn) => {
    frameListeners.current.add(fn);
    return () => frameListeners.current.delete(fn);
  }, []);

  const actions = {
    setRunning,
    setSpeed,
    setScenario: (s) => { sim.setScenario(s); refresh(); },
    forcePhase: (p) => { sim.forcePhase(p); refresh(); },
    resumeAuto: () => { sim.resumeAuto(); refresh(); },
  };

  return { sim, view, running, speed, actions, onFrame };
}
