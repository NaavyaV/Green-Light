// Live bridge: keeps the C++ engine running and streams one JSONL snapshot per
// simulated second to browsers over Server-Sent Events.
//
//   node integration/live-server.mjs          # http://127.0.0.1:8787
//
// Settings (environment variables):
//   GL_ENGINE   path to the green_light executable (default: build/green_light[.exe])
//   GL_WEIGHTS  path to the model weights (default: ml_handoff/model_weights.txt)
//   PORT        port to listen on (default 8787; always bound to 127.0.0.1)
//
// Routes:
//   GET  /api/stream   SSE: `hello` (state + recent history), then `snapshot`, `status`
//   POST /api/control  {"action":"pause"} | {"action":"resume"} | {"action":"speed","value":2}
//                      | {"action":"restart","seed":7,"controller":"fixed","demand":"normal"}
//   GET  /api/health   JSON status
//
// Pacing: the engine runs as fast as it can, but the bridge only reads
// `speed` lines per second. When its small queue is full it stops reading
// stdout, the pipe fills, and the operating system blocks the engine until
// there is room. Pausing simply stops the reading clock.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONTROLLERS = ['fixed', 'reactive', 'predictive'];
export const DEMANDS = ['normal', 'overloaded'];
export const LIMITS = {
  minSpeed: 0.25,
  maxSpeed: 20,
  maxSeed: 4294967295,
  historySeconds: 180, // snapshots a new client receives so trend lines fill at once
  queueHigh: 50, // stop reading engine stdout at this many buffered lines
  queueLow: 10, // start reading again at this many
  stderrTail: 20, // engine error lines kept for the offline message
  heartbeatMs: 15000,
  maxBodyBytes: 1024,
};
// Engine run length: the largest value its argument parser accepts (~136 simulated years).
const RUN_SECONDS = '4294967295';

export function defaultEnginePath() {
  return path.join(ROOT, 'build', process.platform === 'win32' ? 'green_light.exe' : 'green_light');
}

const BUILD_HINT =
  'Build it from the repo root: cmake -S . -B build -DBUILD_TESTING=OFF, then cmake --build build' +
  ' (on Windows with MinGW add -G "MinGW Makefiles" to the first command), or set GL_ENGINE.';

