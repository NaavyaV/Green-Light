import { useCallback, useEffect, useRef, useState } from 'react';
import { toReplayView } from '../../../integration/replay.mjs';
import { BRIDGE_URL } from '../config.js';
import { EngineSim } from '../engine/EngineSim.js';
import { applyHello, applySnapshot, applyStatus, buildView, createFeedState } from '../engine/feed.js';

const UI_INTERVAL_MS = 250;

/**
 * Live data from the C++ engine through the bridge (integration/live-server.mjs).
 * Same shape as useSimulation, so App can use either:
 * - `sim` is what the canvas reads every frame (EngineSim).
 * - `view` is the panels' snapshot, refreshed 4 times a second; null until the first second arrives.
 * - `connection` is { status: 'connecting' | 'live' | 'paused' | 'offline', error }.
 */
export function useEngineFeed() {
  const feed = useRef(null);
  if (!feed.current) feed.current = createFeedState();
  const simRef = useRef(null);
  if (!simRef.current) simRef.current = new EngineSim();
  const sim = simRef.current;

  const [view, setView] = useState(null);
  const [bridge, setBridge] = useState(feed.current.bridge);
  const [reachable, setReachable] = useState(true);
  const frameListeners = useRef(new Set());
  const dirty = useRef(false);

  // Stream from the bridge. EventSource reconnects by itself, and the bridge
  // answers every new connection with `hello`, so state is rebuilt each time.
  useEffect(() => {
    const es = new EventSource(`${BRIDGE_URL}/stream`);
    const latestToSim = () => {
      const frames = feed.current.frames;
      if (frames.length) sim.update(frames[frames.length - 1].view);
    };
    const onBridge = () => setBridge({ ...feed.current.bridge });

    es.addEventListener('hello', (e) => {
      applyHello(feed.current, JSON.parse(e.data));
      latestToSim();
      onBridge();
      setReachable(true);
      dirty.current = true;
    });
    es.addEventListener('snapshot', (e) => {
      const raw = JSON.parse(e.data);
      applySnapshot(feed.current, raw);
      sim.update(toReplayView(raw));
      dirty.current = true;
    });
    es.addEventListener('status', (e) => {
      applyStatus(feed.current, JSON.parse(e.data));
      onBridge();
      dirty.current = true;
    });
    es.onerror = () => setReachable(false);
    return () => es.close();
  }, [sim]);

  // Redraw the canvas every frame; refresh the panels 4 times a second when something changed.
  useEffect(() => {
    let raf;
    let lastUi = 0;
    const loop = (now) => {
      frameListeners.current.forEach((fn) => fn());
      if (dirty.current && now - lastUi > UI_INTERVAL_MS) {
        lastUi = now;
        dirty.current = false;
        setView(buildView(feed.current));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onFrame = useCallback((fn) => {
    frameListeners.current.add(fn);
    return () => frameListeners.current.delete(fn);
  }, []);

  const control = useCallback(async (body) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.warn('Bridge refused control request', body, await res.text());
    } catch (err) {
      console.warn('Bridge unreachable', err);
    }
  }, []);

  const running = !bridge.paused;
  const actions = {
    // Accepts a value or an updater, like React's setState (App passes `r => !r`).
    setRunning: (next) => {
      const value = typeof next === 'function' ? next(running) : next;
      control({ action: value ? 'resume' : 'pause' });
    },
    setSpeed: (value) => control({ action: 'speed', value }),
    restart: (settings = {}) => control({ action: 'restart', ...settings }),
    // The engine takes no input while it runs, so these do nothing in engine mode.
    setScenario: () => {},
    forcePhase: () => {},
    resumeAuto: () => {},
  };

  let status;
  if (!reachable) status = 'offline';
  else if (bridge.status === 'offline') status = 'offline';
  else if (bridge.status === 'connecting') status = 'connecting';
  else status = bridge.paused ? 'paused' : 'live';
  const error = !reachable ? 'Cannot reach the live bridge. Is `npm run dev:live` running?' : bridge.error;

  return { sim, view, running, speed: bridge.speed, actions, onFrame, connection: { status, error } };
}
