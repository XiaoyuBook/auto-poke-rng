"""One-shot editor matching using the exact .IL implementation used by scripts."""
import base64
import json
from pathlib import Path
import sys

import cv2
import numpy as np

from easycon.native.image_labels import ImageLabel, SearchMethod


def preview(request):
    data = request['label']
    frame = cv2.imdecode(np.frombuffer(base64.b64decode(request['imageBase64'], validate=True), dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        raise ValueError('测试画面无效')
    def rect(key):
        return tuple(data[key][field] for field in ('x', 'y', 'width', 'height'))
    method = SearchMethod(data['searchMethod'])
    if method is SearchMethod.TESSER_DETECT:
        raise ValueError('OCR 标签请使用 OCR 服务')
    label = ImageLabel('preview', Path('preview.IL'), method, data['imageBase64'], rect('range'), rect('target'))
    result = label.search(frame)
    x, y, width, height = result.match_rect
    return {'score': result.score, 'scriptValue': result.script_value,
            'matched': result.script_value >= data['threshold'],
            'unit': 'score' if method in (SearchMethod.SQ_DIFF, SearchMethod.C_CORR, SearchMethod.C_COEFF) else 'percent',
            'x': x, 'y': y, 'width': width, 'height': height}


if __name__ == '__main__':
    try:
        response = {'ok': True, 'result': preview(json.load(sys.stdin))}
    except Exception as error:
        response = {'ok': False, 'error': str(error)}
    print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)
