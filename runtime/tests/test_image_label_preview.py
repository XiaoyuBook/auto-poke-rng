"""The editor must report the same result as a saved .IL in the script engine."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np

PYTHON_ROOT = Path(__file__).resolve().parents[1] / 'python'
sys.path.insert(0, str(PYTHON_ROOT))
from easycon.native.image_labels import ImageLabel, ImageLabelCollection


def encode(image):
    return base64.b64encode(cv2.imencode('.png', image)[1]).decode('ascii')


class PreviewContracts(unittest.TestCase):
    def test_editor_and_script_share_scores_locations_and_threshold_rounding(self):
        template = np.arange(27, dtype=np.uint8).reshape(3, 3, 3) * 3 + 20
        frame = template + 50
        for method in (0, 1, 2, 3, 4, 5, 11, 12):
            with self.subTest(method=method), tempfile.TemporaryDirectory() as folder:
                label = {'searchMethod': method, 'threshold': 95,
                         'range': {'x': 0, 'y': 0, 'width': 3, 'height': 3},
                         'target': {'x': 0, 'y': 0, 'width': 3, 'height': 3},
                         'imageBase64': encode(template)}
                raw = {'searchMethod': method, 'ImgBase64': label['imageBase64']}
                for prefix, rect in [('Range', label['range']), ('Target', label['target'])]:
                    raw.update({prefix + key.title(): value for key, value in rect.items()})
                filename = Path(folder) / 'sample.IL'
                filename.write_text(json.dumps(raw), encoding='utf-8')
                saved = ImageLabel.load(filename)
                expected = saved.search(frame)
                getter = ImageLabelCollection({'sample': saved}, 1, 0, ()).external_getters(lambda: frame)['sample']
                process = subprocess.run([sys.executable, '-u', str(PYTHON_ROOT / 'image_label_preview.py')],
                    input=json.dumps({'imageBase64': encode(frame), 'label': label}),
                    capture_output=True, text=True, timeout=10)
                self.assertEqual(process.returncode, 0, process.stderr)
                result = json.loads(process.stdout)['result']
                self.assertAlmostEqual(result['score'], expected.score)
                self.assertEqual(result['scriptValue'], getter())
                self.assertEqual(result['matched'], getter() >= 95)
                self.assertEqual((result['x'], result['y']), expected.match_rect[:2])
                self.assertEqual(result['unit'], 'score' if method in (0, 2, 4) else 'percent')
                if method == 5:
                    self.assertAlmostEqual(result['score'], 100, places=4)
                    self.assertTrue(result['matched'])
                if method == 2:
                    self.assertGreater(result['score'], 100)

    def test_preview_uses_ceiling_for_script_threshold_decisions(self):
        from image_label_preview import preview
        from unittest.mock import patch
        from easycon.native.image_labels import ImageSearchResult
        image = encode(np.ones((3, 3, 3), dtype=np.uint8))
        label = {'searchMethod': 5, 'threshold': 95, 'imageBase64': image,
                 'range': dict(x=0, y=0, width=3, height=3), 'target': dict(x=0, y=0, width=3, height=3)}
        with patch.object(ImageLabel, 'search', return_value=ImageSearchResult('test', 94.1, (0, 0), (0, 0, 3, 3), (0, 0, 3, 3))):
            result = preview({'imageBase64': image, 'label': label})
        self.assertEqual(result['scriptValue'], 95)
        self.assertTrue(result['matched'])


if __name__ == '__main__':
    unittest.main()
