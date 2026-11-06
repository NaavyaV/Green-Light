// Tests for the live bridge, run against the real C++ engine.
//   node --test integration/live-server.test.mjs
// Needs a built engine at build/green_light[.exe] (or GL_ENGINE).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createBridge, defaultEnginePath, LIMITS } from './live-server.mjs';

const ENGINE = process.env.GL_ENGINE ?? defaultEnginePath();
const SPEED = 20; // 50 ms per simulated second keeps the tests short

let bridge;
let base;

before(async () => {
  assert.ok(fs.existsSync(ENGINE), `Engine not built at ${ENGINE}; build it before running these tests.`);
  bridge = createBridge({ enginePath: ENGINE, speed: SPEED });
  const { port } = await bridge.start(0);
  base = `http://127.0.0.1:${port}`;
});

after(() => bridge.close());

// ----- helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch(base + path);
  return { code: res.status, body: await res.json() };
}

async function control(body) {
  const res = await fetch(base + '/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { code: res.status, body: await res.json() };
}

// Minimal SSE client: collects events and lets a test wait for the next match.
function connect() {
  const events = [];
  const waiters = [];
  let buffer = '';
  const req = http.get(base + '/api/stream', (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!type) continue; // heartbeat comment
        const event = { type, data: JSON.parse(data), raw: data, at: Date.now() };
        events.push(event);
        for (const w of [...waiters]) {
          if (w.match(event)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(event);
          }
        }
      }
    });
  });
  req.on('error', () => {});
  return {
    events,
    snapshots: () => events.filter((e) => e.type === 'snapshot'),
    next(match, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
        waiters.push({ match, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    },
    close: () => req.destroy(),
  };
}

const isSnapshot = (e) => e.type === 'snapshot';

async function collectSnapshots(client, count) {
  const out = [];
  while (out.length < count) out.push(await client.next(isSnapshot));
  return out;
}

async function waitForRunning() {
  for (let i = 0; i < 50; i++) {
    const { body } = await getJson('/api/health');
    if (body.status === 'running' && body.time > 0) return body;
    await sleep(100);
  }
  throw new Error('bridge never reported running');
}

// ----- tests -----------------------------------------------------------------

test('health reports a running engine with the default settings', async () => {
  const body = await waitForRunning();
  assert.equal(body.status, 'running');
  assert.equal(typeof body.pid, 'number');
  assert.deepEqual(body.settings, { seed: 42, controller: 'predictive', demand: 'normal' });
  assert.equal(body.error, null);
});

test('a client gets hello, then snapshots one simulated second apart at the set speed', async () => {
  const client = connect();
  const hello = await client.next((e) => e.type === 'hello');
  assert.equal(hello.data.status, 'running');
  assert.ok(Array.isArray(hello.data.history));

  const snaps = await collectSnapshots(client, 20);
  for (let i = 1; i < snaps.length; i++) {
    assert.equal(snaps[i].data.time_seconds, snaps[i - 1].data.time_seconds + 1);
  }
  for (const s of snaps) {
    assert.equal(s.data.schema_version, 1);
    assert.equal(s.data.controller_mode, 'predictive');
  }
  // 19 intervals at 50 ms is about 950 ms; allow for timer jitter.
  const elapsed = snaps.at(-1).at - snaps[0].at;
  assert.ok(elapsed > 600 && elapsed < 2500, `20 snapshots took ${elapsed} ms`);
  client.close();
});

test('hello history is the most recent snapshots, consecutive and capped', async () => {
  await sleep(500);
  const client = connect();
  const hello = await client.next((e) => e.type === 'hello');
  const times = hello.data.history.map((s) => s.time_seconds);
  assert.ok(times.length > 0 && times.length <= LIMITS.historySeconds);
  for (let i = 1; i < times.length; i++) assert.equal(times[i], times[i - 1] + 1);
  assert.equal(times.at(-1), hello.data.time);
  client.close();
});

test('backpressure keeps the bridge buffer small while the engine could run far ahead', async () => {
  await sleep(1500);
  const { body } = await getJson('/api/health');
  // Without backpressure the engine would have produced tens of thousands of lines by now.
  assert.ok(body.buffered < 200, `buffered ${body.buffered} lines`);
});

test('pause stops snapshots and resume continues from the next second', async () => {
  const client = connect();
  await client.next(isSnapshot);
  assert.equal((await control({ action: 'pause' })).code, 200);
  await sleep(200); // let anything already in flight arrive
  const before = client.snapshots().length;
  const lastTime = client.snapshots().at(-1).data.time_seconds;
  await sleep(1500);
  assert.equal(client.snapshots().length, before, 'snapshots arrived while paused');
  assert.equal((await getJson('/api/health')).body.paused, true);

  assert.equal((await control({ action: 'resume' })).code, 200);
  const next = await client.next(isSnapshot);
  assert.equal(next.data.time_seconds, lastTime + 1);
  client.close();
});

test('speed changes the snapshot rate', async () => {
  const client = connect();
  await control({ action: 'speed', value: 5 }); // 200 ms per second
  await client.next(isSnapshot);
  const snaps = await collectSnapshots(client, 4);
  const elapsed = snaps.at(-1).at - snaps[0].at; // 3 intervals of about 200 ms
  assert.ok(elapsed > 450 && elapsed < 1500, `3 intervals took ${elapsed} ms at speed 5`);
  await control({ action: 'speed', value: SPEED });
  client.close();
});

test('two clients receive identical snapshots', async () => {
  const a = connect();
  const b = connect();
  await a.next((e) => e.type === 'hello');
  await b.next((e) => e.type === 'hello');
  const first = await a.next(isSnapshot);
  const target = first.data.time_seconds + 5;
  const [sa, sb] = await Promise.all([
    a.next((e) => isSnapshot(e) && e.data.time_seconds === target),
    b.next((e) => isSnapshot(e) && e.data.time_seconds === target),
  ]);
  assert.equal(sa.raw, sb.raw);
  a.close();
  b.close();
});

test('invalid control requests are rejected and change nothing', async () => {
  const before = (await getJson('/api/health')).body;
  const bad = [
    { action: 'explode' },
    { action: 'speed', value: 0 },
    { action: 'speed', value: 100 },
    { action: 'speed', value: '2' },
    { action: 'restart', controller: 'evil' },
    { action: 'restart', demand: 'rush' },
    { action: 'restart', seed: -1 },
    { action: 'restart', seed: 1.5 },
    { action: 'restart', seed: 4294967296 },
    { action: 'pause', extra: true },
    [],
    'not json',
  ];
  for (const body of bad) {
    const res = await control(body);
    assert.equal(res.code, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error);
  }
  const after = (await getJson('/api/health')).body;
  assert.equal(after.pid, before.pid, 'engine was restarted by a bad request');
  assert.deepEqual(after.settings, before.settings);
  assert.equal(after.speed, before.speed);
});

test('wrong routes and methods are refused', async () => {
  assert.equal((await getJson('/api/nope')).code, 404);
  assert.equal((await fetch(base + '/api/control')).status, 405);
  assert.equal((await fetch(base + '/api/health', { method: 'POST' })).status, 405);
});

test('restart applies new settings and starts again from second 1', async () => {
  const client = connect();
  await client.next((e) => e.type === 'hello');
  const res = await control({ action: 'restart', seed: 7, controller: 'fixed', demand: 'overloaded' });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.settings, { seed: 7, controller: 'fixed', demand: 'overloaded' });

  const hello = await client.next((e) => e.type === 'hello');
  assert.equal(hello.data.history.length, 0);
  assert.equal(hello.data.settings.seed, 7);
  const snap = await client.next(isSnapshot);
  assert.equal(snap.data.time_seconds, 1);
  assert.equal(snap.data.controller_mode, 'fixed');

  await control({ action: 'restart', seed: 42, controller: 'predictive', demand: 'normal' });
  client.close();
});

