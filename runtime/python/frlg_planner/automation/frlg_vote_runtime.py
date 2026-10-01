"""Python session runtime for ``25_校准_投票决策.ecs``.

The ECS file is kept in ``lib/python_backup`` by the project generator.  Its
file-scope ``$V_*``/``$C_*`` arrays are represented here by an instance, so a
script run owns its state and no calibration value leaks into the next run.
The public callback names intentionally match the original functions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Mapping

from .frlg_compute_runtime import signed_round_division, candidate_mse


def _abs(value: int) -> int:
    return -value if value < 0 else value


def _trunc_div(left: int, right: int) -> int:
    quotient = abs(int(left)) // abs(int(right))
    return -quotient if (left < 0) != (right < 0) else quotient


def _cluster(samples: list[int], previous_window: int, *, frame_axis: bool = False) -> tuple[int, int]:
    """Return the closest densest cluster's rounded centre and radius."""
    if len(samples) < 2:
        return 0, 2
    radius = max(3, previous_window) if frame_axis else max(2, previous_window)
    best: tuple[int, int, int, int] | None = None
    for kernel in samples:
        cluster = [value for value in samples if _abs(value - kernel) <= radius]
        if best is None or len(cluster) > best[0] or (len(cluster) == best[0] and _abs(kernel) < _abs(best[2])):
            best = (len(cluster), sum(cluster), kernel, max(cluster) - min(cluster))
    assert best is not None
    centre = signed_round_division(best[1], best[0])
    spread = max(2, max(abs(value - centre) for value in samples if abs(value - best[2]) <= radius))
    return centre, min(10, spread)


