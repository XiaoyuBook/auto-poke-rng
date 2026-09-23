"""Export auditable benchmark results, stripping machine-specific paths.

Reads .deps/ocr-eval; writes docs/ocr-benchmark-results.json only with --export.
Metrics never equate synthetic crops with real game accuracy.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('benchmark', Path(__file__).with_name('benchmark-ocr.py'))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def readable_json(value, level=0, key=''):
    """Keep one corpus item/prediction per line while leaving summary metrics readable."""
    encode = lambda item: json.dumps(item, ensure_ascii=False, allow_nan=False)
    padding, child_padding = '  ' * level, '  ' * (level + 1)
    if isinstance(value, dict) and value:
        return '{\n' + ',\n'.join(child_padding + encode(k) + ': ' + readable_json(v, level + 1, k)
                                   for k, v in value.items()) + '\n' + padding + '}'
    if isinstance(value, list) and value and any(isinstance(item, (list, dict)) for item in value):
        return '[\n' + ',\n'.join(child_padding + (readable_json(item, level + 1) if key == 'runs' else encode(item))
                                   for item in value) + '\n' + padding + ']'
    return encode(value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--export', action='store_true')
    args = parser.parse_args()
    report = {'description': 'Synthetic Windows-font OCR screening; not a real-game benchmark.',
              'environment': {'os': 'Windows', 'cpu': 'Intel Core i7-11800H', 'physicalCores': 8, 'logicalCores': 16,
                              'ramGiB': 16, 'ppocrAndEasyocrThreads': 2, 'tesseractWorkers': 1, 'python': '3.12.10', 'rapidocr': '3.9.2',
                              'onnxruntime': '1.30.0', 'openvino': '2026.2.1', 'pillow': '12.3.0', 'numpy': '2.2.6'},
              'metric': 'NFKC plus whitespace removal for normalizedExact/CER; rawExact preserves everything. CER excludes blank negatives.',
              'corpora': {}, 'runs': []}
    for suite in ('screen', 'challenge', 'layout'):
        manifest = benchmark.OUTPUT / suite / 'samples.json'
        if not manifest.exists():
            continue
        corpus = json.loads(manifest.read_text(encoding='utf-8'))
        report['corpora'][suite] = [{k: v for k, v in sample.items() if k not in ('path', 'inputPath')} for sample in corpus]
        paths = sorted((benchmark.OUTPUT / suite).glob('*.json'))
        # The first screening pass used the same corpus/preprocessing with an earlier report schema.
        if suite == 'screen':
            paths += [benchmark.OUTPUT / (name + '-line.json') for name in ('v5-server', 'v6-medium')
                      if not (benchmark.OUTPUT / suite / (name + '-onnxruntime-line.json')).exists()]
        for path in paths:
            if path.name == 'samples.json' or not path.exists():
                continue
            run = json.loads(path.read_text(encoding='utf-8'))
            rows = run['samples']
            expected = {s['id']: s for s in corpus}
            assert len(rows) == len(corpus) and len({r['id'] for r in rows}) == len(corpus), path
            for row in rows:
                assert row['expected'] == expected[row['id']]['expected'], path
                if 'inputSha256' in row:
                    assert row['inputSha256'] == expected[row['id']]['inputSha256'], path
                else:
                    # Verify the original screening inputs too, not just their text labels.
                    original = benchmark.cv2.imread(row['path'])
                    if original.shape[0] < 64:
                        original = benchmark.cv2.resize(original, None, fx=2, fy=2, interpolation=benchmark.cv2.INTER_CUBIC)
                    ok, encoded = benchmark.cv2.imencode('.png', original)
                    assert ok and hashlib.sha256(encoded).hexdigest() == expected[row['id']]['inputSha256'], path
            entry = {k: v for k, v in run.items() if k not in ('samples', 'metrics', 'byLanguage', 'byCondition')}
            if path.parent == benchmark.OUTPUT:
                entry['backend'] = 'onnxruntime'
            entry.update(suite=suite, source=path.relative_to(benchmark.OUTPUT).as_posix(),
                         metrics=benchmark.metrics(rows),
                         textMetrics=benchmark.metrics([r for r in rows if r['expected']]),
                         byLanguage={lang: benchmark.metrics([r for r in rows if r['language'] == lang]) for lang in dict.fromkeys(r['language'] for r in rows)},
                         byCondition={style: benchmark.metrics([r for r in rows if r['condition'] == style]) for style in dict.fromkeys(r['condition'] for r in rows)},
                         predictions=[{k: v for k, v in row.items() if k in ('id', 'actual', 'raw', 'scores', 'confidence', 'ms', 'boxes', 'route')} for row in rows])
            if not run['detection'] and all('raw' in r for r in rows):
                raw_rows = [{**r, 'actual': r['raw'] if isinstance(r['raw'], str) else '\n'.join(r['raw'])} for r in rows]
                entry['unfilteredTextMetrics'] = benchmark.metrics([r for r in raw_rows if r['expected']])
            report['runs'].append(entry)
            m = entry['textMetrics']
            print(f"{entry['source']}: {m['normalizedExact']}/{m['count']}, CER {m['cer']:.4f}, p50 {m['p50Ms']}ms p95 {m['p95Ms']}ms, blank FP {entry['metrics']['blankFalsePositives']}")
    if args.export:
        destination = ROOT / 'docs/ocr-benchmark-results.json'
        destination.parent.mkdir(parents=True, exist_ok=True)
        encoded = readable_json(report) + '\n'
        assert json.loads(encoded) == report
        destination.write_text(encoded, encoding='utf-8')
        print('Exported ' + str(destination))


if __name__ == '__main__':
    main()
