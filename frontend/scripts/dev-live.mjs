// npm run dev:live — starts the live bridge (which starts the C++ engine) and
// the Vite dev server together.
//
// Vite runs inside this process; the bridge is its only child. The bridge is
// given a pipe on stdin and exits when that pipe closes, so killing this
// process any way at all (Ctrl+C, closing the terminal, a crash) also stops
// the bridge, and the engine exits when the bridge does.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const bridgeScript = path.resolve(frontend, '..', 'integration', 'live-server.mjs');

const bridge = spawn(process.execPath, [bridgeScript], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, GL_EXIT_WITH_PARENT: '1' },
});

const vite = await createServer({ root: frontend, configFile: path.join(frontend, 'vite.config.js') });
await vite.listen();
vite.printUrls();

let stopping = false;
async function stopAll(code) {
  if (stopping) return;
  stopping = true;
  if (bridge.exitCode === null) bridge.kill();
  await vite.close();
  process.exit(code);
}

bridge.on('exit', (code) => {
  if (!stopping) console.error(`bridge exited (code ${code}); stopping Vite.`);
  stopAll(code ?? 1);
});
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
