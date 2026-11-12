// What the canvas reads every frame when the data comes from the C++ engine.
// It mirrors what drawIntersection uses from the browser Simulation: the
// clock, each movement's light, and the cars to draw.
//
// The engine reports queue counts, arrivals and departures, not vehicle
// positions. The engine's queues are first in, first out, so this keeps an
// ordered list of cars per lane that matches those counts exactly:
//   - arrivals join the back of their lane (they drive in from the edge),
//   - departures leave from the front of their movement (they drive off),
//   - the count of every movement always equals the engine's queue.
// Positions and motion are only an animation of those real counts.

import { APPROACHES, CAR, GAP, STOP } from '../sim/constants.js';
import { ROUTES } from '../sim/geometry.js';
import { CAR_COLORS } from '../sim/engine.js';

const SLOT = CAR + GAP; // spacing of stopped cars
const FRONT = STOP - 2; // where the first car in a lane stops
export const LANE_SLOTS = 10; // cars that fit on screen per lane; more becomes a "+N" label
// A departing car must be faster than the car closing up behind it, or the
// follower catches up and the two overlap.
const QUEUE_SPEED = 100; // px per second while closing up or driving in
const DEPART_SPEED = 120; // px per second through the intersection
const MOVING = 60; // speed value given to moving cars (only used for brake lights)

// Left turns use the left lane; through and right share the right lane.
const laneOf = (mv) => mv[0] + (mv[1] === 'L' ? 'L' : 'T');
const LANES = APPROACHES.flatMap((a) => [a + 'L', a + 'T']);

export class EngineSim {
  constructor() {
    this.T = 0;
    this.lights = null; // { NL: 'green' | 'yellow' | 'red', ... }, entry-approach keys
    this.speed = 1; // playback speed, so animations keep pace at 2x and 4x
    this.lanes = Object.fromEntries(LANES.map((k) => [k, []])); // front first
    this.departing = [];
    this.nextId = 0;
    this.lastT = null;
    this.lastFrame = null;
  }

  /** Called with each new snapshot, already converted by the replay adapter. */
  update(view) {
    this.lights = view.lights ?? null;
    const consecutive = this.lastT !== null && view.T === this.lastT + 1;
    if (consecutive) {
      // Same order as the engine within a second: arrivals join, then departures leave.
      for (const mv in view.arrivals) {
        for (let i = 0; i < view.arrivals[mv]; i++) {
          // Enter at the map edge, or one car length behind a car still
          // entering (two movements can arrive in one lane in the same second).
          // Negative positions are just off the map.
          const lane = this.lanes[laneOf(mv)];
          const last = lane[lane.length - 1];
          lane.push(this.newCar(mv, last ? Math.min(0, last.s - SLOT) : 0));
        }
      }
      for (const mv in view.departures) {
        for (let i = 0; i < view.departures[mv]; i++) this.depart(mv);
      }
    } else {
      // First snapshot, a restart, or a gap: rebuild the lanes from the counts.
      for (const k of LANES) this.lanes[k] = [];
      this.departing = [];
    }
    this.reconcile(view.stats.queues, !consecutive);
    this.T = view.T;
    this.lastT = view.T;
  }

  newCar(mv, s) {
    this.nextId += 1;
    const id = this.nextId;
    return {
      id, mv, a: mv[0], m: mv[1], route: ROUTES[mv], s, v: MOVING, crossed: false,
      color: CAR_COLORS[(id * 7) % CAR_COLORS.length], blink: (id * 1.7) % 6,
    };
  }

  depart(mv) {
    const lane = this.lanes[laneOf(mv)];
    const i = lane.findIndex((c) => c.mv === mv);
    if (i === -1) return;
    // Through and right turns share one drawn lane, but the engine queues and
    // serves them separately (both are green together). A released car may
    // therefore sit behind cars of the other movement. Physically only the
    // front car can pull away, so the front car leaves with the released
    // movement and the released car takes over the front car's movement.
    // Every movement's count still matches the engine exactly.
    if (i > 0) {
      const front = lane[0];
      const released = lane[i];
      [front.mv, released.mv] = [released.mv, front.mv];
      [front.m, released.m] = [released.m, front.m];
      [front.route, released.route] = [released.route, front.route];
    }
    const [car] = lane.splice(0, 1);
    // It keeps going from wherever it is: a car that arrives on an empty lane
    // and is served the same second simply drives straight through.
    car.crossed = true;
    this.departing.push(car);
  }

  // Make every movement's count equal the engine's queue (it always should
  // after a consecutive update; after a rebuild this fills the lanes).
  reconcile(queues, placeAtTarget) {
    for (const mv in queues) {
      const lane = this.lanes[laneOf(mv)];
      let have = lane.filter((c) => c.mv === mv).length;
      while (have < queues[mv]) {
        lane.push(this.newCar(mv, 0));
        have += 1;
      }
      while (have > queues[mv]) {
        lane.splice(lane.findLastIndex((c) => c.mv === mv), 1);
        have -= 1;
      }
    }
    if (placeAtTarget) {
      for (const k of LANES) this.lanes[k].forEach((c, i) => { c.s = Math.max(0, FRONT - i * SLOT); c.v = 0; });
    }
  }

  /** 'G' | 'Y' | 'R' for a movement key such as 'NL' or 'ET'. Red until the first snapshot. */
  moveState(mv) {
    const light = this.lights?.[mv];
    return light === 'green' ? 'G' : light === 'yellow' ? 'Y' : 'R';
  }

  /** Cars to draw this frame, advancing the animation. */
  allCars(now = performance.now()) {
    const dt = this.lastFrame === null ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000) * this.speed;
    this.lastFrame = now;
    const out = [];
    for (const k of LANES) {
      const lane = this.lanes[k];
      const shown = lane.length > LANE_SLOTS ? LANE_SLOTS - 1 : LANE_SLOTS; // leave room for the label
      lane.forEach((c, i) => {
        const target = Math.max(0, FRONT - i * SLOT);
        if (c.s < target) {
          c.s = Math.min(target, c.s + QUEUE_SPEED * dt);
          c.v = c.s < target ? MOVING : 0;
        } else {
          c.s = target;
          c.v = 0;
        }
        if (i < shown && c.s >= 0) out.push(c); // not yet on the map: not drawn
      });
    }
    this.departing = this.departing.filter((c) => {
      c.s += DEPART_SPEED * dt;
      c.v = MOVING;
      return c.s < c.route.len;
    });
    out.push(...this.departing);
    return out;
  }

  /** Lanes with more cars than fit on screen: [{ lane: 'NT', hidden: 7 }]. */
  laneLabels() {
    const out = [];
    for (const k of LANES) {
      const n = this.lanes[k].length;
      if (n > LANE_SLOTS) out.push({ lane: k, hidden: n - (LANE_SLOTS - 1) });
    }
    return out;
  }

  /** Total cars waiting, for checks: always equals the engine's total queue. */
  queuedCount() {
    return LANES.reduce((s, k) => s + this.lanes[k].length, 0);
  }
}
