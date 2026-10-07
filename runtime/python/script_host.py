"""Reuse the existing EasyCon interpreter, with hardware delegated to the C++ owner.

stdin starts a script then carries replies. stdout is JSONL only. This process
never opens COM ports or capture devices; parent EOF cancels all pending work.
"""
from __future__ import annotations

import json
import hashlib
import re
import sys
import threading
import time
from dataclasses import fields, is_dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "clients"))
from easycon.native.engine import EasyConScriptEngine
from easycon.native.errors import ScriptCancelled
from easycon.native.ast import Call, CallStatement
from easycon.native.trace import ExecutionTrace

for _stream in (sys.stdout, sys.stdin, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")
output_lock = threading.Lock()
cancelled = threading.Event()
pending = {}
request_number = 0
diagnostic_sink = lambda **data: None


def make_diagnostic_emitter(config):
    if config.get('diagnostics') is not True:
        return lambda **data: None
    return lambda **data: emit({'event': 'script.diagnostic',
                               'hostTimestamp': time.time_ns() // 1_000_000,
                               'monotonicNs': str(time.perf_counter_ns()), **data})


# Generated FRLG ECS projects carry this marker in their source.  Keeping the
# policy in the script means a copied project behaves the same way in the
# shared host, while ordinary user scripts keep their original PRINT output.
ECS_LOG_POLICY_RE = re.compile(r"(?m)^# GUI_ECS_LOG_POLICY_V1 mode=(compact|full)\s*$")
_COMPACT_ECS_QUIET_PREFIXES = (
    "HOME_BUFFER_", "TID_HOME_BUFFER_", "孵蛋重启识图", "设置识别 ",
    "孵蛋池塘冲浪检测|尝试=", "孵蛋池塘战斗检测|尝试=", "孵蛋Seed校准控制器",
    "观测差:", "索引修正:", "毫秒细调:", "目标Seed保持:",
    "方案2接续方向票:", "下轮Seed", "快捷登记识别:", "孵蛋快捷登记识别:",
    "TV局部时间轴:", "日版性格最高匹配度:", "日版HP最高匹配度:",
    "日版ATK最高匹配度:", "日版DEF最高匹配度:", "日版SPA最高匹配度:",
    "日版SPD最高匹配度:", "日版SPE最高匹配度:",
)
_COMPACT_ECS_QUIET_CONTAINS = (
    "OCR原文:",
)
_COMPACT_ECS_ERROR_WORDS = (
    "失败", "错误", "无效", "异常", "未找到", "没有找到", "无法", "不能",
    "停止", "超时", "缺少", "不支持", "请检查", "不完整", "暂无",
)
_COMPACT_ECS_KEEP_CONTAINS = (
    "已命中", "流程完成", "流程已结束", "目标Seed已确认", "出闪", "闪光",
    "开始", "完成", "正确", "准备", "重启", "重试", "继续", "校准成功",
    "可用", "候选命中", "观测采集完成", "最终候选", "唯一", "目标Seed:",
    "孵蛋方法", "BINGO稳定校准",
    "本轮结果波动较大，参数保持不变", "本轮离群跳过",
)
_BINGO_GRAPH_SYMBOLS = "＠①②③④⑤⑥⑦⑧⑨ｘｏ．"


def _is_bingo_graph_line(line):
    """Return whether a line belongs to the ECS text-rendered BINGO graph."""
    if line.startswith((
        "【BINGO】", "【BINGO TV归一化】", "横轴:", "纵轴:", "图例:", "消耗帧　", "TV模式:",
        "TV帧　", "Seed",
    )):
        return True
    return line.startswith(("－", "＋", "　", " ?")) and any(
        symbol in line for symbol in _BINGO_GRAPH_SYMBOLS
    )


def _ecs_log_mode(config):
    match = ECS_LOG_POLICY_RE.search(str(config.get("text", "")))
    return match.group(1) if match else None


def _compact_audio_line(line):
    """GUI summary only; the emitter archives the full audio report first.

    Keep the detector's verdict, rather than reclassifying its rounded score:
    an incomplete window can have a score and still be unknown. The enhanced
    comparison score is diagnostic and never controls this verdict.
    """
    from frlg_audio_diagnostic import SHINY_SCORE_THRESHOLD
    prefix = "【音频判闪·实验】"
    parts = line.removeprefix(prefix).split("；")
    fields = dict(part.split("=", 1) for part in parts if "=" in part)
    labels = {"检出闪光音效候选": "疑似出闪", "未检出闪光音效": "未检出", "无法判定": "无法判定"}
    verdict = next((part for part in parts if part in labels), None)
    if verdict:
        summary = [labels[verdict],
                   f"分数 {fields.get('score', '—')} / 阈值 {fields.get('threshold', f'{SHINY_SCORE_THRESHOLD:g}')}"]
        reason = fields.get("reason")
        if reason is None and verdict == "无法判定":
            # A detector exception is emitted without key/value fields.
            reason = next((part for part in parts if part and "=" not in part and part not in labels), None)
        if reason:
            summary.append({"提前截止，未覆盖计划音频窗口": "采样提前结束"}.get(reason, reason))
        return prefix + "；".join(summary)
    if parts[0].startswith("参考音效已加载"):
        return prefix + f"已启用；阈值 {SHINY_SCORE_THRESHOLD:g}"
    # One-off setup/failure messages only need their first clause.
    return prefix + parts[0]


def _compact_ecs_line(line):
    line = str(line).strip()
    if not line:
        return None

    # Audio reports otherwise match the generic "闪光"/"无法" keep rules and
    # expose packet timestamps and comparison scores in the normal GUI log.
    if line.startswith("【音频判闪·实验】"):
        return _compact_audio_line(line)

    # Stage markers carry a very large label/OCR payload.  Keep the phase and
    # outcome while dropping the machine-generated matcher list.
    if line.startswith("FRLG_STAGE|"):
        fields = line.split("|")
        if len(fields) >= 3:
            kind, phase = fields[1], fields[2]
            if kind == "BEGIN":
                return f"阶段开始：{phase}"
            if kind == "END":
                return f"阶段完成：{phase}"
            if kind == "FAIL":
                detail = fields[3] if len(fields) > 3 and fields[3] else "阶段执行失败"
                return f"阶段失败：{phase}：{detail}"
        return None

    # These records are consumed by calibration finalization and must remain
    # machine-readable even in compact mode.
    if line.startswith("PRECALIBRATION_UPDATE|"):
        return line
    if line.startswith('FRLG_REFINEMENT|V=1|'):
        fields = dict(part.split('=', 1) for part in line.split('|')[2:] if '=' in part)
        reason = fields.get('REASON', '')
        if fields.get('STATUS') == 'refining':
            reason = f"继续升至 LV{fields.get('NEXT_LEVEL', '?')}"
        elif reason == '升级能力值无法区分剩余落点，等待跨轮证据':
            reason = '升级无法消歧，转下一轮'
        return f"候选细分：{fields.get('CANDIDATES', '?')} 个，已用 {fields.get('CANDIES', '?')} 颗糖；{reason}"
    if line.startswith('OCR地点筛选:'):
        return line
    if line.startswith(("SIDREV|META|", "SIDREV|ERROR|", "SIDREV|DONE|")):
        return line
    if line.startswith("SIDREV|"):
        return None
    if _is_bingo_graph_line(line):
        return None

    if any(line.startswith(prefix) for prefix in _COMPACT_ECS_QUIET_PREFIXES):
        return None
    if any(token in line for token in _COMPACT_ECS_QUIET_CONTAINS):
        return None

    # Suppress the 9x9 BINGO grid and its explanatory rows.  A stable-cluster
    # reason remains useful, so only the table rendering is hidden.
    if line.startswith(("BINGO稳定校准", "条件:", "Seed距离:", "消耗帧偏移:", "累计命中:")):
        return line
    # Repeated attempts and score dumps are useful in full diagnostics but
    # obscure the current route in the normal workspace log.
    if line.startswith("SIDREV|ATTEMPT_"):
        return None
    if line.startswith(("HOME_BUFFER", "TID_HOME_BUFFER")):
        return line if any(word in line for word in _COMPACT_ECS_ERROR_WORDS) else None
    if "匹配度=" in line or line.startswith(("快捷登记识别:", "孵蛋快捷登记识别:")):
        return None

    # Keep an unstructured line only when it reports a state transition or an
    # actionable result.  The common input/setup instructions are one-off and
    # therefore remain visible through their explicit status words.
    if any(word in line for word in _COMPACT_ECS_ERROR_WORDS):
        return line
    if any(word in line for word in _COMPACT_ECS_KEEP_CONTAINS):
        return line
    return None


def make_script_log_emitter(config):
    mode = _ecs_log_mode(config)
    diagnostic = make_diagnostic_emitter(config)
    if mode is None:
        def emit_plain(message):
            diagnostic(kind='ecs.output', message=str(message))
            emit({"event": "script.log", "message": str(message)})
        return emit_plain

    from frlg_round_records import RoundRecorder
    recorder = RoundRecorder(lambda record: emit({"event": "script.round", **record}))

    def emit_compact(message):
        # Preserve original PRINTs before the UI policy removes diagnostics.
        recorder.consume(message)
        diagnostic(kind='ecs.output', message=str(message))
        if mode == "full":
            emit({"event": "script.log", "message": str(message)})
            return
        # BINGO's grid is delivered through ``script.bingo`` as structured
        # state.  Its old PRINT lines are deliberately omitted from the ECS
        # stream so the log center stays readable.
        for line in str(message).splitlines():
            compact = _compact_ecs_line(line.rstrip("\r"))
            if compact is not None:
                emit({"event": "script.log", "message": compact})

    return emit_compact


def make_script_bingo_emitter():
    return lambda state: emit({"event": "script.bingo", "state": state})


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
    started = time.perf_counter_ns()
    diagnostic_sink(kind='controller.request', requestId=identifier, method=method, params=params)
    try:
        while not ready.wait(0.05):
            if cancelled.is_set():
                raise ScriptCancelled("脚本已停止")
        if "error" in record:
            diagnostic_sink(kind='controller.reply', requestId=identifier, error=record['error'],
                            elapsedMs=round((time.perf_counter_ns() - started) / 1e6, 3))
            raise RuntimeError(record["error"])
        diagnostic_sink(kind='controller.reply', requestId=identifier,
                        elapsedMs=round((time.perf_counter_ns() - started) / 1e6, 3))
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
    global diagnostic_sink
    diagnostic_sink = make_diagnostic_emitter(config)
    frames = None
    audio_diagnostic = None
    phases = None
    script_log = make_script_log_emitter(config)
    script_bingo = make_script_bingo_emitter()
    trace = ExecutionTrace()
    base_diagnostic = diagnostic_sink
    def contextual_diagnostic(**data):
        point = trace.snapshot().point
        if point is not None:
            data['location'] = {'source': source_name(point.location.source, config), 'line': point.location.line,
                                'column': point.location.column, 'action': point.action}
        base_diagnostic(**data)
    diagnostic_sink = contextual_diagnostic
    finished = threading.Event()
    sources = {unit.source: unit.text.splitlines() for unit in (*program.ast.libraries, program.ast.main)}
    sources[config["name"]] = config["text"].splitlines()
    runtime_root = Path(__file__).resolve().parent
    runtime_files = [runtime_root / 'script_host.py', runtime_root / 'frlg_audio_diagnostic.py',
                     runtime_root / 'easycon/native/runtime.py',
                     runtime_root / 'easycon/native/ocr.py', *sorted((runtime_root / 'frlg_planner/automation').glob('*runtime.py')),
                     runtime_root / 'frlg_planner/automation/frlg_ocr_names.py',
                     runtime_root / 'frlg_planner/automation/frlg_candidate_refinement.py']
    diagnostic_sink(kind='script.preflight', name=config['name'],
        sources=[{'source': source_name(source, config), 'sha256': hashlib.sha256('\n'.join(lines).encode()).hexdigest()}
                 for source, lines in sources.items()],
        runtimeFiles=[{'source': p.relative_to(runtime_root).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in runtime_files if p.is_file()],
        video={k: config.get('video', {}).get(k) for k in ('status', 'session', 'width', 'height')},
        audio={k: (config.get('audio') or {}).get(k) for k in ('status', 'session', 'sampleRate', 'channels')})
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
        wild_runtime = None
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

            wild_runtime = WildDataRuntime.from_project(root)
            extern_functions.update(wild_runtime.extern_functions())
        if (root / 'python_ocr_names.json').is_file():
            from frlg_planner.automation.frlg_ocr_names import OcrNameRuntime
            # Share the run's extracted tables. The context callback updates
            # with actual flow state rather than the initial GUI target.
            extern_functions.update(OcrNameRuntime.from_project(root, diagnostic_sink,
                data_runtime=data_runtime, wild_runtime=wild_runtime).extern_functions())
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
        # use the same script-run lifetime as 25/28; the structured snapshot
        # is routed to the GUI while the old grid PRINT stream stays quiet.
        python_bingo_snapshot = root / "python_bingo.json"
        if python_bingo_snapshot.is_file():
            from frlg_planner.automation.frlg_bingo_runtime import BingoSession

            extern_functions.update(
                BingoSession(emit=script_log, update=script_bingo).extern_functions()
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
                    emit=script_log,
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
                emit=script_log,
                checkpoint=reverse_checkpoint,
            ).extern_functions())
        ocr_reader = None
        ocr_runtime = None
        labels = None
        video_frame = None
        if program.requires_video:
            from frames import Frames
            import numpy as np

            descriptor = config.get("video", {}).get("sharedMemory")
            if not descriptor:
                raise RuntimeError("脚本需要搜图或 OCR，请先连接视频源")
            frames = Frames(descriptor)

            def read_frame():
                nonlocal video_frame
                # A label lookup may legitimately reuse a still-fresh latest frame.
                frames.cursor = 0
                frame = frames.read()
                if frame is None:
                    raise RuntimeError("视频帧暂不可用")
                video_frame = {'sequence': frame.sequence, 'timestampNs': str(frame.timestamp_ns),
                               'width': frame.width, 'height': frame.height}
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
                diagnostic_sink(kind='ocr.model', model='PP-OCRv6 small',
                    files=[{'name': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in sorted(ocr_runtime.root.glob('*.onnx'))])
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
                    started = time.perf_counter_ns()
                    diagnostic_sink(kind='ocr.inference.begin', region=[x, y, width, height],
                                    language=str(language), videoFrame=video_frame)
                    text, _confidence = ocr_runtime.read(
                        frame[y:y + height, x:x + width].copy(), language=str(language)
                    )
                    diagnostic_sink(kind='ocr.inference.end', raw=text, confidence=_confidence,
                        region=[x, y, width, height], videoFrame=video_frame,
                        elapsedMs=round((time.perf_counter_ns() - started) / 1e6, 3))
                    return text

                extern_functions["OCR"] = ocr_region

            if labels is not None:
                getters = labels.external_getters(read_frame, ocr_reader=ocr_reader,
                    result_callback=lambda match: emit({
                        'event': 'script.image-result', 'labelName': match.label_name,
                        'hostTimestamp': time.time_ns() // 1_000_000, 'monotonicNs': str(time.perf_counter_ns()),
                        'score': match.score, 'scriptValue': match.script_value,
                        'location': match.location, 'rangeRect': match.range_rect, 'matchRect': match.match_rect,
                        'videoFrame': video_frame,
                    }))
            # Fail before controller.acquire when a required video source has
            # not published a usable frame yet.
            first_frame = read_frame()
            diagnostic_sink(kind='video.frame', videoFrame=video_frame)
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
        if config.get("audioDiagnostic") is True:
            # Log-only FRLG experiment. It consumes the existing audio owner's
            # PCM; never opens a device, changes ECS or waits for a verdict.
            try:
                from frlg_audio_diagnostic import AudioShinyDiagnostic
                audio_diagnostic = AudioShinyDiagnostic(sources, config.get("audio"),
                    Path(__file__).resolve().parents[1] / "assets/frlg-audio/shiny-effect-original.wav",
                    script_log,
                    comparison_path=Path(__file__).resolve().parents[1] / "assets/frlg-audio/shiny-effect-enhanced.wav")
            except Exception:
                script_log("【音频判闪·实验】无法启动检测；继续原有图像判闪流程")

        def observe(point):
            trace.record(point)
            if phases is not None:
                phases.observe(point)
            if audio_diagnostic is not None:
                try:
                    audio_diagnostic.observe(point)
                except Exception:
                    # Audio observation cannot fail a controller/RNG operation.
                    pass

        if config.get('diagnostics') is True:
            from frlg_diagnostics import PhaseDiagnostics
            phases = PhaseDiagnostics(sources, diagnostic_sink)
        reporter = threading.Thread(target=report_progress, daemon=True)
        reporter.start()
        program.run(gamepad=RemoteGamepad(), waiter=RemoteWaiter(), external_getters=getters,
                    extern_functions=extern_functions,
                    cancel_event=cancelled, output=script_log,
                    trace=observe)
    except ScriptCancelled:
        result["status"] = "cancelled"
    except Exception as error:
        result.update(status="failed", message=str(error), **error_details(error, config))
    finally:
        finished.set()
        if reporter is not None:
            reporter.join()
        publish_latest()
        if phases is not None:
            phases.close()
        if audio_diagnostic is not None:
            try:
                audio_diagnostic.close()
            except Exception:
                pass
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
        if config.get("audioDiagnostic") is True:
            # As with image/OCR dependencies below, initialize NumPy before
            # the Windows CRT stdin reader can block its native import.
            try:
                import numpy  # noqa: F401
            except ImportError:
                pass  # Optional audio diagnostics must not reject the script.
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
        or (Path(config["scriptDir"]) / "python_ocr_names.json").is_file()
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
            from frlg_planner.automation import frlg_ocr_names  # noqa: F401
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
