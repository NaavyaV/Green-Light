// What the canvas reads every frame when the data comes from the C++ engine.
// It mirrors the three things drawIntersection uses from the browser
// Simulation: the clock, each movement's light, and the cars to draw.

export class EngineSim {
  constructor() {
    this.T = 0;
    this.lights = null; // { NL: 'green' | 'yellow' | 'red', ... } from the engine, entry-approach keys
  }

  /** Called with the newest snapshot (already converted by the replay adapter). */
  update(view) {
    this.T = view.T;
    this.lights = view.lights ?? null;
  }

  /** 'G' | 'Y' | 'R' for a movement key such as 'NL' or 'ET'. Red until the first snapshot. */
  moveState(mv) {
    const light = this.lights?.[mv];
    return light === 'green' ? 'G' : light === 'yellow' ? 'Y' : 'R';
  }

  /** The engine does not report vehicle positions. Stage D draws queued cars from the counts. */
  allCars() {
    return [];
  }
}
