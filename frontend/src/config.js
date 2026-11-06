// Where the dashboard gets its data. Read once when the app loads; there is
// deliberately no button for it.
//   'browser'  the self-contained JavaScript demo (src/sim/)
//   'engine'   the live C++ engine + ML model through the bridge
//              (run `npm run dev:live`, see integration/live-server.mjs)
export const DATA_SOURCE = 'browser';

// Base path of the live bridge. In development Vite forwards it to 127.0.0.1:8787.
export const BRIDGE_URL = '/api';