test('the model warms up, then the forecast appears in the stream', async () => {
  const client = connect();
  await client.next((e) => e.type === 'hello');
  const early = await client.next(isSnapshot);
  if (early.data.time_seconds < 60) assert.equal(early.data.model_status, 'warming_up');
  const ready = await client.next((e) => isSnapshot(e) && e.data.time_seconds >= 60, 10000);
  assert.equal(ready.data.model_status, 'ready');
  assert.equal(ready.data.forecast.arrivals.length, 12);
  assert.ok(ready.data.forecast.arrivals.every((v) => Number.isFinite(v) && v >= 0));
  client.close();
});

test('if the engine dies, clients are told it is offline, and restart recovers', async () => {
  const client = connect();
  await client.next((e) => e.type === 'hello');
  const { pid } = (await getJson('/api/health')).body;
  process.kill(pid);
  const offline = await client.next((e) => e.type === 'status' && e.data.status === 'offline');
  assert.match(offline.data.error, /Engine (exited|was stopped)/);
  assert.equal((await getJson('/api/health')).body.pid, null);

  await control({ action: 'restart' });
  const back = await waitForRunning();
  assert.notEqual(back.pid, pid);
  client.close();
});

test('a missing engine reports offline with a build hint instead of crashing', async () => {
  const lost = createBridge({ enginePath: 'definitely/not/here/green_light.exe' });
  const { port } = await lost.start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    assert.equal(body.status, 'offline');
    assert.match(body.error, /Engine not found/);
    assert.match(body.error, /cmake/);
  } finally {
    await lost.close();
  }
});