@dataclass
class CalibrationVoteSession:
    """One script-run copy of the former ECS calibration state."""

    seed_runtime: object | None = None
    emit: Callable[[str], None] | None = None
    phase_half: int = 40
    phase_slots: int = 81
    ring_half: int = 0
    ring_slots: int = 1
    period: int = 0
    frame_vote_window: int = 2
    seed_vote_window: int = 1
    seed_half: int = 20
    seed_slots: int = 41
    stop_lead_threshold: int = 4
    stop_stable_rounds: int = 3
    phase_table: list[int] = field(default_factory=lambda: [0] * 315)
    ring_table: list[int] = field(default_factory=lambda: [0] * 13)
    seed_table: list[int] = field(default_factory=lambda: [0] * 41)
    joint_keys: list[int] = field(default_factory=list)
    joint_votes: list[int] = field(default_factory=list)
    frame_samples: list[int] = field(default_factory=list)
    seed_samples: list[int] = field(default_factory=list)
    ring_samples: list[int] = field(default_factory=list)
    seed_calibration_samples: list[int] = field(default_factory=list)
    sample_mean: int = 0
    seed_sample_mean: int = 0
    ring_sample_mean: int = 0
    phase_peak: int = 0
    phase_lead: int = 0
    phase_peak_slot: int = -1
    true_frame: int = 0
    ring_mode: int = 0
    seed_center: int = 0
    joint_lead: int = 0
    stable_count: int = 0
    last_best_slot: int = -1
    stop_flag: int = 0
    stop_reason: int = 0
    truth_streak: int = 0
    seed_calibration_target: int = 0
    seed_calibration_target_votes: int = 0
    # Common region (御三家) state.
    common_enabled: int = 0
    common_strict: int = 0
    common_rounds: list[list[tuple[int, int, int]]] = field(default_factory=list)
    common_current: list[tuple[int, int, int]] = field(default_factory=list)
    common_bad_round: int = 0
    common_submitted: int = 0
    common_usable: int = 0
    common_ambiguous: int = 0
    common_best_seed_low: int = 0
    common_best_seed_high: int = 0
    common_best_adv_low: int = 0
    common_best_adv_high: int = 0
    common_best_coverage: int = 0
    common_best_seed_span: int = 0
    common_best_adv_span: int = 0
    common_envelope_index_low: int = 0
    common_envelope_index_high: int = 0
    common_envelope_adv_low: int = 0
    common_envelope_adv_high: int = 0
    common_seed_span_limit: int = 100
    common_adv_span_limit: int = 30
    common_rank_enabled: int = 1

    def __post_init__(self) -> None:
        self.reset()

    def _phase_absolute(self, raw: int, frame_cumulative: int, tv: int) -> int:
        absolute = int(raw) + int(frame_cumulative)
        if tv == 1 and self.period > 0:
            k = signed_round_division(absolute, self.period)
            remainder = absolute - k * self.period
            if remainder == -self.phase_half:
                remainder = self.phase_half
            return remainder
        return absolute

    def set_config(self, phase_half: int, _phase_slots: int, ring_half: int, _ring_slots: int,
                   period: int, frame_window: int, seed_window: int, seed_half: int,
                   _seed_slots: int, stop_lead: int, stable_rounds: int) -> int:
        self.phase_half = max(1, min(157, int(phase_half)))
        self.phase_slots = self.phase_half * 2 + 1
        self.ring_half = max(0, min(6, int(ring_half)))
        self.ring_slots = self.ring_half * 2 + 1
        self.period = int(period)
        # ECS only clamps the physical half-widths above; the two vote-window
        # parameters are copied verbatim and are refined by the sample setters.
        self.frame_vote_window = int(frame_window)
        self.seed_vote_window = int(seed_window)
        self.seed_half = max(1, min(20, int(seed_half)))
        self.seed_slots = self.seed_half * 2 + 1
        self.stop_lead_threshold = int(stop_lead)
        self.stop_stable_rounds = int(stable_rounds)
        return 1

    def reset(self) -> int:
        self.phase_table = [0] * self.phase_slots
        self.ring_table = [0] * self.ring_slots
        self.seed_table = [0] * self.seed_slots
        self.joint_keys = []
        self.joint_votes = []
        self.frame_samples = []
        self.seed_samples = []
        self.ring_samples = []
        self.stable_count = 0
        self.last_best_slot = -1
        self.stop_flag = 0
        self.stop_reason = 0
        self.truth_streak = 0
        self.phase_peak = 0
        self.phase_lead = 0
        self.phase_peak_slot = -1
        self.true_frame = 0
        self.ring_mode = 0
        self.seed_center = 0
        self.joint_lead = 0
        self.common_current = []
        self.common_submitted = 0
        if not self.common_strict:
            self.common_reset()
        return 1

    def reset_seed_calibration(self) -> int:
        self.seed_calibration_samples = []
        self.seed_calibration_target = 0
        self.seed_calibration_target_votes = 0
        return 1

    def vote_candidate(self, seed_residual: int, frame_residual: int, seed_cumulative: int,
                       frame_cumulative: int, same_seed: int, tv: int, _tv_period: int) -> int:
        phase = self._phase_absolute(frame_residual, frame_cumulative, tv)
        phase_slot = phase + self.phase_half
        phase_valid = 0 <= phase_slot < self.phase_slots
        if phase_valid:
            self.phase_table[phase_slot] += 1
        absolute = int(frame_residual) + int(frame_cumulative)
        ring = signed_round_division(absolute, self.period) if tv == 1 and self.period > 0 else 0
        ring_slot = ring + self.ring_half
        if 0 <= ring_slot < self.ring_slots:
            self.ring_table[ring_slot] += 1
        seed_abs = int(seed_residual) + int(seed_cumulative)
        seed_slot = seed_abs + self.seed_half
        seed_valid = 0 <= seed_slot < self.seed_slots
        if seed_valid:
            self.seed_table[seed_slot] += 1
        if phase_valid:
            if same_seed:
                key = phase_slot
            elif seed_valid:
                key = seed_slot * self.phase_slots + phase_slot
            else:
                key = -1
            if key >= 0:
                try:
                    index = self.joint_keys.index(key)
                except ValueError:
                    if len(self.joint_keys) < 256:
                        self.joint_keys.append(key)
                        self.joint_votes.append(1)
                else:
                    self.joint_votes[index] += 1
        return 1

    def _best_slot(self, values: list[int], half: int, window: int) -> tuple[int, int, int]:
        best_slot, best_stack, best_distance = -1, 0, 2**31 - 1
        for slot, value in enumerate(values):
            if value <= 0:
                continue
            stack = sum(values[max(0, slot - window): min(len(values), slot + window + 1)])
            distance = abs(slot - half)
            if stack > best_stack or (stack == best_stack and distance < best_distance):
                best_slot, best_stack, best_distance = slot, stack, distance
        return best_slot, best_stack, best_distance

    def decide(self, tv: int, frame_cumulative: int, seed_cumulative: int) -> int:
        phase_slot, peak, _ = self._best_slot(self.phase_table, self.phase_half, self.frame_vote_window)
        if phase_slot < 0:
            return 0
        self.phase_peak_slot = phase_slot
        self.phase_peak = peak
        self.phase_lead = peak
        second = 0
        for slot, value in enumerate(self.phase_table):
            if value and abs(slot - phase_slot) > self.frame_vote_window:
                second = max(second, sum(self.phase_table[max(0, slot - self.frame_vote_window): min(len(self.phase_table), slot + self.frame_vote_window + 1)]))
        self.phase_lead = peak - second
        ring_slot, _, _ = self._best_slot(self.ring_table, self.ring_half, 0)
        self.ring_mode = ring_slot - self.ring_half if ring_slot >= 0 else 0
        if self.frame_samples:
            self.sample_mean, self.frame_vote_window = _cluster(self.frame_samples, self.frame_vote_window, frame_axis=True)
        if self.seed_samples:
            self.seed_sample_mean, self.seed_vote_window = _cluster(self.seed_samples, self.seed_vote_window)
        if self.ring_samples:
            self.ring_sample_mean, _ = _cluster(self.ring_samples, 2)
        self.seed_center = self.seed_sample_mean - int(seed_cumulative)
        self.true_frame = ((self.ring_sample_mean if tv and self.period > 0 and len(self.ring_samples) >= 2 else self.ring_mode) * self.period + (phase_slot - self.phase_half) - int(frame_cumulative)) if tv and self.period > 0 else self.sample_mean
        self.joint_lead = (max(self.joint_votes) if self.joint_votes else 0) - (sorted(self.joint_votes)[-2] if len(self.joint_votes) > 1 else 0)
        return 1

    def update_stop(self) -> int:
        if self.truth_streak >= 2:
            self.stop_reason, self.stop_flag = 1, 1
            return 1
        stable_rounds = max(2, min(4, signed_round_division(self.frame_vote_window, 2)))
        denominator = self.phase_peak * 2 - self.phase_lead
        ratio = self.phase_peak * 100 // denominator if self.phase_peak and denominator > 0 else 0
        if self.phase_peak_slot == self.last_best_slot and ratio >= 70:
            self.stable_count += 1
        else:
            self.stable_count = 1
            self.last_best_slot = self.phase_peak_slot
        if self.stable_count >= stable_rounds:
            self.stop_reason, self.stop_flag = 2, 1
            return 1
        self.stop_flag = 0
        return 0

    def remember_truth(self, truth: int, distance: int) -> int:
        self.truth_streak = self.truth_streak + 1 if truth and distance <= self.frame_vote_window else (1 if truth else 0)
        return 1

    def set_frame_window(self, raw: int, cumulative: int, tv: int) -> int:
        self.frame_samples.append(self._phase_absolute(raw, cumulative, tv))
        self.frame_samples = self.frame_samples[-6:]
        if len(self.frame_samples) < 2:
            self.sample_mean, self.frame_vote_window = 0, 2
        else:
            self.sample_mean, self.frame_vote_window = _cluster(self.frame_samples, self.frame_vote_window, frame_axis=True)
        return 1

    def set_seed_window(self, raw: int, cumulative: int) -> int:
        self.seed_samples.append(int(raw) + int(cumulative))
        self.seed_samples = self.seed_samples[-6:]
        if len(self.seed_samples) < 2:
            self.seed_sample_mean, self.seed_vote_window = 0, 2
        else:
            self.seed_sample_mean, self.seed_vote_window = _cluster(self.seed_samples, self.seed_vote_window)
        return 1

    def set_seed_calibration(self, raw: int, cumulative: int) -> int:
        self.seed_calibration_samples.append(int(raw) + int(cumulative))
        self.seed_calibration_samples = self.seed_calibration_samples[-12:]
        counts: dict[int, int] = {}
        for value in self.seed_calibration_samples:
            counts[value] = counts.get(value, 0) + 1
        best = max(counts, key=lambda value: (counts[value], -abs(value - self.seed_sample_mean), -abs(value - self.seed_calibration_target), -abs(value)))
        self.seed_calibration_target = best
        self.seed_calibration_target_votes = counts[best]
        return 1

    def set_ring_window(self, raw: int, cumulative: int, tv: int) -> int:
        if not tv or self.period <= 0:
            return 1
        self.ring_samples.append(signed_round_division(int(raw) + int(cumulative), self.period))
        self.ring_samples = self.ring_samples[-6:]
        self.ring_sample_mean, window = _cluster(self.ring_samples, 2)
        self.ring_vote_window = window
        return 1

    def _outlier(self, value: int, centre: int, window: int, samples: int) -> int:
        return int(samples >= 2 and self.phase_peak > 1 and abs(value - centre) > window * 3)

    def candidate_outlier(self, raw: int, cumulative: int, tv: int) -> int:
        return self._outlier(self._phase_absolute(raw, cumulative, tv), self.sample_mean, self.frame_vote_window, len(self.frame_samples))

    def seed_outlier(self, raw: int, cumulative: int) -> int:
        return int(len(self.seed_samples) >= 2 and abs(int(raw) + int(cumulative) - self.seed_sample_mean) > self.seed_vote_window * 3)

    def tv_outlier(self, raw: int, cumulative: int, tv: int) -> int:
        if not tv or self.period <= 0:
            return 0
        value = signed_round_division(int(raw) + int(cumulative), self.period)
        return int(len(self.ring_samples) >= 2 and abs(value - self.ring_sample_mean) > self.ring_vote_window * 3)

    def candidate_stack(self, raw: int, cumulative: int, tv: int) -> int:
        slot = self._phase_absolute(raw, cumulative, tv) + self.phase_half
        if not 0 <= slot < self.phase_slots:
            return 0
        return sum(self.phase_table[max(0, slot - self.frame_vote_window): min(self.phase_slots, slot + self.frame_vote_window + 1)])

    # ---- Common region -------------------------------------------------
    def common_reset(self) -> int:
        self.common_rounds = []
        self.common_current = []
        self.common_bad_round = 0
        self.common_submitted = 0
        self.common_usable = 0
        self.common_ambiguous = 0
        self.common_best_coverage = 0
        return 1

    def common_start(self) -> int:
        if not self.common_enabled:
            return 1
        self.common_current = []
        self.common_bad_round = 0
        self.common_submitted = 0
        return 1

    def common_set_strict(self, enabled: int) -> int:
        self.common_enabled = int(enabled == 1)
        self.common_strict = self.common_enabled
        if not self.common_enabled:
            self.common_reset()
        return 1

    def common_collect_pair(self, ms: int, adv: int, index: int) -> int:
        if not self.common_enabled:
            return 0
        pair = (int(ms), int(adv), int(index))
        if pair in self.common_current:
            return 1
        if len(self.common_current) >= 200:
            self.common_bad_round = 1
            return 0
        self.common_current.append(pair)
        self.common_current.sort()
        return 1

    def common_collect(self, game: int, actual_index: int, seed_cumulative: int, actual_adv: int, frame_cumulative: int, platform_ms: int) -> int:
        if not self.common_enabled or self.seed_runtime is None:
            return 0
        index = int(actual_index) + int(seed_cumulative)
        try:
            max_index = int(self.seed_runtime.get_max_index(game))
            ms = int(self.seed_runtime.get_ms(game, index)) + int(platform_ms)
        except AttributeError:
            return 0
        if index < 0 or index > max_index:
            self.common_bad_round = 1
            return 0
        return self.common_collect_pair(ms, int(actual_adv) + int(frame_cumulative), index)

    def common_submit(self) -> int:
        if not self.common_enabled:
            self.common_current = []
            return 0
        if self.common_submitted:
            return 0
        self.common_submitted = 1
        if self.common_bad_round or not self.common_current:
            self.common_usable = 0
            return 0
        if self.common_current in self.common_rounds:
            return 0
        self.common_rounds.append(list(self.common_current))
        self._recompute_common()
        return 1

    def _recompute_common(self) -> None:
        if not self.common_rounds:
            self.common_usable = 0
            return
        points = [
            (int(seed), int(adv), int(index), round_id)
            for round_id, round_pairs in enumerate(self.common_rounds)
            for seed, adv, index in round_pairs
        ]
        best: tuple[tuple[int, int, int, int], list[tuple[int, int, int, int]], int] | None = None
        # This mirrors the ECS two-view sweep: choose a Seed rectangle first,
        # then a minimum-width ADV window with the same number of covered
        # rounds, and finally minimize the Seed span inside that window.
        for seed_low in sorted({point[0] for point in points}):
            seed_high = seed_low + self.common_seed_span_limit
            y_points = sorted((point for point in points if seed_low <= point[0] <= seed_high), key=lambda point: (point[1], point[0], point[2]))
            counts = [0] * len(self.common_rounds)
            left = 0
            coverage = 0
            for right, point in enumerate(y_points):
                round_id = point[3]
                if counts[round_id] == 0:
                    coverage += 1
                counts[round_id] += 1
                while left <= right and point[1] - y_points[left][1] > self.common_adv_span_limit and counts[y_points[left][3]] <= 1:
                    counts[y_points[left][3]] -= 1
                    if counts[y_points[left][3]] == 0:
                        coverage -= 1
                    left += 1
                if coverage == 0:
                    continue
                window = y_points[left:right + 1]
                x_points = sorted(window, key=lambda item: (item[0], item[1], item[2]))
                x_counts = [0] * len(self.common_rounds)
                x_left = 0
                x_coverage = 0
                for x_right, x_point in enumerate(x_points):
                    x_round = x_point[3]
                    if x_counts[x_round] == 0:
                        x_coverage += 1
                    x_counts[x_round] += 1
                    while x_left <= x_right and x_coverage == coverage and x_counts[x_points[x_left][3]] > 1:
                        x_counts[x_points[x_left][3]] -= 1
                        x_left += 1
                    if x_coverage != coverage:
                        continue
                    selected = x_points[x_left:x_right + 1]
                    actual_window = [item for item in selected if item[0] <= x_point[0]]
                    if not actual_window:
                        continue
                    actual_seed_low = min(item[0] for item in actual_window)
                    actual_seed_high = max(item[0] for item in actual_window)
                    actual_adv_low = min(item[1] for item in actual_window)
                    actual_adv_high = max(item[1] for item in actual_window)
                    # The common-region contract is a bounded rectangle;
                    # duplicate candidates may keep an ECS sweep alive past
                    # the bound, but that rectangle must not become the
                    # selected explanation.
                    if actual_adv_high - actual_adv_low > self.common_adv_span_limit:
                        continue
                    key = (x_coverage, -(actual_adv_high - actual_adv_low), -(actual_seed_high - actual_seed_low), -actual_seed_low)
                    if best is None or key > best[0]:
                        best = (key, actual_window, x_coverage)
        if best is None:
            self.common_usable = 0
            return
        _, window, coverage = best
        self.common_best_coverage = coverage
        self.common_best_seed_low = min(pair[0] for pair in window)
        self.common_best_seed_high = max(pair[0] for pair in window)
        self.common_best_adv_low = min(pair[1] for pair in window)
        self.common_best_adv_high = max(pair[1] for pair in window)
        self.common_best_seed_span = self.common_best_seed_high - self.common_best_seed_low
        self.common_best_adv_span = self.common_best_adv_high - self.common_best_adv_low
        self.common_envelope_index_low = min(pair[2] for pair in window)
        self.common_envelope_index_high = max(pair[2] for pair in window)
        self.common_envelope_adv_low = self.common_best_adv_low
        self.common_envelope_adv_high = self.common_best_adv_high
        self.common_usable = int(self.common_rank_enabled and coverage >= 3 and coverage * 2 > len(self.common_rounds))

    def common_select(self) -> int:
        if not self.common_enabled or self.common_bad_round or not self.common_current:
            return -1
        if len(self.common_current) == 1:
            return 0
        if not self.common_usable:
            return -1
        matches = [i for i, pair in enumerate(self.common_current) if self.common_best_seed_low <= pair[0] <= self.common_best_seed_high and self.common_best_adv_low <= pair[1] <= self.common_best_adv_high]
        return matches[0] if len(matches) == 1 else -1

    def common_predict_adv(self, default_adv: int, cumulative: int) -> int:
        if self.common_enabled and self.common_usable and not self.common_bad_round:
            return _trunc_div(self.common_best_adv_low + self.common_best_adv_high, 2) - int(cumulative)
        return int(default_adv) - int(cumulative)

    def common_index(self, slot: int) -> int:
        return self.common_current[int(slot)][2]

    def common_adv(self, slot: int) -> int:
        return self.common_current[int(slot)][1]

    def common_distance(self, index: int, adv: int, seed_weight: int, adv_weight: int) -> int:
        if not self.common_enabled or not self.common_usable or self.common_bad_round:
            return 0
        dx = max(self.common_envelope_index_low - index, 0, index - self.common_envelope_index_high)
        dy = max(self.common_envelope_adv_low - adv, 0, adv - self.common_envelope_adv_high)
        return candidate_mse(dx, dy, seed_weight, adv_weight)

    def getter(self, name: str, *args: int) -> int:
        mapping = {
            "投票取停糖原因": lambda: self.stop_reason,
            "投票取帧中心": lambda: self.sample_mean,
            "投票取剩余帧中心": lambda: self.sample_mean % self.period if self.period > 0 else self.sample_mean,
            "投票取动态窗": lambda: self.frame_vote_window,
            "投票取剩余帧动态窗": lambda: self.frame_vote_window,
            "投票取剩余帧样本数": lambda: len(self.frame_samples),
            "投票取Seed动态窗": lambda: self.seed_vote_window,
            "投票取Seed样本数": lambda: len(self.seed_samples),
            "投票取圈动态窗": lambda: getattr(self, "ring_vote_window", 2),
            "投票取TV帧中心": lambda: self.ring_sample_mean,
            "投票取TV帧动态窗": lambda: getattr(self, "ring_vote_window", 2),
            "投票取TV帧样本数": lambda: len(self.ring_samples),
            "投票取真帧": lambda: self.true_frame,
            "投票取帧领先": lambda: self.phase_lead,
            "投票取帧最高堆": lambda: self.phase_peak,
            "投票取稳定计数": lambda: self.stable_count,
            "投票取Seed中心": lambda: self.seed_center,
            "投票取Seed绝对中心": lambda: self.seed_sample_mean,
            "投票取Seed校准目标": lambda: self.seed_calibration_target,
            "投票取Seed校准目标票数": lambda: self.seed_calibration_target_votes,
            "投票取Seed校准样本数": lambda: len(self.seed_calibration_samples),
            "投票取联合领先": lambda: self.joint_lead,
        }
        if name in mapping:
            return int(mapping[name]())
        if name == "共同区选择本轮配对": return self.common_select()
        if name == "共同区取本轮索引": return self.common_index(args[0])
        if name == "共同区取本轮ADV": return self.common_adv(args[0])
        return 0

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        f: dict[str, Callable[..., object]] = {
            "共同区重置": self.common_reset, "共同区开始扫描": self.common_start,
            "共同区设置严格模式": self.common_set_strict, "共同区选择本轮配对": self.common_select,
            "共同区取本轮索引": self.common_index, "共同区取本轮ADV": self.common_adv,
            "共同区预测ADV": self.common_predict_adv, "共同区收集": self.common_collect,
            "共同区收集配对": self.common_collect_pair, "共同区提交": self.common_submit,
            "共同区重算": lambda: self._recompute_common() or 1,
            "共同区排序": lambda _axis: 1, "共同区记录解释包络": lambda: 1,
            "共同区评价矩形": lambda: 1, "共同区记录最优窗口": lambda: 1,
            "共同区候选加权距离": self.common_distance, "共同区打印": lambda: 1,
            "投票设置配置": self.set_config, "投票重置": self.reset,
            "投票重置Seed校准": self.reset_seed_calibration,
            "投票投候选": self.vote_candidate, "投票决策": self.decide,
            "投票更新停糖": self.update_stop, "投票记真值解": self.remember_truth,
            "算相位绝对": self._phase_absolute, "投票查候选票堆": self.candidate_stack,
            "投票候选是否离群": self.candidate_outlier, "投票TV帧候选是否离群": self.tv_outlier,
            "投票设置帧窗": self.set_frame_window, "投票设置Seed窗": self.set_seed_window,
            "投票设置Seed校准样本": self.set_seed_calibration, "投票Seed候选是否离群": self.seed_outlier,
            "投票设置圈窗": self.set_ring_window, "投票设置TV帧窗": self.set_ring_window,
            "投票打印直方图": lambda _tv: 1,
        }
        for name in ("投票取停糖原因", "投票取帧中心", "投票取剩余帧中心", "投票取动态窗", "投票取剩余帧动态窗", "投票取剩余帧样本数", "投票取Seed动态窗", "投票取Seed样本数", "投票取圈动态窗", "投票取TV帧中心", "投票取TV帧动态窗", "投票取TV帧样本数", "投票取真帧", "投票取帧领先", "投票取帧最高堆", "投票取稳定计数", "投票取Seed中心", "投票取Seed绝对中心", "投票取Seed校准目标", "投票取Seed校准目标票数", "投票取Seed校准样本数", "投票取联合领先"):
            f[name] = lambda *args, _name=name: self.getter(_name, *args)
        return f


def extern_functions(*, seed_runtime: object | None = None, emit: Callable[[str], None] | None = None) -> dict[str, Callable[..., object]]:
    return CalibrationVoteSession(seed_runtime=seed_runtime, emit=emit).extern_functions()


__all__ = ["CalibrationVoteSession", "extern_functions"]
