import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseReplay, toReplayView } from '../integration/replay.mjs';

const [engine, weights] = process.argv.slice(2);
const order = ['N', 'S', 'E', 'W'].flatMap(direction =>
  ['LEFT', 'THROUGH', 'RIGHT'].map(turn => direction + '_' + turn));

function run(args) {
  const result = spawnSync(engine, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

for (const [mode, model] of [
  ['fixed', false], ['reactive', false], ['predictive', false], ['predictive', true],
]) {
  const args = ['120', '42', '--controller', mode];
  if (model) args.push('--ml-impute-speed', weights);
  const output = run([...args, '--format', 'jsonl']);
  const lines = output.trimEnd().split('\n');
  assert.equal(lines.length, 120);
  const rows = parseReplay(output);
  const defaultText = run(args);
  assert.equal(defaultText, run([...args, '--format', 'text']));
  const statuses = defaultText.split('\n').filter(line => line.startsWith('t='));
  const forecasts = defaultText.split('\n').filter(line => line.startsWith('forecast '));
  assert.equal(statuses.length, 120);
  assert.equal(forecasts.length, model ? 13 : 0);
  let previous = Array(12).fill(0);
  let throughput = 0;
  const decisions = new Set();
  rows.forEach((row, i) => {
    const t = i + 1;
    assert.equal(row.time_seconds, t);
    assert.equal(row.controller_mode, mode);
    assert.deepEqual(row.movement_order, order);
    for (const field of ['queues', 'arrivals', 'departures']) {
      assert.equal(row[field].length, 12);
      assert(row[field].every(n => Number.isSafeInteger(n) && n >= 0));
    }
    assert.deepEqual(row.queues, previous.map((n, j) => n + row.arrivals[j] - row.departures[j]));
    previous = row.queues;
    throughput += row.departures.reduce((a, b) => a + b, 0);
    assert.equal(row.throughput, throughput);
    assert(Number.isFinite(row.mean_completed_wait_seconds) && row.mean_completed_wait_seconds >= 0);
    const stage = { green: 'G', yellow: 'Y', all_red: 'AR' }[row.light_state];
    assert(stage);
    assert(Number.isInteger(row.phase_elapsed_seconds) && row.phase_elapsed_seconds > 0);
    assert(statuses[i].startsWith(`t=${t} phase=${row.phase}/${stage}:${row.phase_elapsed_seconds} `));
    assert(statuses[i].includes(` q=[${row.queues.join(',')}] throughput=${throughput} `));
    decisions.add(row.decision_source);
    if (mode !== 'predictive') assert.equal(row.decision_source, null);
    else assert(statuses[i].endsWith(` decision=${row.decision_source}`));
    if (!model || t < 60) {
      assert.equal(row.forecast, null);
      assert.notEqual(row.decision_source, 'predictive_imputed_speed');
    } else {
      assert.equal(row.forecast.generated_at_seconds, t - t % 5);
      assert.equal(row.forecast.horizon_seconds, 30);
      assert.equal(row.forecast.speed_input, 'imputed_training_mean');
      assert.equal(row.forecast.arrivals.length, 12);
      assert(row.forecast.arrivals.every(n => Number.isFinite(n) && n >= 0));
      if (t % 5) assert.deepEqual(row.forecast, rows[i - 1].forecast);
    }
    const view = toReplayView(row);
    assert.equal(view.stats.queues.SL, row.queues[0]);
    assert.equal(view.stats.queues.NT, row.queues[4]);
    assert.equal(view.stats.queues.WR, row.queues[8]);
    assert.equal(view.stats.queues.EL, row.queues[9]);
    assert.equal(view.stats.completedVehicles, throughput);
    assert(view.sig.phase >= 0);
    assert.equal(view.sig.stage, stage);
    if (row.forecast) assert.equal(view.forecast.arrivals.SL, row.forecast.arrivals[0]);
  });
  if (mode === 'predictive') {
    assert(decisions.has('reactive_fallback'));
    assert(decisions.has('safety_timing'));
    assert.equal(decisions.has('predictive_imputed_speed'), model);
  }
}
assert.equal(run(['0', '--format', 'jsonl']), '');
const invalid = spawnSync(engine, ['1', '--format', 'invalid'], { encoding: 'utf8' });
assert.equal(invalid.status, 1);
assert.equal(invalid.stdout, '');
assert.match(invalid.stderr, /format must be text or jsonl/);
assert.throws(() => parseReplay('{"schema_version":2}'), /Unsupported/);
