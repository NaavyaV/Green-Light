import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Live mode: forward /api to the bridge (integration/live-server.mjs).
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // Allow importing the engine's adapter from ../integration/.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../integration', import.meta.url))] },
  },
});
