import tempfile
import unittest
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from easycon.native.image_labels import ImageLabel, SearchMethod
from easycon.native.ocr import OcrRuntimeError, RapidOcrReader


class _FakeEngine:
    def __init__(self, output):
        self.output = output
        self.images = []

    def __call__(self, image, **kwargs):
        self.images.append((image, kwargs))
        return self.output


class OcrAdapterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        for filename in (
            "PP-OCRv6_det_small.onnx",
            "PP-OCRv6_rec_small.onnx",
            "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        ):
            (root / filename).touch()
        self.root = root

    def tearDown(self):
        self.directory.cleanup()

    def test_filters_low_scores_and_preserves_lines(self):
        engine = _FakeEngine(SimpleNamespace(txts=[" first ", "ignored", "second "], scores=[0.9, 0.49, 0.8]))
        reader = RapidOcrReader(self.root, engine_factory=lambda **_: engine)
        text, score = reader.read(np.zeros((80, 100, 3), dtype=np.uint8), language="ja")
        self.assertEqual(text, " first \nsecond ")
        self.assertEqual(score, 0.8)
        self.assertEqual(engine.images[0][1], {"use_det": True, "use_cls": False})

    def test_small_roi_is_upscaled(self):
        engine = _FakeEngine(SimpleNamespace(txts=[], scores=[]))
        reader = RapidOcrReader(self.root, engine_factory=lambda **_: engine)
        reader.read(np.zeros((20, 30, 3), dtype=np.uint8), language="zh-Hans")
        self.assertEqual(engine.images[0][0].shape, (40, 60, 3))

    def test_rejects_unknown_language_and_invalid_image(self):
        engine = _FakeEngine(SimpleNamespace(txts=[], scores=[]))
        reader = RapidOcrReader(self.root, engine_factory=lambda **_: engine)
        with self.assertRaisesRegex(OcrRuntimeError, "不支持语言"):
            reader.read(np.zeros((80, 100, 3), dtype=np.uint8), language="fr")
        with self.assertRaisesRegex(OcrRuntimeError, "uint8 BGR"):
            reader.read(np.zeros((80, 100), dtype=np.uint8), language="en")

    def test_ocr_text_label_uses_shared_reader(self):
        label_path = self.root / "status.IL"
        label_path.write_text(
            '{"searchMethod":107,"ImgBase64":"HELLO",'
            '"RangeX":0,"RangeY":0,"RangeWidth":100,"RangeHeight":80,'
            '"TargetX":10,"TargetY":20,"TargetWidth":40,"TargetHeight":20}',
            encoding="utf-8",
        )
        label = ImageLabel.load(label_path)
        result = label.search(
            np.zeros((80, 100, 3), dtype=np.uint8),
            ocr_reader=lambda image: ("HELLO", 0.9),
        )
        self.assertEqual(label.search_method, SearchMethod.TESSER_DETECT)
        self.assertEqual(result.script_value, 90)
        self.assertEqual(result.recognized_text, "HELLO")

    def test_ocr_text_label_default_uses_selected_rapidocr_reader(self):
        label_path = self.root / "status.IL"
        label_path.write_text(
            '{"searchMethod":107,"ImgBase64":"READY",'
            '"RangeX":0,"RangeY":0,"RangeWidth":40,"RangeHeight":40,'
            '"TargetX":2,"TargetY":3,"TargetWidth":20,"TargetHeight":16}',
            encoding="utf-8",
        )
        label = ImageLabel.load(label_path)
        with patch("easycon.native.ocr.read_ocr", return_value=("READY", 0.8)) as reader:
            result = label.search(np.zeros((40, 40, 3), dtype=np.uint8))
        reader.assert_called_once()
        self.assertEqual(result.script_value, 80)


if __name__ == "__main__":
    unittest.main()
