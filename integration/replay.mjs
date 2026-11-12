// Adapter for C++ JSONL replay. React's keys refer to entry approaches.
const approach = { N: 'S', S: 'N', E: 'W', W: 'E' };
const turn = { LEFT: 'L', THROUGH: 'T', RIGHT: 'R' };
const phases = ['NS_LEFT', 'NS_THROUGH_RIGHT', 'EW_LEFT', 'EW_THROUGH_RIGHT'];
const stages = { green: 'G', yellow: 'Y', all_red: 'AR' };

export function parseReplay(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const snapshot = JSON.parse(line);
    if (snapshot.schema_version !== 1) throw new Error('Unsupported Green-Light schema version');
    return snapshot;
  });
}

// Supplies the compatible subset of view fields. This is not a live Simulation.
export function toReplayView(snapshot) {
  const keys = snapshot.movement_order.map(movement => {
    const [direction, kind] = movement.split('_');
    return approach[direction] + turn[kind];
  });
  const byMovement = values => Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  const queues = byMovement(snapshot.queues);
  return {
    T: snapshot.time_seconds,
    sig: {
      phase: phases.indexOf(snapshot.phase),
      stage: stages[snapshot.light_state],
      t: snapshot.phase_elapsed_seconds,
    },
    stats: {
      queues,
      totalQueued: snapshot.queues.reduce((total, count) => total + count, 0),
      completedVehicles: snapshot.throughput,
      meanCompletedWaitSeconds: snapshot.mean_completed_wait_seconds,
    },
    arrivals: byMovement(snapshot.arrivals),
    departures: byMovement(snapshot.departures),
    lights: snapshot.lights && byMovement(snapshot.movement_order.map(movement => snapshot.lights[movement])),
    controllerMode: snapshot.controller_mode,
    decisionSource: snapshot.decision_source,
    modelStatus: snapshot.model_status,
    decision: snapshot.decision,
    forecast: snapshot.forecast && {
      generatedAt: snapshot.forecast.generated_at_seconds,
      horizonSeconds: snapshot.forecast.horizon_seconds,
      speedInput: snapshot.forecast.speed_input,
      arrivals: byMovement(snapshot.forecast.arrivals),
    },
  };
}
