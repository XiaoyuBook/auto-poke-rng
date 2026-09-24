"""Small long-lived OCR worker used by the image-label editor preview.

The selected RapidOCR/ONNX runtime is initialized before reading stdin. This
keeps the Windows CRT stream lock out of model imports and mirrors the script
host preflight path.
"""

from __future__ import annotations

import base64
import binascii
import json
import sys

import cv2
import numpy as np

from easycon.native.ocr import RapidOcrReader


def emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        reader = RapidOcrReader()
    except Exception as error:
        emit({"event": "ocr.error", "message": str(error)})
        return 1
    emit({"event": "ocr.ready"})
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            params = request.get("params") or {}
            encoded = params.get("imageBase64")
            if not isinstance(request_id, int) or not isinstance(encoded, str):
                raise ValueError("OCR 请求无效")
            try:
                payload = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError("OCR 图像不是有效的 Base64") from error
            image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None or image.size == 0:
                raise ValueError("OCR 图像无效")
            text, confidence = reader.read(image, language=params.get("language"))
            emit({"id": request_id, "ok": True, "result": {"text": text, "confidence": confidence}})
        except Exception as error:
            if isinstance(request_id, int):
                emit({"id": request_id, "ok": False, "error": {"message": str(error)}})
            else:
                emit({"event": "ocr.error", "message": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
