"""Evaluate the frozen Week 4 export; never train or rewrite input artifacts.

Run: python3 -B scripts/04_evaluate_conditions.py
Assertions are integration checks and run before report files are written.
"""
from pathlib import Path
import argparse
import shlex
import sys
import hashlib
import platform

import numpy as np
import pandas as pd
import sklearn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, MinMaxScaler

ROOT = Path(__file__).resolve().parents[1]
MOVEMENTS = [f'{d}_{m}' for d in ('N', 'S', 'E', 'W')
             for m in ('LEFT', 'THROUGH', 'RIGHT')]
FEATURES = [f'{m}_{f}' for m in MOVEMENTS
            for f in ('arr5', 'arr15', 'arr30', 'arr60', 'avg_speed')]
TARGETS = [f'target_{m}' for m in MOVEMENTS]


def load_export(path):
    tokens = np.fromstring(path.read_text(), sep=' ')
    assert np.isfinite(tokens).all(), 'Nonfinite export'
    assert np.array_equal(tokens[:6], [5, 60, 128, 64, 32, 12]), 'Unexpected architecture'
    offset = 6

    def take(n):
        nonlocal offset
        a = tokens[offset:offset + n]
        assert len(a) == n, 'Truncated export'
        offset += n
        return a

    mean, scale, target_min, target_scale = take(60), take(60), take(12), take(12)
    assert (scale > 0).all() and (target_scale > 0).all()
    layers = [(take(i * o).reshape(o, i), take(o))
              for i, o in zip((60, 128, 64, 32), (128, 64, 32, 12))]
    assert offset == len(tokens), 'Unexpected trailing weights'

    def predict(x):
        h = (x - mean) / scale
        for j, (w, b) in enumerate(layers):
            h = h @ w.T + b
            if j < 3:
                h = np.maximum(h, 0)
        return (h - target_min) / target_scale

    return predict, (mean, scale, target_min, target_scale)


