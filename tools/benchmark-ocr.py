"""Reproducible CPU OCR screening. Synthetic UI crops, NOT a game accuracy benchmark.

Run with .deps/script-python/Scripts/python.exe tools/benchmark-ocr.py.
Models and generated data stay in .deps/ocr-eval; results include every prediction.
"""
import argparse
import gc
import hashlib
import io
import json
import os
from pathlib import Path
import statistics
import sys
import time
import unicodedata
import urllib.request

os.environ.setdefault('OMP_NUM_THREADS', '2')
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import rapidocr
from rapidocr import RapidOCR, ModelType, OCRVersion, EngineType, LangRec
import yaml

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.deps/ocr-eval'
CATALOG = yaml.safe_load((Path(rapidocr.__file__).parent / 'default_models.yaml').read_text(encoding='utf-8'))['onnxruntime']
CANDIDATES = {
    'v5-mobile': ('PP-OCRv5', 'mobile', 'ch_PP-OCRv5_rec_mobile'),
    'v5-server': ('PP-OCRv5', 'server', 'ch_PP-OCRv5_rec_server'),
    'v6-tiny': ('PP-OCRv6', 'tiny', 'PP-OCRv6_rec_tiny'),
    'v6-small': ('PP-OCRv6', 'small', 'PP-OCRv6_rec_small'),
    'v6-medium': ('PP-OCRv6', 'medium', 'PP-OCRv6_rec_medium'),
    'v4-japan': ('PP-OCRv4', 'mobile', 'japan_PP-OCRv4_rec_mobile'),
}
TEXTS = {
    'zh': ['皮卡丘的特性是静电', '速度 123 攻击 204', '是否保存当前进度？', '寶可夢的能力與個性'],
    'ja': ['ピカチュウのとくせい', 'こうげき 123 すばやさ 204', 'ぼうけんを きろくしますか？', '性格：ようき 特性：せいでんき'],
    'en': ['Pikachu Lv. 50', 'Ability: Static', 'Save your progress?', 'HP 123/204 +10%'],
    'digits': ['0123456789', '123/204', '001234 567890', '29.97 60.00'],
}

def download(version, role, name):
    entry = CATALOG[version][role][('multi_' if version == 'PP-OCRv6' else '') + name]
    target = OUTPUT / 'models' / (name + '.onnx')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        with target.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() == entry['SHA256']:
                return target
    print('Download ' + name, flush=True)
    temporary = target.with_suffix('.download')
    with urllib.request.urlopen(entry['model_dir'], timeout=60) as response, temporary.open('wb') as stream:
        while chunk := response.read(1024 * 1024):
            stream.write(chunk)
    with temporary.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['SHA256']:
            raise RuntimeError('SHA-256 mismatch: ' + name)
    temporary.replace(target)
    return target