export function createBridge(options = {}) {
  const enginePath = options.enginePath ?? process.env.GL_ENGINE ?? defaultEnginePath();
  const weightsPath =
    options.weightsPath ?? process.env.GL_WEIGHTS ?? path.join(ROOT, 'ml_handoff', 'model_weights.txt');

  let settings = { seed: 42, controller: 'predictive', demand: 'normal', ...options.settings };
  let speed = options.speed ?? 1;
  let paused = false;
  let status = 'offline'; // 'running' | 'offline'
  let error = null;

  let child = null;
  let partial = ''; // incomplete line carried between stdout chunks
  let pending = []; // complete lines waiting for the clock
  let history = []; // raw JSON lines already sent, newest last
  let latestTime = 0;
  let timer = null;
  let stderrLines = [];

  const clients = new Set();
  let server = null;
  let heartbeat = null;

  // ----- engine process ------------------------------------------------------

  function engineArgs() {
    const args = [RUN_SECONDS, String(settings.seed), '--controller', settings.controller,
      '--demand', settings.demand, '--format', 'jsonl'];
    // The model drives predictive decisions; for fixed/reactive it still
    // produces forecasts for the dashboard's ML panel.
    args.push('--ml-impute-speed', weightsPath);
    return args;
  }

  function startEngine() {
    partial = '';
    pending = [];
    history = [];
    latestTime = 0;
    stderrLines = [];
    error = null;

    if (!fs.existsSync(enginePath)) {
      goOffline(`Engine not found at ${enginePath}. ${BUILD_HINT}`);
      return;
    }

    // No shell: arguments go straight to the process, so nothing is interpreted.
    const proc = spawn(enginePath, engineArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    status = 'running';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      if (proc !== child) return;
      const lines = (partial + chunk).split(/\r?\n/); // Windows writes CRLF
      partial = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          JSON.parse(line);
        } catch {
          stopEngine();
          goOffline(`Engine wrote a line that is not JSON: ${line.slice(0, 120)}`);
          return;
        }
        pending.push(line);
      }
      // Backpressure: stop reading until the clock has drained the queue.
      if (pending.length >= LIMITS.queueHigh) proc.stdout.pause();
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      stderrLines.push(...chunk.split(/\r?\n/).filter((l) => l.trim()));
      stderrLines = stderrLines.slice(-LIMITS.stderrTail);
    });

    proc.on('error', (err) => {
      if (proc !== child) return;
      child = null;
      goOffline(`Could not start the engine: ${err.message}`);
    });

    proc.on('exit', (code, signal) => {
      if (proc !== child) return; // an engine we stopped on purpose
      child = null;
      const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
      const detail = stderrLines.length ? `: ${stderrLines.join(' | ')}` : '';
      goOffline(`Engine ${how}${detail}`);
    });

    broadcastStatus();
    schedule();
  }

  function stopEngine() {
    const proc = child;
    child = null; // its exit is now expected, so the exit handler ignores it
    if (proc && proc.exitCode === null) proc.kill();
    clearTimeout(timer);
    timer = null;
  }

  function goOffline(message) {
    status = 'offline';
    error = message;
    clearTimeout(timer);
    timer = null;
    broadcastStatus();
  }

  // ----- clock ---------------------------------------------------------------

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (paused || status !== 'running') return;
    timer = setTimeout(tick, 1000 / speed);
  }

  function tick() {
    const line = pending.shift();
    if (line !== undefined) {
      history.push(line);
      if (history.length > LIMITS.historySeconds) history.shift();
      latestTime = JSON.parse(line).time_seconds;
      broadcast('snapshot', line);
    }
    if (child && child.stdout.isPaused() && pending.length <= LIMITS.queueLow) child.stdout.resume();
    schedule();
  }

  // ----- clients -------------------------------------------------------------

  function statusPayload() {
    return { status, paused, speed, settings, time: latestTime, error };
  }

  function helloPayload() {
    // History lines are already JSON; splice them in without re-serializing.
    const state = JSON.stringify(statusPayload());
    return `${state.slice(0, -1)},"history":[${history.join(',')}]}`;
  }

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  function broadcast(event, data) {
    for (const res of clients) send(res, event, data);
  }

  function broadcastStatus() {
    broadcast('status', JSON.stringify(statusPayload()));
  }

  // ----- HTTP ----------------------------------------------------------------

  function json(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function handleStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    send(res, 'hello', helloPayload());
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  // Returns an error message, or null if the request is valid (and applies it).
  function applyControl(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
    const allowed = {
      pause: ['action'],
      resume: ['action'],
      speed: ['action', 'value'],
      restart: ['action', 'seed', 'controller', 'demand'],
    }[body.action];
    if (!allowed) return 'action must be pause, resume, speed or restart';
    const extra = Object.keys(body).filter((k) => !allowed.includes(k));
    if (extra.length) return `unexpected field(s) for ${body.action}: ${extra.join(', ')}`;

    if (body.action === 'pause') {
      paused = true;
      schedule();
    } else if (body.action === 'resume') {
      paused = false;
      schedule();
    } else if (body.action === 'speed') {
      const v = body.value;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < LIMITS.minSpeed || v > LIMITS.maxSpeed) {
        return `value must be a number from ${LIMITS.minSpeed} to ${LIMITS.maxSpeed}`;
      }
      speed = v;
      schedule();
    } else {
      const next = { ...settings };
      if ('seed' in body) {
        if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > LIMITS.maxSeed) {
          return `seed must be a whole number from 0 to ${LIMITS.maxSeed}`;
        }
        next.seed = body.seed;
      }
      if ('controller' in body) {
        if (!CONTROLLERS.includes(body.controller)) return `controller must be one of ${CONTROLLERS.join(', ')}`;
        next.controller = body.controller;
      }
      if ('demand' in body) {
        if (!DEMANDS.includes(body.demand)) return `demand must be one of ${DEMANDS.join(', ')}`;
        next.demand = body.demand;
      }
      settings = next;
      stopEngine();
      startEngine();
      broadcast('hello', helloPayload()); // tells clients to drop their old state
    }
    broadcastStatus();
    return null;
  }

  function handleControl(req, res) {
    let raw = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > LIMITS.maxBodyBytes) tooBig = true;
    });
    req.on('end', () => {
      if (tooBig) return json(res, 413, { ok: false, error: 'request body too large' });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(res, 400, { ok: false, error: 'body must be valid JSON' });
      }
      const problem = applyControl(body);
      if (problem) return json(res, 400, { ok: false, error: problem });
      json(res, 200, { ok: true, ...statusPayload() });
    });
  }

  function handleHealth(res) {
    json(res, 200, {
      ...statusPayload(),
      clients: clients.size,
      pid: child ? child.pid : null,
      buffered: pending.length,
      engine: enginePath,
    });
  }

  function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const routes = {
      '/api/stream': ['GET', () => handleStream(req, res)],
      '/api/control': ['POST', () => handleControl(req, res)],
      '/api/health': ['GET', () => handleHealth(res)],
    };
    const match = routes[pathname];
    if (!match) return json(res, 404, { ok: false, error: 'not found' });
    if (req.method !== match[0]) return json(res, 405, { ok: false, error: `use ${match[0]}` });
    match[1]();
  }

  // ----- lifecycle -----------------------------------------------------------

  function start(port = Number(process.env.PORT ?? 8787)) {
    return new Promise((resolve, reject) => {
      server = http.createServer(route);
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        heartbeat = setInterval(() => {
          for (const res of clients) res.write(': ping\n\n');
        }, LIMITS.heartbeatMs);
        heartbeat.unref();
        startEngine();
        resolve({ port: server.address().port });
      });
    });
  }

  function close() {
    stopEngine();
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    clients.clear();
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  return { start, close };
}

// Run directly: node integration/live-server.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const bridge = createBridge();
  const { port } = await bridge.start();
  console.log(`Green Light live bridge on http://127.0.0.1:${port}/api/stream (Ctrl+C to stop)`);
  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Started by another program (frontend/scripts/dev-live.mjs) with a pipe on
  // stdin: that pipe closes when the parent dies, however it dies, so the
  // bridge (and with it the engine) never outlives it.
  if (process.env.GL_EXIT_WITH_PARENT === '1') {
    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);
    process.stdin.resume();
  }
}
