"""Experimental, log-only opponent shiny audio observation.

No controller calls, ECS edits or encounter decisions belong here. Source-line
bindings deliberately cover only the audited ordinary wild lib17 entry points.
Unknown revisions and incomplete audio produce 'unknown', never 'not shiny'.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
import re
import threading
import time
import wave


@dataclass(frozen=True)
class EncounterGate:
    source: str
    name: str
    first: int
    last: int
    start: int
    end: int
    wait_ms: int


def encounter_gates(sources):
    gates = []
    waits = {"甜甜香气": 10000, "碎岩": 8500, "钓鱼": 5500}
    for source, lines in sources.items():
        if Path(source).name != "17_获取_野生目标.ecs":
            continue
        for first, line in enumerate(lines):
            match = re.match(r"^FUNC\s+(\S+?)\(", line)
            if not match or match[1] not in waits:
                continue
            last = next((i for i in range(first + 1, len(lines))
                         if lines[i].strip() == "ENDFUNC"), len(lines))
            starts = [i for i in range(first, last)
                      if lines[i].strip() == f"WAIT {waits[match[1]]}"]
            ends = [i for i in range(first, last)
                    if "= 识别抓捕对象名称优先OCR(" in lines[i]]
            checks = [i for i in range(first, last) if "= CheckCaptureShiny(" in lines[i]]
            # Reject ambiguous upstream layout instead of extending into our
            # own Pokémon's entrance or silently using another wait interval.
            if len(starts) == len(ends) == len(checks) == 1 and starts[0] < ends[0] < checks[0]:
                gates.append(EncounterGate(source, match[1], first + 1, last + 1,
                                           starts[0] + 1, ends[0] + 1, waits[match[1]]))
    return gates


def spectral_features(samples, sample_rate):
    import numpy as np
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim == 2:
        # Power is combined later; averaging waveforms can cancel stereo audio.
        return np.mean([spectral_features(samples[:, i], sample_rate)
                        for i in range(samples.shape[1])], axis=0)
    target_rate, size, hop = 8000, 256, 80
    count = round(len(samples) * target_rate / sample_rate)
    samples = np.interp(np.arange(count) * sample_rate / target_rate,
                        np.arange(len(samples)), samples)
    if len(samples) < size:
        raise ValueError("音频长度不足")
    frames = np.lib.stride_tricks.sliding_window_view(samples, size)[::hop]
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(size), axis=1))
    features = np.log1p(spectrum * 20)[:, 3:]  # Ignore DC / low-frequency hum.
    features -= features.mean(axis=1, keepdims=True)
    norms = np.linalg.norm(features, axis=1, keepdims=True)
    return (features / np.maximum(norms, 1e-8)).astype(np.float32)


def template_score(samples, sample_rate, reference, reference_rate):
    import numpy as np
    actual, expected = spectral_features(samples, sample_rate), spectral_features(reference, reference_rate)
    if len(actual) < len(expected):
        raise ValueError("窗口短于参考音效")
    # Correlate the sequence of spectral fingerprints, rather than volume peaks
    # or one frequency. The provisional score is diagnostic, not calibrated.
    scores = sum(np.correlate(actual[:, i], expected[:, i], "valid")
                 for i in range(actual.shape[1])) / len(expected)
    index = int(np.argmax(scores))
    return float(scores[index]), index * 0.01


def load_reference(path):
    import numpy as np
    if not path or not Path(path).is_file():
        return None
    with wave.open(str(path), "rb") as reader:
        rate, channels = reader.getframerate(), reader.getnchannels()
        if reader.getsampwidth() != 2 or not 1 <= channels <= 2 or not 8000 <= rate <= 192000:
            raise ValueError("参考音效需为16位PCM WAV，单声道或双声道")
        if not 0.15 <= reader.getnframes() / rate <= 3:
            raise ValueError("参考音效需截取0.15至3秒的闪光音效")
        samples = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2")
        samples = samples.reshape(-1, channels).astype(np.float32) / 32768
        if float(np.max(np.abs(samples))) < 0.001:
            raise ValueError("参考音效为静音")
        return samples, rate


def evaluate_window(blocks, start_ns, end_ns, reference, failure=None, comparison=None):
    import numpy as np
    if failure:
        return {"result": "unknown", "reason": failure}
    relevant = [b for b in blocks if b.timestamp_ns < end_ns
                and b.timestamp_ns + b.frames * 1_000_000_000 // b.sample_rate > start_ns]
    if not relevant:
        return {"result": "unknown", "reason": "窗口内没有音频数据"}
    parts, prior_end, covered_start = [], None, None
    for block in relevant:
        if block.skipped or block.discontinuity or block.timestamp_error:
            return {"result": "unknown", "reason": "音频缺块或时间戳不可靠"}
        if block.sample_rate != relevant[0].sample_rate or block.channels != relevant[0].channels:
            return {"result": "unknown", "reason": "音频格式变化"}
        stop = block.timestamp_ns + block.frames * 1_000_000_000 // block.sample_rate
        if prior_end is not None and abs(block.timestamp_ns - prior_end) > 50_000_000:
            return {"result": "unknown", "reason": "音频时间不连续"}
        prior_end = stop
        covered_start = block.timestamp_ns if covered_start is None else covered_start
        # Discard boundary samples, including post-cutoff player entrance audio.
        first = max(0, (start_ns - block.timestamp_ns) * block.sample_rate // 1_000_000_000 + 1)
        last = min(block.frames, (end_ns - block.timestamp_ns) * block.sample_rate // 1_000_000_000)
        if last > first:
            parts.append(np.frombuffer(block.pcm, dtype="<f4").reshape(-1, block.channels)[first:last])
    if covered_start > start_ns + 150_000_000 or prior_end < end_ns - 150_000_000 or not parts:
        return {"result": "unknown", "reason": "音频未覆盖完整遭遇窗口"}
    samples = np.concatenate(parts)
    if not np.isfinite(samples).all():
        return {"result": "unknown", "reason": "音频样本无效"}
    details = {"seconds": round(len(samples) / relevant[0].sample_rate, 3),
               "peak": round(float(np.max(np.abs(samples))), 4)}
    if details["peak"] < 0.001:
        return {**details, "result": "unknown", "reason": "音频静音或音量过低"}
    if reference is None:
        return {**details, "result": "unknown", "reason": "缺少已确认的闪光参考音效"}
    try:
        score, offset = template_score(samples, relevant[0].sample_rate, *reference)
    except ValueError as error:
        return {**details, "result": "unknown", "reason": str(error)}
    details.update(score=round(score, 4), offset_seconds=round(offset, 3))
    if comparison is not None:
        alternate, alternate_offset = template_score(samples, relevant[0].sample_rate, *comparison)
        details["enhanced_score"] = round(alternate, 4)
        details["enhanced_offset_seconds"] = round(alternate_offset, 3)
    return {**details, "result": "candidate" if score >= 0.85 else "not_detected"}


class AudioShinyDiagnostic:
    def __init__(self, sources, descriptor, reference_path, output, *, reader=None, comparison_path=None):
        self.gates = encounter_gates(sources)
        self.output = output
        self.active = None
        self.number = 0
        self.lock = threading.Lock()
        self.jobs = deque()
        self.blocks = deque()
        self.buffer_bytes = 0
        self.stop_event = threading.Event()
        self.failure = None
        self.reference = None
        self.comparison = None
        self.reader = reader
        self.thread = None
        try:
            self.reference = load_reference(reference_path)
            self.comparison = load_reference(comparison_path)
            if reader is None:
                from audio import Audio
                self.reader = Audio(descriptor or {})
        except Exception:
            self.failure = "音频源未连接或参考音效无效"
        if self.reader is not None and self.gates:
            self.thread = threading.Thread(target=self._worker, daemon=True)
            self.thread.start()
        status = self.failure or ("参考音效已加载；匹配阈值尚待实机验证" if self.reference is not None
                                  else "缺少已确认的闪光参考音效，暂输出采样状态和无法判定")
        output(f"【音频判闪·实验】{status}；仅观察普通野生遭遇，不参与抓捕或停止决策")
        if not self.gates:
            output("【音频判闪·实验】未找到已核对的普通野生采样位置，跳过检测")

    def observe(self, point):
        if self.active:
            _, gate, _ = self.active
            if point.location.source != gate.source or not gate.first <= point.location.line <= gate.last:
                self._finish("遭遇窗口未正常结束")
            elif point.location.line == gate.end:
                self._finish()
        for gate in self.gates:
            if (point.location.source == gate.source and point.location.line == gate.start
                    and point.duration_ms == gate.wait_ms and self.active is None):
                self.number += 1
                self.active = (self.number, gate, time.perf_counter_ns())
                # No I/O or logging on this hot path; detection runs off-thread.
                break

    def _finish(self, reason=None):
        number, gate, start = self.active
        self.active = None
        job = (number, gate.name, start, time.perf_counter_ns(), reason, time.monotonic() + 0.25)
        with self.lock:
            self.jobs.append(job)

    def _report(self, job, blocks):
        number, name, start, end, reason, _ = job
        result = evaluate_window(blocks, start, end, self.reference, reason or self.failure, self.comparison)
        labels = {"unknown": "无法判定", "candidate": "检出闪光音效候选", "not_detected": "未检出闪光音效"}
        fields = [f"窗口={number}", f"遭遇={name}", "截止=名称识别前", labels[result["result"]],
                  f"start_qpc_ns={start}", f"end_qpc_ns={end}",
                  f"window_seconds={(end - start) / 1e9:.3f}"]
        relevant = [b for b in blocks if b.timestamp_ns < end
                    and b.timestamp_ns + b.frames * 1_000_000_000 // b.sample_rate > start]
        fields.append(f"packet_count={len(relevant)}")
        if relevant:
            fields.extend((f"first_packet_qpc_ns={relevant[0].timestamp_ns}",
                f"last_packet_end_qpc_ns={relevant[-1].timestamp_ns + relevant[-1].frames * 1_000_000_000 // relevant[-1].sample_rate}",
                f"sample_rate={relevant[0].sample_rate}", f"channels={relevant[0].channels}",
                f"skipped_packets={sum(b.skipped for b in relevant)}",
                f"discontinuities={sum(bool(b.discontinuity) for b in relevant)}",
                f"timestamp_errors={sum(bool(b.timestamp_error) for b in relevant)}"))
        fields.extend(f"{key}={value}" for key, value in result.items() if key != "result")
        self.output("【音频判闪·实验】" + "；".join(fields))

    def _worker(self):
        try:
            # Establish a cursor at current audio; never replay the two-second
            # native cache (which might include the preceding player's shiny).
            self.reader.read(next_block=False, timeout=0.4)
            while not self.stop_event.is_set():
                if not self.failure:
                    try:
                        block = self.reader.read(timeout=0.4)
                        if block is not None:
                            self.blocks.append(block)
                            self.buffer_bytes += len(block.pcm)
                            while self.blocks and (block.timestamp_ns - self.blocks[0].timestamp_ns > 14_000_000_000
                                                   or len(self.blocks) > 1400
                                                   or self.buffer_bytes > 16 * 1024 * 1024):
                                self.buffer_bytes -= len(self.blocks.popleft().pcm)
                    except Exception:
                        self.failure = "音频读取失败或会话已变化"
                else:
                    self.stop_event.wait(0.02)
                self._flush_ready()
        except Exception:
            self.failure = "音频读取失败或会话已变化"
            while not self.stop_event.wait(0.02):
                self._flush_ready()
        finally:
            self._flush_ready(force=True)

    def _flush_ready(self, force=False):
        while True:
            with self.lock:
                if not self.jobs or (not force and self.jobs[0][-1] > time.monotonic()):
                    return
                job = self.jobs.popleft()
            try:
                self._report(job, list(self.blocks))
            except Exception:
                self.output(f"【音频判闪·实验】窗口={job[0]}；无法判定；检测器异常")

    def close(self):
        if self.active:
            self._finish("脚本结束前未完成遭遇窗口")
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=0.8)
        else:
            self._flush_ready(force=True)