def samples(suite='screen'):
    if suite == 'layout':
        return layout_samples()
    folder = OUTPUT / suite / 'samples'
    folder.mkdir(parents=True, exist_ok=True)
    result = []
    texts_by_lang = TEXTS if suite == 'screen' else {
        'zh': ['妙蛙种子 叶绿素', '特攻 31 特防 0', '胆小、固执、悠闲', '命中率100% 回避率',
               '剩余次数：０１／２０', '閃光寶可夢 訓練家', '這隻寶可夢的個體值', '继续游戏／返回标题'],
        'ja': ['フシギダネ ようりょくそ', 'ミュウツー プレッシャー', 'がんばりや・いじっぱり', 'おくびょう／のんき',
               'つぎのレベルまで １２３４', 'けいけんち 987654', 'セーブして 終了しますか？', '♂ Lv.100 ♀ HP 321/321'],
        'en': ['Bulbasaur Chlorophyll', 'Mewtwo Pressure', 'Sp. Atk 31 / Sp. Def 0', 'Timid Adamant Relaxed',
               'EXP. Points 987654', 'Next Lv. 1234', 'Continue / New Game', 'ID No. 000123'],
        'digits': ['000000 111111', '888888 666666', '0123456789', '999/999', '0.001 29.97', '31 0 31 31 31 31', '+10% -25%', '2026/09/23'],
    }
    styles = [('light24', 24, False), ('dark18', 18, True), ('small12', 12, True), ('jpeg18', 18, False)] if suite == 'screen' else [
        ('alternate18', 18, False), ('outline18', 18, True), ('pixel12', 12, False), ('lowcontrast16', 16, True)]
    for lang, texts in texts_by_lang.items():
        for i, text in enumerate(texts):
            for style, size, dark in styles:
                font_file = ('msgothic.ttc' if lang == 'ja' else 'simhei.ttf' if lang == 'zh' else 'consola.ttf') if style in ('alternate18', 'pixel12') else ('meiryo.ttc' if lang == 'ja' else 'msyh.ttc' if lang == 'zh' else 'arial.ttf')
                font_path = 'C:/Windows/Fonts/' + font_file
                font = ImageFont.truetype(font_path, size)
                left, top, right, bottom = font.getbbox(text)
                image = Image.new('RGB', (right-left+16, bottom-top+12), '#495b60' if style == 'outline18' else '#182331' if dark else '#f3f0e5')
                ImageDraw.Draw(image).text((8-left, 6-top), text, font=font, fill='#657381' if style == 'lowcontrast16' else '#f6f8fa' if dark else '#243040', stroke_width=1 if style == 'outline18' else 0, stroke_fill='#152030')
                if style == 'pixel12':
                    image = image.resize((image.width*2, image.height*2), Image.Resampling.NEAREST)
                if style == 'jpeg18':
                    image = image.filter(ImageFilter.GaussianBlur(0.45))
                    buffer = io.BytesIO()
                    image.save(buffer, format='JPEG', quality=65)
                    image = Image.open(io.BytesIO(buffer.getvalue())).convert('RGB')
                path = folder / f'{lang}-{i}-{style}.png'
                image.save(path)
                with open(font_path, 'rb') as stream:
                    font_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
                result.append({'id': path.stem, 'path': str(path), 'language': lang, 'condition': style, 'expected': text, 'font': font_file, 'fontSha256': font_hash})
    for color in ['white', '#182331']:
        path = folder / ('blank-' + color.replace('#', '') + '.png')
        Image.new('RGB', (240, 40), color).save(path)
        result.append({'id': path.stem, 'path': str(path), 'language': 'blank', 'condition': 'blank', 'expected': ''})
    for sample in result:
        im = cv2.imread(sample['path'])
        if im.shape[0] < 64:
            im = cv2.resize(im, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        sample['inputPath'] = str(folder / (sample['id'] + '-input.png'))
        cv2.imwrite(sample['inputPath'], im)
        with Path(sample['inputPath']).open('rb') as stream:
            sample['inputSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    (OUTPUT / suite / 'samples.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


def layout_samples():
    folder = OUTPUT / 'layout/samples'
    folder.mkdir(parents=True, exist_ok=True)
    result = []
    for lang, texts in TEXTS.items():
        font_file = 'meiryo.ttc' if lang == 'ja' else 'msyh.ttc' if lang == 'zh' else 'arial.ttf'
        font_path = Path('C:/Windows/Fonts') / font_file
        for style, size, dark in [('light24', 24, False), ('dark18', 18, True), ('small12', 12, True)]:
            font = ImageFont.truetype(str(font_path), size)
            im = Image.new('RGB', (640, 220), '#182331' if dark else '#f3f0e5')
            draw = ImageDraw.Draw(im)
            boxes = []
            for i, text in enumerate(texts[:3]):
                left, top, right, bottom = font.getbbox(text)
                x, y = 30, 30 + i*55
                draw.text((x-left, y-top), text, font=font, fill='#f6f8fa' if dark else '#243040')
                boxes.append([x, y, right-left, bottom-top])
            path = folder / (lang + '-' + style + '.png')
            im.save(path)
            result.append({'id': path.stem, 'path': str(path), 'inputPath': str(path), 'language': lang,
                           'condition': style, 'expected': '\n'.join(texts[:3]), 'expectedBoxes': boxes,
                           'font': font_file, 'fontSha256': hashlib.sha256(font_path.read_bytes()).hexdigest()})
    rng = np.random.default_rng(20260923)
    for i in range(6):
        im = Image.new('RGB', (640, 220), '#182331' if i % 2 else '#f3f0e5')
        if i >= 2:
            draw = ImageDraw.Draw(im)
            for _ in range(30):
                x, y = int(rng.integers(0, 600)), int(rng.integers(0, 180))
                color = tuple(int(n) for n in rng.integers(35, 210, size=3))
                draw.ellipse((x, y, x+30, y+30), fill=color)
            if i >= 4:
                im = im.filter(ImageFilter.GaussianBlur(3))
        path = folder / f'negative-{i}.png'
        im.save(path)
        result.append({'id': path.stem, 'path': str(path), 'inputPath': str(path), 'language': 'blank', 'condition': 'negative', 'expected': ''})
    for sample in result:
        sample['inputSha256'] = hashlib.sha256(Path(sample['inputPath']).read_bytes()).hexdigest()
    (OUTPUT / 'layout/samples.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result

def normalized(text):
    return ''.join(unicodedata.normalize('NFKC', text).split())

def distance(a, b):
    row = list(range(len(b)+1))
    for i, ca in enumerate(a, 1):
        next_row = [i]
        for j, cb in enumerate(b, 1):
            next_row.append(min(next_row[-1]+1, row[j]+1, row[j-1]+(ca != cb)))
        row = next_row
    return row[-1]

def metrics(rows):
    characters = sum(len(normalized(r['expected'])) for r in rows)
    return {'count': len(rows), 'exact': sum(r['actual'] == r['expected'] for r in rows),
            'normalizedExact': sum(normalized(r['actual']) == normalized(r['expected']) for r in rows),
            'cer': round(sum(distance(normalized(r['expected']), normalized(r['actual'])) for r in rows if r['expected']) / characters, 4) if characters else None,
            'blankFalsePositives': sum(bool(r['actual']) for r in rows if not r['expected']),
            'p50Ms': round(statistics.median(r['ms'] for r in rows), 2),
            'p95Ms': round(float(np.percentile([r['ms'] for r in rows], 95)), 2)}

def evaluate(name, data, detection=False, suite='screen', backend='onnxruntime'):
    version, model_type, rec_name = CANDIDATES[name]
    rec = download(version, 'rec', rec_name)
    det_name = f'PP-OCRv6_det_{model_type}' if version == 'PP-OCRv6' else 'ch_PP-OCRv5_det_mobile'
    det_version = 'PP-OCRv6' if version == 'PP-OCRv6' else 'PP-OCRv5'
    det = download(det_version, 'det', det_name)
    cls = download('PP-OCRv4', 'cls', 'ch_ppocr_mobile_v2.0_cls_mobile')
    print(f'Initialize {name}', flush=True)
    start = time.perf_counter()
    engine = RapidOCR(params={
        'Det.model_path': str(det), 'Rec.model_path': str(rec), 'Cls.model_path': str(cls),
        'Rec.ocr_version': OCRVersion(version), 'Rec.model_type': ModelType(model_type),
        'Rec.lang_type': LangRec.JAPAN if name == 'v4-japan' else LangRec.CH,
        'Det.ocr_version': OCRVersion(det_version), 'Det.model_type': ModelType(model_type if version == 'PP-OCRv6' else 'mobile'),
        # Official inference.yml normalization and DB thresholds, with a bounded ROI budget.
        # RapidOCR 3.9.2 defaults upscale the short side to 736, wasting work on narrow rows.
        'Det.mean': [0.485, 0.456, 0.406], 'Det.std': [0.229, 0.224, 0.225],
        'Det.limit_type': 'max', 'Det.limit_side_len': 960,
        'Det.thresh': 0.2 if version == 'PP-OCRv6' else 0.3,
        'Det.box_thresh': 0.45 if version == 'PP-OCRv6' else 0.6,
        'Det.unclip_ratio': 1.4 if version == 'PP-OCRv6' else 1.5,
        'Det.max_candidates': 3000 if version == 'PP-OCRv6' else 1000,
        'Det.engine_type': EngineType(backend), 'Rec.engine_type': EngineType(backend), 'Cls.engine_type': EngineType(backend),
        'Global.use_cls': False, 'Global.text_score': 0.5, 'Global.log_level': 'error',
        'EngineConfig.onnxruntime.intra_op_num_threads': 2, 'EngineConfig.onnxruntime.inter_op_num_threads': 1,
        'EngineConfig.openvino.inference_num_threads': 2, 'EngineConfig.openvino.performance_hint': 'LATENCY',
    })
    init_ms = (time.perf_counter() - start)*1000
    print(f'Benchmark {name}', flush=True)
    images = [cv2.imread(r['path']) for r in data]
    images = [cv2.resize(im, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC) if im.shape[0] < 64 else im for im in images]
    engine(images[0], use_det=detection, use_cls=False)
    rows = []
    for sample_index, (sample, image) in enumerate(zip(data, images)):
        if sample_index % 16 == 0:
            print(f'{name}: {sample_index}/{len(data)}', flush=True)
        elapsed = []
        for _ in range(2):
            start = time.perf_counter()
            result = engine(image, use_det=detection, use_cls=False)
            elapsed.append((time.perf_counter() - start)*1000)
        texts = getattr(result, 'txts', None) or []
        scores = getattr(result, 'scores', None) or []
        actual = '\n'.join(t for t, s in zip(texts, scores) if s >= 0.5)
        boxes = getattr(result, 'boxes', None)
        rows.append({**sample, 'actual': actual, 'raw': list(texts), 'scores': [float(s) for s in scores],
                     'boxes': boxes.tolist() if boxes is not None else [], 'ms': statistics.median(elapsed)})
    vocabulary = engine.text_rec.postprocess_op.character
    report = {'model': name, 'detection': detection, 'suite': suite, 'backend': backend, 'coldInitMs': round(init_ms, 2),
              'vocabularySize': len(vocabulary), 'missingSampleCharacters': sorted(set(''.join(TEXTS['ja'])) - set(''.join(vocabulary))),
              'bytes': sum(p.stat().st_size for p in (rec, det, cls)),
              'models': [{'file': p.name, 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (rec, det, cls)], 'metrics': metrics(rows),
              'byLanguage': {lang: metrics([r for r in rows if r['language'] == lang]) for lang in [*TEXTS, 'blank']},
              'byCondition': {style: metrics([r for r in rows if r['condition'] == style]) for style in dict.fromkeys(r['condition'] for r in rows)}, 'samples': rows}
    suffix = '-auto' if detection else '-line'
    (OUTPUT / suite / (name + '-' + backend + suffix + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'samples'}, ensure_ascii=False), flush=True)
    del engine
    gc.collect()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', nargs='+', choices=list(CANDIDATES), default=list(CANDIDATES))
    parser.add_argument('--auto', action='store_true')
    parser.add_argument('--suite', choices=['screen', 'challenge', 'layout'], default='screen')
    parser.add_argument('--backend', choices=['onnxruntime', 'openvino'], default='onnxruntime')
    parser.add_argument('--generate-only', action='store_true')
    args = parser.parse_args()
    if args.suite == 'layout' and not args.auto and not args.generate_only:
        parser.error('The layout suite requires --auto (detection enabled).')
    data = samples(args.suite)
    if not args.generate_only:
        for name in args.models:
            evaluate(name, data, args.auto, args.suite, args.backend)
