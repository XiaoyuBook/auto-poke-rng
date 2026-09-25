import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from automation_ocr import RapidResultAdapter, inspect_image


class OcrContract(unittest.TestCase):
    def test_provider_preserves_boxes_and_scores_for_original_parser(self):
        reader = SimpleNamespace(_engine=lambda *_a, **_kw: SimpleNamespace(
            boxes=np.array([[[1,2],[30,2],[30,20],[1,20]]]), txts=np.array(['固执']), scores=np.array([.98])))
        result = RapidResultAdapter(reader).predict(np.zeros((40,60,3), np.uint8))
        self.assertEqual(result[0]['rec_texts'], ['固执'])
        self.assertAlmostEqual(result[0]['rec_scores'][0], .98)
        self.assertEqual(result[0]['rec_polys'][0][0], [1,2])

    def test_unknown_field_fails_without_model_work(self):
        with self.assertRaises(ValueError):
            inspect_image(None, {'operation':'field', 'field':'typo'}, SimpleNamespace())

    def test_notes_region_uses_real_parser_with_existing_reader(self):
        reader = SimpleNamespace(_engine=lambda *_a, **_kw: SimpleNamespace(
            boxes=np.array([[[1,2],[30,2],[30,20],[1,20]]]), txts=['固执的性格'], scores=[.98]))
        result = inspect_image(np.zeros((60,100,3), np.uint8), {
            'operation':'field','field':'nature','regions':{'nature':[0,0,100,60]}}, reader)
        self.assertIn('固执', result['text'])


if __name__ == '__main__':
    unittest.main()
