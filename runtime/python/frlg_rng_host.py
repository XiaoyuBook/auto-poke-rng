"""Small JSONL bridge for the isolated FRLG planner.

The planner remains the source of truth in the sibling ``frlg-auto-rng``
project.  This host deliberately exposes search and validation only; device
ownership and script execution stay in the main application's existing
boundaries.
"""
from __future__ import annotations

from dataclasses import fields, is_dataclass
from enum import Enum
import json
import os
from pathlib import Path
import sys


def _source_root() -> Path:
    configured = os.environ.get("FRLG_AUTO_RNG_ROOT")
    if configured:
        return Path(configured).resolve()
    # Development checkout: D:/project/auto-poke-rng/runtime/python ->
    # D:/project/frlg-auto-rng.  A packaged build must set the environment
    # explicitly or bundle an audited source snapshot at this location.
    return Path(__file__).resolve().parents[3] / "frlg-auto-rng"


SOURCE_ROOT = _source_root()
if not SOURCE_ROOT.is_dir():
    raise RuntimeError(f"找不到 FRLG planner 源码目录：{SOURCE_ROOT}")
sys.path.insert(0, str(SOURCE_ROOT))

from automation.planner import AutoSearchRequest, search_best_plan  # noqa: E402


def _serialize(value):
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {field.name: _serialize(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {str(key): _serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    return value


def _request(payload: dict) -> AutoSearchRequest:
    return AutoSearchRequest(**payload)


def _dispatch(method: str, payload: dict):
    request = _request(payload)
    if method == "validate":
        request.validate()
        return {"valid": True, "source": str(SOURCE_ROOT)}
    if method == "search":
        return _serialize(search_best_plan(request).to_dict())
    raise ValueError(f"未知 FRLG RNG 方法：{method}")


def main() -> int:
    for line in sys.stdin:
        message = None
        try:
            message = json.loads(line)
            if message.get("command") == "shutdown":
                return 0
            identifier = message.get("id")
            result = _dispatch(str(message.get("method", "")), message.get("params") or {})
            print(json.dumps({"id": identifier, "ok": True, "result": result}, ensure_ascii=False), flush=True)
        except Exception as error:  # noqa: BLE001 - the JSONL boundary must remain alive
            print(json.dumps({"id": message.get("id") if isinstance(message, dict) else None, "ok": False,
                              "error": {"message": str(error)}}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
