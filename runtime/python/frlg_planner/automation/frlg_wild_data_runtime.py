"""Pure encounter-slot tables migrated from ``26_数据_野生遇敌槽.ecs``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping


WILD_JSON = "python_wild_data.json"
WILD_MIGRATION_VERSION = 1


def _i32(value: int) -> int:
    value &= 0xFFFF_FFFF
    return value - 0x1_0000_0000 if value >= 0x8000_0000 else value


def _mod(left: int, right: int) -> int:
    quotient = abs(int(left)) // abs(int(right))
    if (left < 0) != (right < 0):
        quotient = -quotient
    return _i32(int(left) - quotient * int(right))


class WildDataRuntime:
    def __init__(self, payload: Mapping[str, object], *, source: Path) -> None:
        if payload.get("migration_version") != WILD_MIGRATION_VERSION:
            raise ValueError("FRLG 野生遇敌 Python 迁移版本不受支持")
        self.source = source
        keys = payload.get("keys")
        tables = payload.get("packed_tables")
        if not isinstance(keys, list) or not isinstance(tables, list) or len(keys) != 630 or len(tables) != 9:
            raise ValueError("python_wild_data.json 表尺寸不符合原 ECS 629/0..8 分块")
        if any(not isinstance(table, list) for table in tables):
            raise ValueError("python_wild_data.json packed_tables 类型无效")
        self.keys = [int(value) for value in keys]
        self.tables = [[int(value) for value in table] for table in tables]

    @classmethod
    def from_project(cls, project_dir: str | Path) -> "WildDataRuntime":
        path = Path(project_dir) / WILD_JSON
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取 FRLG 野生遇敌 Python 快照: {path}") from exc
        if not isinstance(payload, Mapping):
            raise ValueError("python_wild_data.json 根节点必须是对象")
        return cls(payload, source=path)

    @staticmethod
    def encode(game: int, method: int, location: int) -> int:
        # ECS evaluates ($game * 256 + method) * 256 + location with INT32
        # wrapping. Normal catalog values are small, but preserve edge cases.
        value = _i32(_i32(game) * 256)
        value = _i32(value + _i32(method))
        value = _i32(value * 256)
        return _i32(value + _i32(location))

    def find(self, game: int, method: int, location: int) -> int:
        key = self.encode(game, method, location)
        for index in range(630):
            if self.keys[index] == key:
                return index
        return -1

    def packed(self, table_index: int, slot: int) -> int:
        if table_index < 0 or slot < 0 or slot >= 12:
            return 0
        flat = table_index * 12 + slot
        if flat < 0 or flat >= 7560:
            return 0
        table, offset = divmod(flat, 900)
        if table >= len(self.tables) or offset >= len(self.tables[table]):
            return 0
        return self.tables[table][offset]

    @staticmethod
    def slot(method: int, value: int) -> int:
        percent = _mod(value, 100)
        if method == 101:
            for threshold, result in ((20, 0), (40, 1), (50, 2), (60, 3), (70, 4), (80, 5), (85, 6), (90, 7), (94, 8), (98, 9), (99, 10)):
                if percent < threshold:
                    return result
            return 11
        if method in (102, 103):
            for threshold, result in ((60, 0), (90, 1), (95, 2), (99, 3)):
                if percent < threshold:
                    return result
            return 4
        if method == 201:
            return 0 if percent < 70 else 1
        if method == 202:
            return 0 if percent < 60 else (1 if percent < 80 else 2)
        if method == 203:
            for threshold, result in ((40, 0), (80, 1), (95, 2), (99, 3)):
                if percent < threshold:
                    return result
            return 4
        return -1

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "野生遇敌表编码": self.encode,
            "查找野生遇敌表索引": self.find,
            "取野生遇敌槽打包值": self.packed,
            "野生遇敌槽编号": self.slot,
        }


__all__ = ["WILD_JSON", "WILD_MIGRATION_VERSION", "WildDataRuntime"]
