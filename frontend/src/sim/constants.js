// Shared constants for the simulation, the stand-in ML model and the stand-in controller.

/** Signal timing rules and vehicle physics. Times in seconds, distances in world units (px). */
export const CFG = {
  MIN: 7, // min green
  MAX: 40, // max green
  YEL: 3, // yellow
  AR: 1.5, // all-red clearance
  STARVE: 80, // starvation guard: max wait for a phase that has demand
  VMAX: 62, // cruise speed
  ACC: 40,
  DEC: 70,
  REACT: 0.45, // driver reaction delay when the car ahead pulls away
  SAT_T: 1.35, // saturation flow, through/right lane (veh/s)
  SAT_L: 1.1, // saturation flow, left lane (veh/s)
};

export const FORECAST_EVERY = 5; // seconds between model runs
export const HORIZON = 30; // forecast horizon, seconds
export const FORECAST_STEPS = HORIZON / FORECAST_EVERY; // 6

// World geometry (the canvas draws a 640x640 world)
export const WORLD = 640;
export const C = 320; // centre of the intersection
export const H = 48; // half road width (2 lanes each way, 24 wide)
export const D = 340; // distance from centre to spawn point
export const CAR = 18; // car length
export const GAP = 6; // gap between stopped cars
export const STOP = D - H - 22; // distance along a route to the stop line

export const APPROACHES = ['N', 'S', 'E', 'W'];
export const MOVES = ['L', 'T', 'R'];
export const AP_NAME = { N: 'North', S: 'South', E: 'East', W: 'West' };

/** Unit vector each approach's traffic travels in (canvas y points down). */
export const FWD = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] };

/** Movement keys are approach + move, e.g. 'NL' = from the north, turning left. */
export const PHASES = [
  { id: 0, name: 'N/S Left', moves: ['NL', 'SL'] },
  { id: 1, name: 'N/S Through', moves: ['NT', 'NR', 'ST', 'SR'] },
  { id: 2, name: 'E/W Left', moves: ['EL', 'WL'] },
  { id: 3, name: 'E/W Through', moves: ['ET', 'ER', 'WT', 'WR'] },
];

export const INTERSECTIONS = [
  { name: 'Campbell Rd & Synergy Pkwy', ns: 'Synergy Pkwy', ew: 'Campbell Rd', scenario: 'balanced' },
  { name: 'Coit Rd & Campbell Rd', ns: 'Coit Rd', ew: 'Campbell Rd', scenario: 'ns' },
  { name: 'Renner Rd & Waterview Pkwy', ns: 'Waterview Pkwy', ew: 'Renner Rd', scenario: 'ew' },
];

/** Demand per approach in vehicles per minute. */
export const SCENARIOS = {
  balanced: { label: 'Balanced', rates: { N: 14, S: 13, E: 12, W: 12 } },
  ns: { label: 'Rush hour N/S', rates: { N: 27, S: 24, E: 8, W: 9 } },
  ew: { label: 'Event surge E/W', rates: { N: 9, S: 8, E: 25, W: 27 } },
};

export const TURN_SPLIT = { L: 0.22, T: 0.63, R: 0.15 };
export const DEMAND_WAVE_OFFSET = { N: 0, S: 1.7, E: 3.1, W: 4.4 };

/** CSS token per approach for chart series (validated categorical palette). */
export const SERIES_TOKEN = { N: '--s1', S: '--s2', E: '--s3', W: '--s4' };