def errors(y, p):
    e = p - y
    return float(np.abs(e).mean()), float(np.sqrt(np.square(e).mean()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-version', choices=('250', '680'), default='680')
    parser.add_argument('--dataset', type=Path, default=ROOT / 'data/dataset_60_12.csv')
    parser.add_argument('--artifact-dir', type=Path, default=ROOT / 'ml_handoff')
    parser.add_argument('--checkpoint', type=Path, default=ROOT / 'models/traffic_mlp.pth')
    parser.add_argument('--training-script', type=Path, default=ROOT / 'scripts/03_train_model.py')
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--overwrite', action='store_true', help='Allow replacing existing output reports')
    args = parser.parse_args()
    if not __debug__:
        parser.error('Run without -O: validation assertions must execute')
    expected = {'250': (1.375512, 2.096129, 1.354159, 2.092321),
                '680': (1.303043, 1.870210, 1.215637, 1.807561)}[args.model_version]
    out = (args.output_dir or ROOT / 'reports' / (args.model_version + '_epoch')).resolve()
    outputs = [out / 'week5_ml_evaluation.md', out / 'week5_ml_metrics.csv']
    if not args.overwrite and any(p.exists() for p in outputs):
        parser.error('Output exists; choose a new --output-dir or explicitly use --overwrite')
    paths = [args.dataset, args.artifact_dir / 'model_weights.txt',
             args.artifact_dir / 'test_vectors.csv', args.checkpoint,
             ROOT / 'scripts/02_create_features.py', args.training_script,
             args.artifact_dir / 'ML_INTERFACE.md']
    paths = [p.resolve() for p in paths]
    if set(outputs) & set(paths):
        parser.error('Output would overwrite an input')
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    df = pd.read_csv(paths[0])
    assert list(df.columns) == FEATURES + TARGETS, 'Contract column order mismatch'
    assert df.shape == (182, 72), 'Dataset changed; review evaluation assumptions'
    assert np.isfinite(df.to_numpy()).all()
    x, y = df[FEATURES].to_numpy(), df[TARGETS].to_numpy()
    train, test = train_test_split(np.arange(len(df)), test_size=0.2, random_state=42)
    assert len(train) == 145 and len(test) == 37
    predict, scalers = load_export(paths[1])
    # Refit only for verification; inference always uses the frozen exported scalers.
    sx, sy = StandardScaler().fit(x[train]), MinMaxScaler().fit(y[train])
    for frozen, reconstructed in zip(scalers, (sx.mean_, sx.scale_, sy.min_, sy.scale_)):
        np.testing.assert_allclose(frozen, reconstructed, rtol=1e-8, atol=1e-8)
    vectors = pd.read_csv(paths[2])
    assert list(vectors.columns) == FEATURES + ['pred_' + c for c in TARGETS]
    assert vectors.shape == (5, 72)
    parity = float(np.max(np.abs(predict(vectors[FEATURES].to_numpy()) - vectors.iloc[:, 60:].to_numpy())))
    assert parity < 1e-3, f'Parity failed: {parity}'
    raw = predict(x[test])
    assert raw.shape == (37, 12) and np.isfinite(raw).all()
    raw_metrics = errors(y[test], raw)
    clamped_metrics = errors(y[test], np.maximum(raw, 0))
    np.testing.assert_allclose(raw_metrics + clamped_metrics, expected, rtol=0, atol=1e-6)
    volume = df[[m + '_arr30' for m in MOVEMENTS]].sum(axis=1).to_numpy()
    thresholds = np.quantile(volume[train], [1/3, 2/3])
    groups = np.where(volume[test] <= thresholds[0], 'low',
                      np.where(volume[test] <= thresholds[1], 'medium', 'high'))
    rows = []
    for mode, pred in [('raw', raw), ('cpp_clamped', np.maximum(raw, 0))]:
        for group in ('all', 'low', 'medium', 'high'):
            mask = np.ones(len(test), dtype=bool) if group == 'all' else groups == group
            for movement in ['all'] + MOVEMENTS:
                cols = list(range(12)) if movement == 'all' else [MOVEMENTS.index(movement)]
                actual, estimated = y[test][mask][:, cols], pred[mask][:, cols]
                mae, rmse = errors(actual, estimated) if mask.any() else (np.nan, np.nan)
                rows.append(dict(prediction_mode=mode, volume_group=group, movement=movement,
                                 n_rows=int(mask.sum()), n_values=actual.size, mae=mae, rmse=rmse))
        # Check that disjoint volume groups reconcile to overall metrics.
        subset = [r for r in rows if r['prediction_mode'] == mode and r['movement'] == 'all' and r['volume_group'] != 'all' and r['n_rows']]
        overall = errors(y[test], pred)
        np.testing.assert_allclose(sum(r['mae'] * r['n_values'] for r in subset) / y[test].size, overall[0])
        np.testing.assert_allclose(np.sqrt(sum(r['rmse']**2 * r['n_values'] for r in subset) / y[test].size), overall[1])
    metrics = pd.DataFrame(rows)
    times = 60 + 5 * np.arange(len(df))
    distances = np.abs(times[test, None] - times[train][None, :])
    target_overlap = int((distances.min(axis=1) < 30).sum())
    support_overlap = int((distances.min(axis=1) < 90).sum())
    assert target_overlap == support_overlap == 37
    lines = [f'# Week 5 ML evaluation — {args.model_version}-epoch model', '',
             'Frozen model; real observed dataset rows only. No retraining or synthetic stress tests.', '',
             '## Method', '',
             '182 rows, 60 ordered inputs, 12 targets; 145 training / 37 test rows reconstructed with '
             '`test_size=0.2, random_state=42`. Rows are zero-indexed below.', '',
             'Inference reads the existing exported weights and scalers. Raw outputs match the original '
             'evaluation; C++ outputs clamp negative counts to zero without rounding. Errors are in vehicles '
             'over the next 30 seconds. Overall MAE/RMSE pool all row–movement values.', '',
             f'Volume is the sum of all movements’ historical arr30 inputs. Training-only terciles: '
             f'{thresholds[0]:.6g}, {thresholds[1]:.6g}. Low <= first threshold; medium > first and <= second; '
             'high > second. Ties stay together. Every table row includes observation counts; empty groups have blank errors.', '',
             '## Overall and volume errors', '',
             '| Mode | Volume | Rows | Values | MAE | RMSE |',
             '|---|---|---:|---:|---:|---:|']
    for r in rows:
        if r['movement'] == 'all':
            lines.append(f"| {r['prediction_mode']} | {r['volume_group']} | {r['n_rows']} | {r['n_values']} | {r['mae']:.6f} | {r['rmse']:.6f} |")
    lines += ['', '## Movement errors (all volumes)', '',
              '| Mode | Movement | Rows | Values | MAE | RMSE |', '|---|---|---:|---:|---:|---:|']
    for r in rows:
        if r['volume_group'] == 'all' and r['movement'] != 'all':
            lines.append(f"| {r['prediction_mode']} | {r['movement']} | {r['n_rows']} | {r['n_values']} | {r['mae']:.6f} | {r['rmse']:.6f} |")
    lines += ['', '## Highest errors', '']
    for mode in ('raw', 'cpp_clamped'):
        for label, selection in [('volume', (metrics.movement == 'all') & (metrics.volume_group != 'all')),
                                 ('movement', (metrics.movement != 'all') & (metrics.volume_group == 'all')),
                                 ('movement within volume', (metrics.movement != 'all') & (metrics.volume_group != 'all'))]:
            candidates = metrics[selection & (metrics.prediction_mode == mode) & (metrics.n_rows > 0)]
            for metric in ('mae', 'rmse'):
                r = candidates.loc[candidates[metric].idxmax()]
                lines.append(f'- {mode}, highest {label} {metric.upper()}: {r.volume_group} / {r.movement}, '
                             f'{r[metric]:.6f} ({r.n_rows} rows, {r.n_values} values).')
    lines += ['', '## Temporal overlap and chronological evaluation', '',
              f'All {target_overlap}/37 test rows overlap a training row’s 30-second target window; '
              f'{support_overlap}/37 overlap its full [t−60, t+30) observation support. These are real '
              'random-split held-out rows, but not independent temporal holdouts. Reported accuracy is likely optimistic; '
              'small correlated volume subgroups are descriptive, not evidence of generalization.', '',
              'Feature origins are 60–965 seconds in 5-second steps, as generated by the existing script. '
              'A new last-20% split cannot make this frozen checkpoint chronologically held out: it already trained '
              'on rows from that interval. Cleaned source data has mixed time ranges (including approximately '
              '1.1 billion seconds); later data must undergo timestamp and recording-provenance checks before use. '
              'No chronological accuracy claim is made here. For future training, split in time and separate '
              'training/test prediction origins by at least 90 seconds to avoid shared observation support.', '',
              'Feature semantics are unchanged: arrival counts sum per-five-second-bucket unique vehicle counts; '
              'speed is an average of bucket means, with the generator’s existing missing-value handling. '
              'This report does not repair or reinterpret the dataset.', '',
              '## Validation', '',
              f'- PASS: raw and clamped MAE/RMSE match the {args.model_version}-epoch expectations {expected} within 0.000001; raw actual {raw_metrics[0]:.9f} / {raw_metrics[1]:.9f}; clamped actual {clamped_metrics[0]:.9f} / {clamped_metrics[1]:.9f}.',
              f'- PASS: all five C++ parity vectors; maximum raw absolute difference {parity:.9g} (< 0.001).',
              '- PASS: exported scalers match reconstructed training-only scalers; exact schema, finite values, split sizes, and grouped metric reconciliation.',
              f'- Negative raw predictions clamped: {int((raw < 0).sum())} of {raw.size}.',
              '- C++ executable parity is checked separately using the existing test_mlp.cpp; see execution results accompanying this report.', '',
              '## Reproduction and provenance', '',
              f'`python3 -B scripts/04_evaluate_conditions.py {shlex.join(sys.argv[1:])}` (run from the repository root without Python optimization so assertions execute).', '',
              f'Python {platform.python_version()}; NumPy {np.__version__}; pandas {pd.__version__}; scikit-learn {sklearn.__version__}.', '',
              f'Test row indices (original split order): `{test.tolist()}`.', '',
              'Complete volume × movement metrics, both modes and sample counts, are in `week5_ml_metrics.csv`.', '',
              'Input SHA-256 hashes:', '']
    lines += [f'- `{p}`: `{h}`' for p, h in hashes.items()]
    for p, h in hashes.items():
        assert hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h, f'Input changed: {p}'
    out.mkdir(exist_ok=True)
    metrics.to_csv(out / 'week5_ml_metrics.csv', index=False, float_format='%.10g')
    (out / 'week5_ml_evaluation.md').write_text('\n'.join(lines) + '\n')
    print(metrics[(metrics.movement == 'all')].to_string(index=False))
    print(f'PASS: all validations; parity max difference {parity:.9g}; {len(metrics)} metric rows')


if __name__ == '__main__':
    main()
