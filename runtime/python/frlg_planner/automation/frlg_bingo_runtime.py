"""Python runtime for the pure state and rendering logic in ``24_显示_BINGO``.

The generated ECS library keeps only same-signature ``EXTERN`` declarations.
All counters, prediction windows and dead-zone decisions live in this object,
so BINGO state is reset with the script run and cannot leak through ECS global
variables.  ``emit`` is deliberately a small log callback: it replaces the
original ECS ``PRINT`` calls without moving device/OCR work into Python.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


_AXIS = tuple(range(-4, 5))
_DIGITS = ("０", "１", "２", "３", "４", "５", "６", "７", "８", "９")
_CIRCLED = ("①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨")


@dataclass
class BingoSession:
    """One script-run copy of the former BINGO ECS state."""

    emit: Callable[[str], None] | None = None
    counts: list[list[int]] = field(default_factory=lambda: [[0] * 9 for _ in range(9)])
    tv_counts: list[int] = field(default_factory=lambda: [0] * 9)
    seed_difference: int = 0
    frame_difference: int = 0
    count: int = 0
    row_offset: int = 0
    seed_text: list[str] = field(default_factory=lambda: [""] * 9)
    cell: str = ""
    row_text: str = ""
    hit_seed_offset: int = 0
    hit_frame_error: int = 0
    frame_dead_zone: int = 0
    frame_dead_zone_negative: int = 0
    frame_dead_zone_positive: int = 0
    seed_tolerance: int = 0
    seed_dead_zone: int = 0
    seed_dead_zone_negative: int = 0
    seed_dead_zone_positive: int = 0
    target_index: int = 0
    seed_max_index: int = 0
    game: int = 0
    seed_mode: int = 0
    enter_tv: int = 0
    tv_frame_cost: int = 0
    tv_positive_rounds: int = 0
    tv_negative_rounds: int = 0
    cluster_seed_center: int = 0
    cluster_seed_radius: int = 0
    cluster_frame_center: int = 0
    cluster_frame_radius: int = 0
    tv_enabled: int = 0
    tv_current: int = 0
    tv_prediction: int = 0
    tv_prediction_radius: int = 0
    tv_current_in_range: int = 0
    tv_column: int = 0
    tv_cell: str = ""
    stable_threshold: int = 5
    stable_type: int = 0
    stable_seed_difference: int = 0
    stable_frame_difference: int = 0
    stable_count: int = 0
    stable_result: int = 0

    def _print(self, value: object = "") -> None:
        if self.emit is not None:
            # EasyCon's PRINT callback receives a line terminator.  Preserve
            # that contract so the host log and the original ECS log have the
            # same line boundaries.
            self.emit(str(value) + "\n")

    def set_context(self, hit_seed: int, hit_frame: int, frame_zone: int,
                    frame_negative: int, frame_positive: int, seed_tolerance: int,
                    target_index: int, seed_max_index: int, game: int, seed_mode: int,
                    enter_tv: int, tv_cost: int, tv_positive: int, tv_negative: int) -> int:
        self.hit_seed_offset = int(hit_seed)
        self.hit_frame_error = int(hit_frame)
        self.frame_dead_zone = int(frame_zone)
        self.frame_dead_zone_negative = int(frame_negative)
        self.frame_dead_zone_positive = int(frame_positive)
        self.seed_tolerance = int(seed_tolerance)
        self.target_index = int(target_index)
        self.seed_max_index = int(seed_max_index)
        self.game = int(game)
        self.seed_mode = int(seed_mode)
        self.enter_tv = int(enter_tv)
        self.tv_frame_cost = int(tv_cost)
        self.tv_positive_rounds = int(tv_positive)
        self.tv_negative_rounds = int(tv_negative)
        self.current_in_range = 0
        self.tv_current_in_range = 0
        return 1

    @property
    def current_in_range(self) -> int:
        return getattr(self, "_current_in_range", 0)

    @current_in_range.setter
    def current_in_range(self, value: int) -> None:
        self._current_in_range = int(value)

    def set_cluster(self, seed_center: int, seed_radius: int,
                    frame_center: int, frame_radius: int) -> int:
        self.cluster_seed_center = int(seed_center)
        self.cluster_seed_radius = int(seed_radius)
        self.cluster_frame_center = int(frame_center)
        self.cluster_frame_radius = int(frame_radius)
        return 1

    def set_tv_axis(self, enabled: int, current: int, prediction: int, radius: int) -> int:
        self.tv_enabled = int(enabled)
        self.tv_current = int(current)
        self.tv_prediction = int(prediction)
        self.tv_prediction_radius = int(radius)
        self.tv_current_in_range = 0
        return 1

    def set_seed_text(self, *values: str) -> int:
        self.seed_text = [str(value) for value in values[:9]]
        self.seed_text += [""] * (9 - len(self.seed_text))
        return 1

    def normalize_frame(self, raw: int) -> int:
        raw = int(raw)
        if self.enter_tv == 1:
            for k in range(-1 - self.tv_negative_rounds, 2 + self.tv_positive_rounds):
                if k == 0:
                    continue
                centre = k * self.tv_frame_cost
                if centre - 4 <= raw <= centre + 4:
                    return raw - centre
        return raw

    def _in_axis(self, value: int) -> bool:
        return -4 <= int(value) <= 4

    def _cell_count(self, seed: int | None = None, frame: int | None = None) -> int:
        seed = self.seed_difference if seed is None else int(seed)
        frame = self.frame_difference if frame is None else int(frame)
        if not self._in_axis(seed) or not self._in_axis(frame):
            return 0
        return self.counts[seed + 4][frame + 4]

    def read_count(self) -> int:
        self.count = self._cell_count()
        return self.count

    def add_count(self) -> int:
        if self._in_axis(self.seed_difference) and self._in_axis(self.frame_difference):
            self.counts[self.seed_difference + 4][self.frame_difference + 4] += 1
        self.count = self._cell_count()
        return self.count

    def record_hit(self) -> int:
        if not self._in_axis(self.hit_seed_offset):
            return 0
        self.seed_difference = self.hit_seed_offset
        self.frame_difference = self.normalize_frame(self.hit_frame_error)
        if not self._in_axis(self.frame_difference):
            return 0
        if self.enter_tv == 1 and self.hit_frame_error != self.frame_difference:
            self._print("")
            self._print("【BINGO TV归一化】")
            self._print(f"原始帧误差: {self.hit_frame_error} 帧")
            self._print(f"归一化帧偏移: {self.frame_difference} 帧")
        self.add_count()
        self.current_in_range = 1
        return 1

    def record_tv_hit(self) -> int:
        if self.tv_enabled == 0 or not self._in_axis(self.tv_current):
            self.tv_current_in_range = 0
            return 0
        self.tv_counts[self.tv_current + 4] += 1
        self.tv_current_in_range = 1
        return 1

    def get_seed_dead_zone(self, value: int) -> int:
        self.seed_dead_zone = int(value)
        self.seed_dead_zone_negative = int(value)
        self.seed_dead_zone_positive = int(value)
        return 0

    def get_seed_one_sided_dead_zone(self, negative: int, positive: int) -> int:
        self.seed_dead_zone = max(int(negative), int(positive))
        self.seed_dead_zone_negative = int(negative)
        self.seed_dead_zone_positive = int(positive)
        return 0

    def current_hit_in_table(self) -> int:
        return self.current_in_range

    def current_hit_in_dead_zone(self) -> int:
        if not self.current_in_range:
            return 0
        if not (self.seed_dead_zone_negative <= self.hit_seed_offset <= self.seed_dead_zone_positive):
            return 0
        if self.frame_dead_zone_negative <= self.hit_frame_error <= self.frame_dead_zone_positive:
            return 1
        if self.enter_tv == 1:
            for k in range(-1 - self.tv_negative_rounds, 2 + self.tv_positive_rounds):
                if k == 0:
                    continue
                centre = k * self.tv_frame_cost
                if centre - self.frame_dead_zone_negative <= self.hit_frame_error <= centre + self.frame_dead_zone_positive:
                    return 1
        return 0

    def _cell_text(self, count: int, circled: bool = False) -> str:
        values = _CIRCLED if circled else _DIGITS
        return "　" + (values[min(max(int(count), 1), 9) - 1] if circled else values[min(max(int(count), 0), 9)])

    def _update_miss_cell(self) -> int:
        inside = (self.cluster_seed_center - self.cluster_seed_radius <= self.seed_difference <= self.cluster_seed_center + self.cluster_seed_radius and
                  self.cluster_frame_center - self.cluster_frame_radius <= self.frame_difference <= self.cluster_frame_center + self.cluster_frame_radius)
        self.cell = "　ｏ" if inside else "　．"
        return 1

    def _update_count_cell(self) -> int:
        if self.count <= 0:
            return self._update_miss_cell()
        self.cell = self._cell_text(self.count)
        return 1

    def _update_circled_cell(self) -> int:
        self.cell = self._cell_text(self.count, circled=True)
        return 1

    def update_cell(self) -> int:
        self.read_count()
        if self.seed_difference == 0 and self.frame_difference == 0:
            self.cell = "　＠" if self.hit_seed_offset == 0 and self.hit_frame_error == 0 else "　＋"
            return 1
        if self.seed_difference == self.hit_seed_offset and self.frame_difference == self.normalize_frame(self.hit_frame_error):
            return self._update_circled_cell() if self.current_in_range else self._set_cell("　ｘ")
        return self._update_count_cell()

    def _set_cell(self, value: str) -> int:
        self.cell = value
        return 1

    def update_tv_cell(self) -> int:
        self.read_tv_count()
        self.tv_cell = "　．"
        if self.tv_column == 0:
            self.tv_cell = "　＋"
        if self.tv_prediction - self.tv_prediction_radius <= self.tv_column <= self.tv_prediction + self.tv_prediction_radius:
            self.tv_cell = "　ｏ"
        if self.tv_count > 0:
            self.tv_cell = self._tv_count_text()
        if self.tv_column == self.tv_current:
            self.tv_cell = "　" + (_CIRCLED[min(max(self.tv_count, 1), 9) - 1] if self.tv_current_in_range else "ｘ")
        return 1

    @property
    def tv_count(self) -> int:
        return getattr(self, "_tv_count", 0)

    @tv_count.setter
    def tv_count(self, value: int) -> None:
        self._tv_count = int(value)

    def read_tv_count(self) -> int:
        self.tv_count = self.tv_counts[self.tv_column + 4] if self._in_axis(self.tv_column) else 0
        return self.tv_count

    def _tv_count_text(self) -> str:
        return self._cell_text(self.tv_count)

    def update_tv_count_text(self) -> int:
        self.tv_cell = self._tv_count_text()
        return 1

    def update_row_seed_text(self) -> int:
        self.seed = self.seed_text[self.row_offset + 4] if self._in_axis(self.row_offset) else ""
        return 1

    def update_row_difference_text(self) -> int:
        if self._in_axis(self.row_offset) and self.row_offset < 0:
            self.row_text = "－" + _DIGITS[abs(self.row_offset)]
        elif self._in_axis(self.row_offset) and self.row_offset > 0:
            self.row_text = "＋" + _DIGITS[self.row_offset]
        elif self.row_offset == 0:
            self.row_text = "　０"
        else:
            self.row_text = " ?"
        return 1

    def output_row(self) -> int:
        self.update_row_seed_text()
        self.update_row_difference_text()
        cells = []
        for frame in _AXIS:
            self.seed_difference, self.frame_difference = self.row_offset, frame
            self.update_cell()
            cells.append(self.cell)
        self._print(self.row_text + "　　" + "".join(cells))
        return 1

    def output_tv_axis(self) -> int:
        if self.tv_enabled == 0:
            return 0
        self._print("TV帧　　－４－３－２－１　０＋１＋２＋３＋４")
        cells = []
        for column in _AXIS:
            self.tv_column = column
            self.update_tv_cell()
            cells.append(self.tv_cell)
        self._print("TV帧　　" + "".join(cells))
        return 1

    def output(self) -> int:
        self._print("")
        self._print("【BINGO】")
        if not self.current_in_range:
            self._print("")
            self._print("命中未进入BINGO范围")
        self._print("")
        self._print("横轴: 消耗帧偏移，表格范围 ±4")
        if self.enter_tv == 1:
            self._print(f"TV模式: 横轴为距最近死区中心(0/±{self.tv_frame_cost} 帧)的偏移")
        self._print("纵轴: Seed 距离差，表格范围 ±4")
        self._print("")
        self._print("图例: ＋目标中心 ＠命中中心 ①本轮命中 ２累计命中 ｘ本轮命中未计入 ｏ剩余帧/TV帧下轮命中预测 ．簇外")
        self._print("")
        self._print("消耗帧　－４－３－２－１　０＋１＋２＋３＋４")
        self._print("Seed")
        for row in _AXIS:
            self.row_offset = row
            self.output_row()
        self._print("")
        self.output_tv_axis()
        return 1

    def add_dead_zone_count(self) -> int:
        if not (self.seed_dead_zone_negative <= self.seed_difference <= self.seed_dead_zone_positive and
                self.frame_dead_zone_negative <= self.frame_difference <= self.frame_dead_zone_positive):
            return 0
        self.stable_count += self._cell_count()
        return self.stable_count

    def stats_seed_row(self) -> int:
        self.stable_count = 0
        self.seed_difference = self.hit_seed_offset
        for frame in _AXIS:
            self.frame_difference = frame
            self.add_dead_zone_count()
        return self.stable_count

    def stats_frame_column(self) -> int:
        self.stable_count = 0
        self.frame_difference = self.normalize_frame(self.hit_frame_error)
        for seed in _AXIS:
            self.seed_difference = seed
            self.add_dead_zone_count()
        return self.stable_count

    def check_stable_cluster(self) -> int:
        self.stable_type = 0
        self.stable_seed_difference = self.hit_seed_offset
        self.stable_frame_difference = self.hit_frame_error
        self.stable_count = 0
        self.stable_result = self.current_hit_in_dead_zone()
        if not self.stable_result:
            return 0
        if self.hit_seed_offset != 0 and self.stats_seed_row() >= self.stable_threshold:
            self.stable_type = 1
            return 1
        if self.hit_frame_error != 0 and self.stats_frame_column() >= self.stable_threshold:
            self.stable_type = 2
            return 2
        return 0

    def output_stable_reason(self) -> int:
        self._print("")
        self._print("【BINGO稳定校准】")
        if self.stable_type == 1:
            self._print(f"条件: 同Seed行在死区内累计达到 {self.stable_threshold} 次")
            self._print(f"Seed距离: {self.stable_seed_difference}")
        elif self.stable_type == 2:
            self._print(f"条件: 同消耗帧列在死区内累计达到 {self.stable_threshold} 次")
            self._print(f"消耗帧偏移: {self.stable_frame_difference} 帧")
        self._print(f"累计命中: {self.stable_count}")
        return 1

    def clear(self) -> int:
        self.counts = [[0] * 9 for _ in range(9)]
        self.tv_counts = [0] * 9
        self.current_in_range = 0
        self.tv_current_in_range = 0
        return 1

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "设置BINGO上下文": self.set_context,
            "设置BINGO簇": self.set_cluster,
            "设置BINGOTV帧轴": self.set_tv_axis,
            "设置BINGOSeed文本": self.set_seed_text,
            "记录BINGO命中": self.record_hit,
            "记录BINGOTV帧命中": self.record_tv_hit,
            "输出BINGO": self.output,
            "输出BINGOTV帧轴": self.output_tv_axis,
            "输出BINGO行": self.output_row,
            "更新BINGO行Seed文本": self.update_row_seed_text,
            "更新BINGO行差文本": self.update_row_difference_text,
            "更新BINGO格子文本": self.update_cell,
            "获取Seed死区": self.get_seed_dead_zone,
            "获取Seed单边死区": self.get_seed_one_sided_dead_zone,
            "BINGO归一化帧差": self.normalize_frame,
            "更新BINGO未命中格子文本": self._update_miss_cell,
            "更新BINGO次数文本": self._update_count_cell,
            "更新BINGO带圈次数文本": self._update_circled_cell,
            "更新BINGOTV帧格子": self.update_tv_cell,
            "更新BINGOTV帧次数文本": self.update_tv_count_text,
            "更新BINGOTV帧带圈次数文本": lambda: self._set_tv_circled(),
            "BINGO当前命中是否在表格": self.current_hit_in_table,
            "BINGO当前命中是否在死区": self.current_hit_in_dead_zone,
            "累加BINGO死区格次数": self.add_dead_zone_count,
            "读取BINGOTV帧次数": self.read_tv_count,
            "统计BINGO当前Seed行死区次数": self.stats_seed_row,
            "统计BINGO当前帧列死区次数": self.stats_frame_column,
            "检查BINGO稳定簇": self.check_stable_cluster,
            "输出BINGO稳定簇触发原因": self.output_stable_reason,
            "清空BINGO记录": self.clear,
            "读取BINGO次数": self.read_count,
            "增加BINGO次数": self.add_count,
        }

    def _set_tv_circled(self) -> int:
        self.tv_cell = "　" + _CIRCLED[min(max(self.tv_count, 1), 9) - 1]
        return 1


def extern_functions(*, emit: Callable[[str], None] | None = None) -> dict[str, Callable[..., object]]:
    return BingoSession(emit=emit).extern_functions()


__all__ = ["BingoSession", "extern_functions"]
