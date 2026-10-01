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
            if isinstance(node, (Call, CallStatement)) and node.name.upper() in {"AMIIBO"}:
                raise RuntimeError(f"当前公共运行时尚未接入 {node.name.upper()}，脚本未执行任何按键")
            if is_dataclass(node):
                for field in fields(node):
                    preflight(getattr(node, field.name))
            elif isinstance(node, (tuple, list)):
                for item in node:
                    preflight(item)
        preflight(program.ast)
        getters = {}
        extern_functions = {}
        seed_runtime = None
        data_runtime = None
        catalog_runtime = None
        vote_session = None
        # 00_Seed表_入口.ecs and 01_Seed表_HEX转换.ecs are generated as
        # EXTERN declarations by the FRLG project builder.  Bind them once to
        # the sidecar snapshot materialized from the copied ECS tables; the
        # table's game/version/index/mode semantics stay identical while the
        # 2,300-row interpreted arrays no longer execute inside ECS.
        seed_table_snapshot = root / "seed_tables.json"
        if seed_table_snapshot.is_file():
            # The vendored planner keeps its legacy ``rng`` imports relative
            # to frlg_planner/.  Add that directory only when binding the
            # FRLG Seed adapter; ordinary ECS scripts do not need it.
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation.seed_table_runtime import SeedTableRuntime

            seed_runtime = SeedTableRuntime.from_project(root)
            extern_functions.update(seed_runtime.extern_functions())
        # 11-14_计算_* are generated as pure-Python EXTERN shims.  Their
        # original ECS files remain in lib/python_backup/ for behavior diffs;
        # device/OCR/flow libraries stay interpreted by EasyCon as before.
        python_compute_snapshot = root / "python_compute.json"
        if python_compute_snapshot.is_file():
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation import frlg_compute_runtime

            extern_functions.update(frlg_compute_runtime.extern_functions())
        # Generated 04-06 data libraries use the same boundary.  The JSON
        # snapshot is produced from the copied ECS files, so downloaded name
        # or stat-table changes remain visible in the generated project's
        # python_backup diff.
        python_data_snapshot = root / "python_data.json"
        if python_data_snapshot.is_file():
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation.frlg_data_runtime import DataRuntime

            data_runtime = DataRuntime.from_project(root)
            extern_functions.update(data_runtime.extern_functions())
        # 07-10 target/input catalogs are deterministic tables. The generated
        # project keeps lib/python_backup copies and same-name EXTERN shims so
        # each callback can be compared with the original ECS branch order.
        python_catalog_snapshot = root / "python_catalog.json"
        if python_catalog_snapshot.is_file():
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation.frlg_catalog_runtime import CatalogRuntime

            catalog_runtime = CatalogRuntime.from_project(root)
            extern_functions.update(catalog_runtime.extern_functions())
        python_text_snapshot = root / "python_text.json"
        if python_text_snapshot.is_file():
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation.frlg_text_runtime import TextRuntime

            extern_functions.update(TextRuntime.from_project(root).extern_functions())
        python_wild_snapshot = root / "python_wild_data.json"
        if python_wild_snapshot.is_file():
            planner_root = Path(__file__).resolve().parent / "frlg_planner"
            if str(planner_root) not in sys.path:
                sys.path.insert(0, str(planner_root))
            from frlg_planner.automation.frlg_wild_data_runtime import WildDataRuntime

            extern_functions.update(WildDataRuntime.from_project(root).extern_functions())
        # 25/28 are stateful calculations.  Each script run gets a distinct
        # Python session; this is the explicit replacement for their former
        # ECS file-scope arrays ($V_* / $C_* and $孵蛋反查_*).  The generated
        # project keeps the originals in lib/python_backup for differential
        # review, while these callbacks own all mutable calculation state.
        python_vote_snapshot = root / "python_vote.json"
        if python_vote_snapshot.is_file():
            from frlg_planner.automation.frlg_vote_runtime import CalibrationVoteSession

            vote_session = CalibrationVoteSession(seed_runtime=seed_runtime)
            extern_functions.update(vote_session.extern_functions())
        python_egg_snapshot = root / "python_egg_reverse.json"
        if python_egg_snapshot.is_file():
            from frlg_planner.automation.frlg_egg_reverse_runtime import EggReverseSession

            extern_functions.update(
                EggReverseSession(data_runtime=data_runtime).extern_functions()
            )
        # 24 is pure BINGO state/rendering.  The generated EXTERN callbacks
        # use the same script-run lifetime as 25/28; PRINT output is routed
        # through the normal script logger so the UI keeps the old diagnostics.
        python_bingo_snapshot = root / "python_bingo.json"
        if python_bingo_snapshot.is_file():
            from frlg_planner.automation.frlg_bingo_runtime import BingoSession

            extern_functions.update(
                BingoSession(emit=lambda message: emit({"event": "script.log", "message": str(message)})).extern_functions()
            )
        # Mixed libraries keep their device/image functions in ECS, but these
        # deterministic support and Seed-wait helpers are Python callbacks.
        python_flow_snapshot = root / "python_flow.json"
        if python_flow_snapshot.is_file():
            from frlg_planner.automation.frlg_flow_runtime import EggFlowRuntime, FlowRuntime

            extern_functions.update(FlowRuntime().extern_functions())
            extern_functions.update(
                EggFlowRuntime(
                    seed_runtime=seed_runtime,
                    catalog_runtime=catalog_runtime,
                    emit=lambda message: emit({"event": "script.log", "message": str(message)}),
                ).extern_functions()
            )
        # main.ecs 的通用反查也必须整段进入 Python，不能只迁移 lib/11 的
        # 单步 RNG。扫描前后由生成的状态桥同步全局变量；复用同一投票会话。
        if (root / "python_main_reverse.json").is_file():
            from frlg_planner.automation.frlg_main_reverse_runtime import MainReverseSession

            if seed_runtime is None or vote_session is None:
                raise RuntimeError("主脚本 Python 反查缺少 Seed 表或投票会话")

            def reverse_checkpoint():
                if cancelled.is_set():
                    raise ScriptCancelled("脚本已取消")

            extern_functions.update(MainReverseSession(
                seed_runtime=seed_runtime, vote_session=vote_session,
                emit=lambda message: emit({"event": "script.log", "message": str(message)}),
                checkpoint=reverse_checkpoint,
            ).extern_functions())
        ocr_reader = None
        ocr_runtime = None
        labels = None
        if program.requires_video:
            from frames import Frames
            import numpy as np

            descriptor = config.get("video", {}).get("sharedMemory")
            if not descriptor:
                raise RuntimeError("脚本需要搜图或 OCR，请先连接视频源")
            frames = Frames(descriptor)

            def read_frame():
                # A label lookup may legitimately reuse a still-fresh latest frame.
                frames.cursor = 0
                frame = frames.read()
                if frame is None:
                    raise RuntimeError("视频帧暂不可用")
                return np.frombuffer(frame.bgr, dtype=np.uint8).reshape(frame.height, frame.width, 3)

            if program.requires_image_search:
                from easycon.native.image_labels import load_image_labels, SearchMethod

                labels = load_image_labels([root])
                missing = program.external_labels.difference(labels.labels)
                if missing:
                    raise RuntimeError("找不到搜图标签: " + ", ".join(sorted(missing)))

                label_uses_ocr = any(
                    labels.labels[name].search_method == SearchMethod.TESSER_DETECT
                    for name in program.external_labels
                )
            else:
                label_uses_ocr = False

            if program.requires_ocr or label_uses_ocr:
                from easycon.native.ocr import RapidOcrReader

                # Load dependencies and model before taking the controller lease.
                # An unavailable model must never leave an acquired lease behind.
                ocr_runtime = RapidOcrReader()
                ocr_reader = lambda image: ocr_runtime.read(image)

                def ocr_region(x, y, width, height, language):
                    try:
                        x, y, width, height = (int(x), int(y), int(width), int(height))
                    except (TypeError, ValueError) as exc:
                        raise RuntimeError("OCR 区域坐标必须是整数") from exc
                    frame = read_frame()
                    frame_height, frame_width = frame.shape[:2]
                    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > frame_width or y + height > frame_height:
                        raise RuntimeError(f"OCR 区域超出视频帧范围: {(x, y, width, height)} / {frame_width}x{frame_height}")
                    text, _confidence = ocr_runtime.read(
                        frame[y:y + height, x:x + width].copy(), language=str(language)
                    )
                    return text

                extern_functions["OCR"] = ocr_region

            if labels is not None:
                getters = labels.external_getters(read_frame, ocr_reader=ocr_reader,
                    result_callback=lambda match: emit({
                        'event': 'script.image-result', 'labelName': match.label_name,
                        'score': match.score, 'scriptValue': match.script_value,
                        'location': match.location, 'rangeRect': match.range_rect, 'matchRect': match.match_rect,
                    }))
            # Fail before controller.acquire when a required video source has
            # not published a usable frame yet.
            first_frame = read_frame()
            if labels is not None:
                for name in sorted(program.external_labels):
                    labels.labels[name].preflight(first_frame)
        # Compile + asset preflight before taking controller ownership or sending input.
        request("script.acquire", {})
        trace.begin(config["name"])
        emit({
            "event": "script.started",
            "requiresVideo": program.requires_video,
            "videoSession": config.get("video", {}).get("session") if program.requires_video else None,
        })
        reporter = threading.Thread(target=report_progress, daemon=True)
        reporter.start()
        program.run(gamepad=RemoteGamepad(), waiter=RemoteWaiter(), external_getters=getters,
                    extern_functions=extern_functions,
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
        if program.requires_image_search or program.requires_ocr:
            # Native extension initialization can flush C stdio on Windows. Import
            # before another thread blocks on stdin, which otherwise holds its CRT
            # stream lock and can deadlock NumPy/OpenCV initialization.
            if program.requires_image_search:
                from easycon.native import image_labels  # noqa: F401
            if program.requires_ocr:
                from easycon.native import ocr
                ocr.preload_dependencies()
            elif program.requires_image_search:
                # A .IL OCR text label is discovered after the script
                # worker starts. Import the native OCR stack here as well so
                # that its first use cannot race the stdin reader.
                from easycon.native import ocr
                ocr.preload_dependencies()
    except Exception as error:
        if command == "validate":
            emit(validation_result(config, error))
        else:
            emit({"event": "script.done", "status": "failed", "phase": "compile", "message": str(error), **error_details(error, config)})
        return
    if command != "validate" and (
        (Path(config["scriptDir"]) / "seed_tables.json").is_file()
        or (Path(config["scriptDir"]) / "python_compute.json").is_file()
        or (Path(config["scriptDir"]) / "python_data.json").is_file()
        or (Path(config["scriptDir"]) / "python_catalog.json").is_file()
        or (Path(config["scriptDir"]) / "python_text.json").is_file()
        or (Path(config["scriptDir"]) / "python_wild_data.json").is_file()
        or (Path(config["scriptDir"]) / "python_vote.json").is_file()
        or (Path(config["scriptDir"]) / "python_egg_reverse.json").is_file()
        or (Path(config["scriptDir"]) / "python_bingo.json").is_file()
        or (Path(config["scriptDir"]) / "python_flow.json").is_file()
    ):
        # Import the vendored planner before the stdin reader starts.  Its
        # package initializer imports NumPy; importing that from the worker
        # while the main thread is blocked in Windows CRT stdin can deadlock.
        planner_root = Path(__file__).resolve().parent / "frlg_planner"
        if str(planner_root) not in sys.path:
            sys.path.insert(0, str(planner_root))
        try:
            from frlg_planner.automation import seed_table_runtime  # noqa: F401
            from frlg_planner.automation import frlg_compute_runtime  # noqa: F401
            from frlg_planner.automation import frlg_data_runtime  # noqa: F401
            from frlg_planner.automation import frlg_catalog_runtime  # noqa: F401
            from frlg_planner.automation import frlg_text_runtime  # noqa: F401
            from frlg_planner.automation import frlg_wild_data_runtime  # noqa: F401
            from frlg_planner.automation import frlg_vote_runtime  # noqa: F401
            from frlg_planner.automation import frlg_egg_reverse_runtime  # noqa: F401
            from frlg_planner.automation import frlg_main_reverse_runtime  # noqa: F401
            from frlg_planner.automation import frlg_bingo_runtime  # noqa: F401
            from frlg_planner.automation import frlg_flow_runtime  # noqa: F401
        except Exception as error:
            emit({"event": "script.done", "status": "failed", "phase": "compile", "message": str(error)})
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
