// Where the dashboard gets its data. Read once when the app loads; there is
// deliberately no button for it.
//   'engine'   the live C++ engine + ML model through the bridge
//              (run `npm run dev:live`, see integration/live-server.mjs)
//   'browser'  the self-contained JavaScript demo (src/sim/), no engine needed
export const DATA_SOURCE = 'engine';

// Base path of the live bridge. In development Vite forwards it to 127.0.0.1:8787.
export const BRIDGE_URL = '/api';

// The engine's signal timing rules, used by the Controller tab's rule checks.
// The snapshot does not include them, so keep these in sync with SignalPlan's
// defaults in src/engine/TrafficEngine.hpp.
export const ENGINE_RULES = { minGreen: 5, maxGreen: 40, yellow: 3, allRed: 2 };

// Demand presets the engine accepts (`--demand`), shown in the header's Demand menu.
export const ENGINE_DEMANDS = { normal: 'Normal', overloaded: 'Overloaded' };

// Controllers the engine can run (`--controller`), for the Controller tab's engine settings.
export const ENGINE_CONTROLLERS = { predictive: 'Predictive (ML)', reactive: 'Reactive', fixed: 'Fixed timing' };

// The model behind the forecasts, for the ML forecast tab.
export const MODEL_INFO = '680-epoch MLP · 60 → 128 → 64 → 32 → 12';
