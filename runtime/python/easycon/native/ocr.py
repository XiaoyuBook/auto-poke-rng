"""PP-OCRv6 small runtime used by the script OCR builtin and .IL labels.

The application pins RapidOCR and ONNX Runtime, while the model files are
downloaded and SHA-256 checked by ``tools/setup-ocr-models.py``. Keeping the
adapter here makes the script host independent of the benchmark environment.
"""

from __future__ import annotations

import os
from pathlib import Path
import threading
from typing import Any, Callable

import cv2
import numpy as np


class OcrRuntimeError(RuntimeError):
    """Raised when the selected PP-OCR runtime cannot be loaded or used."""


_MODEL_FILES = (
    "PP-OCRv6_det_small.onnx",
    "PP-OCRv6_rec_small.onnx",
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
)
_LANGUAGE_ALIASES = {
    "": "zh-Hans",
    "zh": "zh-Hans",
    "zh-hans": "zh-Hans",
    "zh-hant": "zh-Hant",
    "chi_sim": "zh-Hans",
    "chi_tra": "zh-Hant",
    "en": "en",
    "eng": "en",
    "ja": "ja",
    "jpn": "ja",
}
SUPPORTED_LANGUAGES = frozenset({"zh-Hans", "zh-Hant", "en", "ja"})
_runtime_lock = threading.Lock()
_runtime: "RapidOcrReader | None" = None


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def resolve_model_root(root: str | Path | None = None) -> Path:
    """Resolve the installed model directory, with an eval-artifact fallback."""

    candidates: list[Path] = []
    explicit = root is not None
    if root is not None:
        candidates.append(Path(root))
    requested = os.environ.get("AUTO_POKE_OCR_MODELS")
    if requested:
        explicit = True
        candidates.append(Path(requested))
    if not explicit:
        project = _project_root()
        candidates.extend((project / ".deps" / "ocr-models", project / ".deps" / "ocr-eval" / "models"))
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if all((resolved / filename).is_file() for filename in _MODEL_FILES):
            return resolved
    expected = ", ".join(_MODEL_FILES)
    raise OcrRuntimeError(f"缺少 PP-OCRv6 small 模型，请运行 npm run setup:runtime（需要 {expected}）")


def _normalize_language(language: str | None) -> str:
    value = str(language or "").strip().lower()
    try:
        return _LANGUAGE_ALIASES[value]
    except KeyError as exc:
        supported = ", ".join(sorted(key for key in _LANGUAGE_ALIASES if key))
        raise OcrRuntimeError(f"OCR 不支持语言 {language!r}，可用值：{supported}") from exc


def _text_and_confidence(output: Any) -> tuple[str, float]:
    raw_texts = getattr(output, "txts", None)
    raw_scores = getattr(output, "scores", None)
    texts = [str(value) for value in ([] if raw_texts is None else raw_texts)]
    scores = [float(value) for value in ([] if raw_scores is None else raw_scores)]
    accepted = [(text, score) for text, score in zip(texts, scores, strict=False) if score >= 0.5 and text.strip()]
    if not accepted:
        return "", 0.0
    return "\n".join(text for text, _ in accepted), min(score for _, score in accepted)


def preload_dependencies() -> None:
    """Import RapidOCR and ONNX Runtime before the script stdin loop blocks."""

    try:
        import onnxruntime  # noqa: F401
        import rapidocr  # noqa: F401
    except Exception as exc:
        raise OcrRuntimeError(f"PP-OCR 运行依赖初始化失败: {exc}") from exc


class RapidOcrReader:
    """Small, deterministic RapidOCR wrapper using the selected CPU profile."""

    def __init__(self, root: str | Path | None = None, *, engine_factory: Callable[..., Any] | None = None):
        self.root = resolve_model_root(root)
        try:
            if engine_factory is None:
                preload_dependencies()
                from rapidocr import EngineType, LangRec, ModelType, OCRVersion, RapidOCR

                engine_factory = RapidOCR
                params = {
                    "Det.model_path": str(self.root / _MODEL_FILES[0]),
                    "Rec.model_path": str(self.root / _MODEL_FILES[1]),
                    "Cls.model_path": str(self.root / _MODEL_FILES[2]),
                    "Rec.ocr_version": OCRVersion("PP-OCRv6"),
                    "Rec.model_type": ModelType("small"),
                    "Rec.lang_type": LangRec.CH,
                    "Det.ocr_version": OCRVersion("PP-OCRv6"),
                    "Det.model_type": ModelType("small"),
                    "Det.mean": [0.485, 0.456, 0.406],
                    "Det.std": [0.229, 0.224, 0.225],
                    "Det.limit_type": "max",
                    "Det.limit_side_len": 960,
                    "Det.thresh": 0.2,
                    "Det.box_thresh": 0.45,
                    "Det.unclip_ratio": 1.4,
                    "Det.max_candidates": 3000,
                    "Det.engine_type": EngineType("onnxruntime"),
                    "Rec.engine_type": EngineType("onnxruntime"),
                    "Cls.engine_type": EngineType("onnxruntime"),
                    "Global.use_cls": False,
                    "Global.text_score": 0.5,
                    "Global.log_level": "error",
                    "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                }
            else:
                params = {}
            self._engine = engine_factory(params=params)
        except OcrRuntimeError:
            raise
        except Exception as exc:
            raise OcrRuntimeError(f"PP-OCRv6 small 初始化失败: {exc}") from exc

    def read(self, frame: np.ndarray, *, language: str | None = None) -> tuple[str, float]:
        # PP-OCRv6 small is the selected multilingual recognizer.  The language
        # argument documents the caller's expected script and is validated here;
        # it does not switch weights or create a second model instance.
        _normalize_language(language)
        image = np.asarray(frame)
        if image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
            raise OcrRuntimeError("OCR 需要 uint8 BGR 图像")
        if image.shape[0] < 64:
            image = cv2.resize(image, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        else:
            image = np.ascontiguousarray(image)
        try:
            output = self._engine(image, use_det=True, use_cls=False)
            return _text_and_confidence(output)
        except OcrRuntimeError:
            raise
        except Exception as exc:
            raise OcrRuntimeError(f"OCR 执行失败: {exc}") from exc


def read_ocr(frame: np.ndarray, *, language: str | None = None, root: str | Path | None = None) -> tuple[str, float]:
    global _runtime
    with _runtime_lock:
        model_root = resolve_model_root(root)
        if _runtime is None or _runtime.root != model_root:
            _runtime = RapidOcrReader(model_root)
        runtime = _runtime
    return runtime.read(frame, language=language)


def reset_cached_runtime() -> None:
    global _runtime
    with _runtime_lock:
        _runtime = None


__all__ = ["OcrRuntimeError", "RapidOcrReader", "SUPPORTED_LANGUAGES", "preload_dependencies", "read_ocr", "reset_cached_runtime", "resolve_model_root"]
