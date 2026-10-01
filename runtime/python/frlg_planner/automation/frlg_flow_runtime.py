"""Pure decision helpers extracted from the device-oriented FRLG libraries.

The surrounding 15/17/27 libraries still execute controller, wait and image
operations in ECS.  These callbacks contain only deterministic support checks
and Seed timing arithmetic, so their state and table scans run in Python.
"""

from __future__ import annotations

from typing import Callable

from .seed_table_runtime import hex_to_decimal


SUPPORTED_STATIC_TARGETS = frozenset({
    1, 4, 7, 24, 35, 63, 97, 101, 106, 107, 123, 127, 129, 131,
    133, 137, 138, 140, 142, 143, 144, 145, 146, 147, 150, 175,
    243, 244, 245, 249, 250, 386,
})
WILD_METHODS = frozenset({101, 102, 103, 201, 202, 203})


class FlowRuntime:
    """Stateless callbacks for support and encounter-zone decisions."""

    @staticmethod
    def is_hunting_zone(location: int) -> int:
        return int(int(location) in {54, 55, 56, 57})

    def target_supported(self, species: int, method: int, location: int) -> int:
        if self.is_hunting_zone(location):
            return 1
        return int(int(method) in WILD_METHODS or int(species) in SUPPORTED_STATIC_TARGETS)

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "是否狩猎地带": self.is_hunting_zone,
            "目标获取是否支持": self.target_supported,
        }


class EggFlowRuntime:
    """Seed wait arithmetic used by the egg device flow."""

    def __init__(self, *, seed_runtime: object | None, catalog_runtime: object | None,
                 emit: Callable[[str], None] | None = None) -> None:
        self.seed_runtime = seed_runtime
        self.catalog_runtime = catalog_runtime
        self.emit = emit

    def _print(self, value: object) -> None:
        if self.emit is not None:
            self.emit(str(value) + "\n")

    def find_seed_wait_ms(self, version_text: str, target_seed: str, seed_mode: int,
                          nx_model: int, calibration_ns1: int, calibration_ns2: int,
                          base_compensation: int) -> int:
        mode = int(seed_mode)
        model = int(nx_model)
        if mode < 0 or mode > 9:
            self._print(f"孵蛋Seed模式无效:{mode}（仅支持0-9）")
            return -1
        if model not in {1, 2}:
            self._print(f"孵蛋NX机型无效:{model}（仅支持1/2）")
            return -1
        if self.seed_runtime is None or self.catalog_runtime is None:
            raise RuntimeError("孵蛋 Seed 计算缺少 Python 表运行时")
        game = int(self.catalog_runtime.normalize_version(str(version_text)))
        if game < 0:
            self._print(f"孵蛋游戏版本无效:{version_text}")
            return -1
        maximum = int(self.seed_runtime.get_max_index(game))
        target_decimal = hex_to_decimal(str(target_seed))
        if target_decimal < 0:
            self._print(f"孵蛋目标Seed格式错误:{target_seed}")
            return -1
        target_index = -1
        for index in range(maximum + 1):
            if hex_to_decimal(self.seed_runtime.get_seed_hex(game, index, mode)) == target_decimal:
                target_index = index
                break
        if target_index < 0:
            self._print(f"孵蛋Seed表中未找到目标:{target_seed} / 模式 {mode}")
            return -1
        platform_offset = 0
        calibration = int(calibration_ns1)
        if model == 2:
            platform_offset = -750
            calibration = int(calibration_ns2)
        target_ms = int(self.seed_runtime.get_ms(game, target_index)) + platform_offset
        corrected_index = max(0, min(maximum, target_index + calibration))
        table_correction = int(self.seed_runtime.get_ms(game, corrected_index)) - int(self.seed_runtime.get_ms(game, target_index))
        wait_ms = target_ms - table_correction + int(base_compensation)
        self._print(f"孵蛋目标Seed:{target_seed} / 模式 {mode} / 等待 {wait_ms} ms")
        self._print(f"孵蛋Seed预校准: NX偏移{platform_offset} ms，索引 {calibration}，查表修正 {table_correction} ms")
        return wait_ms

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {"孵蛋测试_查找Seed等待MS": self.find_seed_wait_ms}


__all__ = ["EggFlowRuntime", "FlowRuntime"]
