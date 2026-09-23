"""Reuse the existing EasyCon interpreter, with hardware delegated to the C++ owner.

stdin starts a script then carries replies. stdout is JSONL only. This process
never opens COM ports or capture devices; parent EOF cancels all pending work.
"""
from __future__ import annotations

import json
import re
import sys
import threading
from dataclasses import fields, is_dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "clients"))
from easycon.native.engine import EasyConScriptEngine
from easycon.native.errors import ScriptCancelled
from easycon.native.ast import Call, CallStatement
from easycon.native.trace import ExecutionTrace

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
output_lock = threading.Lock()
cancelled = threading.Event()
pending = {}
request_number = 0


def emit(payload):
    with output_lock:
        print(json.dumps(payload, ensure_ascii=False), flush=True)


def source_name(source, config):
    path = Path(source)
    if path.is_absolute():
        try:
            return path.relative_to(config["rootDirectory"]).as_posix()
        except (ValueError, KeyError):
            return path.as_posix()
    return source


def error_details(error, config):
    location = getattr(error, "location", None)
    if location is None:
        return {}
    return {"source": source_name(location.source, config), "line": location.line, "column": location.column}


def validation_result(config, error=None):
    if error is None:
        return {"event": "script.validation", "valid": True}
    return {
        "event": "script.validation", "valid": False,
        "diagnostic": {"message": getattr(error, "message", str(error)), **error_details(error, config)},
    }


def request(method, params):
    global request_number
    if cancelled.is_set():
        raise ScriptCancelled("脚本已停止")
    request_number += 1
    identifier = request_number
    ready = threading.Event()
    record = {"ready": ready}
    pending[identifier] = record
    emit({"event": "request", "id": identifier, "method": method, "params": params})
    try:
        while not ready.wait(0.05):
            if cancelled.is_set():
                raise ScriptCancelled("脚本已停止")
        if "error" in record:
            raise RuntimeError(record["error"])
        return record.get("result")
    finally:
        pending.pop(identifier, None)


class RemoteGamepad:
    def press_buttons(self, key):
        request("controller.key", {"key": key, "down": True})

    def release_buttons(self, key):
        request("controller.key", {"key": key, "down": False})

    def click_buttons(self, key, duration_ms, cancel_event=None):
        request("controller.sequence", {"actions": [
            {"kind": "button", "key": key, "down": True},
            {"kind": "wait", "duration_ms": duration_ms},
            {"kind": "button", "key": key, "down": False},
        ]})

    def set_stick(self, key, x, y):
        request("controller.stick", {"side": key, "x": x, "y": y})

    def click_stick(self, key, x, y, duration_ms, cancel_event=None):
        request("controller.sequence", {"actions": [
            {"kind": "stick", "side": key, "x": x, "y": y},
            {"kind": "wait", "duration_ms": duration_ms},
            {"kind": "stick", "side": key, "x": 128, "y": 128},
        ]})

    def change_amiibo(self, _index):
        raise RuntimeError("当前运行时未提供 Amiibo 切换")


class RemoteWaiter:
    def wait(self, milliseconds, cancel_event=None):
        request("controller.sequence", {"actions": [{"kind": "wait", "duration_ms": milliseconds}]})


def normalize_preview_aliases(text):
    # The initial UI shipped 'press A'. Translate only that documented alias,
    # preserving line numbers. All other grammar belongs to the existing parser.
    return re.sub(r"(?im)^([ \t]*)press[ \t]+([a-z_+\-]+)(?:[ \t]+(\d+))?[ \t]*$",
                  lambda match: f"{match[1]}{match[2].upper()} {match[3] or '50'}", text)


