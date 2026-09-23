"""Independent EasyOCR baseline using CPU, the same generated crops, and known language.

Use a separate environment (EasyOCR depends on headless OpenCV; RapidOCR on OpenCV).
See docs/OCR_SELECTION.md for pinned installation and benchmark commands.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

import cv2
import easyocr
import torch

sys.stdout.reconfigure(encoding='utf-8')
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
ROOT = Path(__file__).resolve().parents[1] / '.deps/ocr-eval'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', choices=['screen', 'challenge'], default='screen')
    args = parser.parse_args()
    samples = json.loads((ROOT / args.suite / 'samples.json').read_text(encoding='utf-8'))
    rows = []
    initializations = {}
    model_directory = ROOT / 'easy-models'
    for route, languages in [('zh', ['ch_sim', 'en']), ('zh-Hant', ['ch_tra', 'en']), ('ja', ['ja', 'en']), ('latin', ['en'])]:
        def route_for(sample):
            if sample['language'] == 'zh':
                traditional_ids = ('zh-3-',) if args.suite == 'screen' else ('zh-5-', 'zh-6-')
                return 'zh-Hant' if sample['id'].startswith(traditional_ids) else 'zh'
            return 'ja' if sample['language'] == 'ja' else 'latin'
        group = [s for s in samples if route_for(s) == route]
        print('Initialize ' + route, flush=True)
        start = time.perf_counter()
        reader = easyocr.Reader(languages, gpu=False, detector=False, model_storage_directory=str(model_directory),
                                user_network_directory=str(ROOT / 'easy-user-network'), verbose=False)
        initializations[route] = (time.perf_counter() - start)*1000
        def recognize(image):
            h, w = image.shape[:2]
            return reader.recognize(image, horizontal_list=[[0, w, 0, h]], free_list=[], detail=1, paragraph=False)
        recognize(cv2.imread(group[0]['inputPath']))
        for sample in group:
            image = cv2.imread(sample['inputPath'])
            times = []
            for _ in range(2):
                start = time.perf_counter()
                result = recognize(image)
                times.append((time.perf_counter()-start)*1000)
            rows.append({**sample, 'route': route, 'actual': '\n'.join(text for _, text, confidence in result if confidence >= 0.5),
                         'raw': [text for _, text, _ in result], 'scores': [float(score) for _, _, score in result], 'ms': statistics.median(times)})
        del reader
        gc.collect()
    models = []
    for file in model_directory.glob('*.pth'):
        with file.open('rb') as stream:
            models.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()})
    report = {'model': 'EasyOCR 1.7.2', 'suite': args.suite, 'detection': False, 'backend': 'torch 2.8.0 CPU',
              'quantize': True, 'decoder': 'greedy',
              'initializationMsIncludingDownloads': initializations, 'models': models, 'samples': rows}
    (ROOT / args.suite / 'easyocr-line.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Finished EasyOCR ' + args.suite, flush=True)


if __name__ == '__main__':
    main()