def run(config, program):
    frames = None
    trace = ExecutionTrace()
    finished = threading.Event()
    sources = {unit.source: unit.text.splitlines() for unit in (*program.ast.libraries, program.ast.main)}
    sources[config["name"]] = config["text"].splitlines()
    last_point = None

    def publish_latest():
        nonlocal last_point
        point = trace.snapshot().point
        if point is None or point is last_point:
            return
        last_point = point
        location = point.location
        lines = sources.get(location.source, [])
        emit({
            "event": "script.progress", "source": source_name(location.source, config), "line": location.line,
            "column": location.column, "action": point.action,
            "text": lines[location.line - 1] if 0 < location.line <= len(lines) else "",
            "caller": {"source": source_name(point.caller.source, config), "line": point.caller.line} if point.caller else None,
            "loops": [{
                "source": source_name(item.location.source, config), "line": item.location.line,
                "column": item.location.column, "iteration": item.iteration, "total": item.total,
            } for item in point.loops],
        })

    def report_progress():
        while not finished.wait(0.1):
            publish_latest()

    reporter = None
    result = {"event": "script.done", "status": "completed"}
    try:
        root = Path(config["scriptDir"])
        def preflight(node):
            if isinstance(node, (Call, CallStatement)) and node.name.upper() in {"OCR", "AMIIBO"}:
                raise RuntimeError(f"当前公共运行时尚未接入 {node.name.upper()}，脚本未执行任何按键")
            if is_dataclass(node):
                for field in fields(node):
                    preflight(getattr(node, field.name))
            elif isinstance(node, (tuple, list)):
                for item in node:
                    preflight(item)
        preflight(program.ast)
        getters = {}
        if program.requires_image_search:
            from frames import Frames
            import numpy as np
            from easycon.native.image_labels import load_image_labels, SearchMethod
            descriptor = config.get("video", {}).get("sharedMemory")
            if not descriptor:
                raise RuntimeError("脚本需要搜图，请先连接视频源")
            frames = Frames(descriptor)
            labels = load_image_labels([root])
            missing = program.external_labels.difference(labels.labels)
            if missing:
                raise RuntimeError("找不到搜图标签: " + ", ".join(sorted(missing)))
            if any(labels.labels[name].search_method == SearchMethod.TESSER_DETECT for name in program.external_labels):
                raise RuntimeError("OCR 标签需要另行接入模型")

            def read_frame():
                # A label lookup may legitimately reuse a still-fresh latest frame.
                frames.cursor = 0
                frame = frames.read()
                if frame is None:
                    raise RuntimeError("视频帧暂不可用")
                return np.frombuffer(frame.bgr, dtype=np.uint8).reshape(frame.height, frame.width, 3)

            getters = labels.external_getters(read_frame)
        # Compile + asset preflight before taking controller ownership or sending input.
        request("script.acquire", {})
        trace.begin(config["name"])
        emit({"event": "script.started"})
        reporter = threading.Thread(target=report_progress, daemon=True)
        reporter.start()
        program.run(gamepad=RemoteGamepad(), waiter=RemoteWaiter(), external_getters=getters,
                    cancel_event=cancelled, output=lambda message: emit({"event": "script.log", "message": str(message)}),
                    trace=trace.record)
    except ScriptCancelled:
        result["status"] = "cancelled"
    except Exception as error:
        result.update(status="failed", message=str(error), **error_details(error, config))
    finally:
        finished.set()
        if reporter is not None:
            reporter.join()
        publish_latest()
        emit(result)
        if frames is not None:
            frames.close()


def main():
    config = json.loads(sys.stdin.readline())
    command = config.get("command", "run")
    try:
        program = EasyConScriptEngine().compile(normalize_preview_aliases(config["text"]),
                                               source=config["name"], script_dir=Path(config["scriptDir"]))
        if command == "validate":
            emit(validation_result(config))
            return
        if program.requires_image_search:
            # Native extension initialization can flush C stdio on Windows. Import
            # before another thread blocks on stdin, which otherwise holds its CRT
            # stream lock and can deadlock NumPy/OpenCV initialization.
            from easycon.native import image_labels  # noqa: F401
    except Exception as error:
        if command == "validate":
            emit(validation_result(config, error))
        else:
            emit({"event": "script.done", "status": "failed", "phase": "compile", "message": str(error), **error_details(error, config)})
        return
    worker = threading.Thread(target=run, args=(config, program), daemon=True)
    worker.start()
    for line in sys.stdin:
        message = json.loads(line)
        if message.get("command") == "stop":
            cancelled.set()
        else:
            record = pending.get(message.get("id"))
            if record is not None:
                record.update(message)
                record["ready"].set()
    cancelled.set()
    worker.join(2)


if __name__ == "__main__":
    main()
