"""Python implementation of the FRLG Seed-table ECS boundary.

The original EasyCon package exposes the four generic functions in
``lib/00_Seed表_入口.ecs`` and stores the actual tables in ``02``/``03``.
The application runtime now replaces those pure lookup functions with
``EXTERN`` declarations and calls this module from ``script_host.py``.

The generated project contains ``seed_tables.json``.  It is materialized from
the *same* copied ECS tables after all package/Japanese overrides have been
applied, so a downloaded or locally updated table remains the source of truth.
The JSON sidecar is deliberately a snapshot of the generated project; it is
not a second bundled Seed database.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping


SEED_TABLE_JSON = "seed_tables.json"
SEED_TABLE_MIGRATION_VERSION = 1


@dataclass(frozen=True, slots=True)
class SeedTable:
    """The values formerly held by one of the 02/03 ECS libraries."""

    max_index: int
    ms: tuple[int, ...]
    raw_time: tuple[int, ...]
    modes: tuple[tuple[str, ...], ...]

    def __post_init__(self) -> None:
        count = self.max_index + 1
        if count <= 0 or len(self.ms) != count or len(self.raw_time) != count:
            raise ValueError("Seed 表索引和 MS/raw 数组长度不一致")
        if len(self.modes) != 11 or any(len(mode) != count for mode in self.modes):
            raise ValueError("Seed 表必须包含 11 个与索引对齐的模式")

    def seed_hex(self, index: int, mode: int) -> str:
        if index < 0 or index > self.max_index or mode < 0 or mode >= len(self.modes):
            return ""
        return self.modes[mode][index]


def _load_table(data: Mapping[str, object], game: str) -> SeedTable:
    try:
        max_index = int(data["max_index"])
        ms = tuple(int(value) for value in data["ms"])
        raw_time = tuple(int(value) for value in data["raw_time"])
        modes = tuple(tuple(str(value) for value in mode) for mode in data["modes"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Seed 表 {game} 数据无效") from exc
    return SeedTable(max_index=max_index, ms=ms, raw_time=raw_time, modes=modes)


class SeedTableRuntime:
    """Runtime callbacks matching the generic 00_Seed表_入口.ecs API."""

    def __init__(self, payload: Mapping[str, object], *, source: Path) -> None:
        if payload.get("migration_version") != SEED_TABLE_MIGRATION_VERSION:
            raise ValueError("Seed 表 Python 迁移版本不受支持")
        games = payload.get("games")
        if not isinstance(games, Mapping):
            raise ValueError("seed_tables.json 缺少 games")
        self.source = source
        self.tables = {
            1: _load_table(games["fr"], "fr"),
            2: _load_table(games["lg"], "lg"),
        }

    @classmethod
    def from_project(cls, project_dir: str | Path) -> "SeedTableRuntime":
        path = Path(project_dir) / SEED_TABLE_JSON
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取 Python Seed 表快照: {path}") from exc
        if not isinstance(payload, Mapping):
            raise ValueError("seed_tables.json 根节点必须是对象")
        return cls(payload, source=path)

    def _table(self, game: int) -> SeedTable | None:
        return self.tables.get(game)

    # These names intentionally mirror the original ECS entry functions.  Do
    # not change the invalid-index results: callers use -1/"" as sentinels.
    def get_max_index(self, game: int) -> int:
        table = self._table(game)
        return table.max_index if table is not None else -1

    def get_ms(self, game: int, index: int) -> int:
        table = self._table(game)
        return table.ms[index] if table is not None and 0 <= index <= table.max_index else -1

    def get_raw_time(self, game: int, index: int) -> int:
        table = self._table(game)
        return table.raw_time[index] if table is not None and 0 <= index <= table.max_index else -1

    def get_seed_hex(self, game: int, index: int, mode: int) -> str:
        table = self._table(game)
        return table.seed_hex(index, mode) if table is not None else ""

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        """Return callbacks for the EXTERN declarations in 00/01 ECS."""
        return {
            "取Seed最大索引": self.get_max_index,
            "取MS": self.get_ms,
            "取RawTime": self.get_raw_time,
            "取SeedHEX": self.get_seed_hex,
            # Keep the generated 02/03 function names callable too.  The
            # current 00 entry forwards only through the generic names, but a
            # downloaded extension may still reference a game-specific name.
            "取Seed最大索引_火红": lambda: self.get_max_index(1),
            "取MS_火红": lambda index: self.get_ms(1, index),
            "取RawTime_火红": lambda index: self.get_raw_time(1, index),
            "取SeedHEX_火红": lambda index, mode: self.get_seed_hex(1, index, mode),
            "取Seed最大索引_叶绿": lambda: self.get_max_index(2),
            "取MS_叶绿": lambda index: self.get_ms(2, index),
            "取RawTime_叶绿": lambda index: self.get_raw_time(2, index),
            "取SeedHEX_叶绿": lambda index, mode: self.get_seed_hex(2, index, mode),
            "HEX转十进制": hex_to_decimal,
        }


def hex_to_decimal(value: str) -> int:
    """Match ``01_Seed表_HEX转换.ecs`` exactly, including its sentinels."""
    text = str(value)
    position = 2 if len(text) >= 2 and text[:2] in {"0x", "0X"} else 0
    if position >= len(text):
        return -1
    result = 0
    for char in text[position:]:
        if "0" <= char <= "9":
            digit = ord(char) - ord("0")
        elif "A" <= char <= "F":
            digit = ord(char) - ord("A") + 10
        elif "a" <= char <= "f":
            digit = ord(char) - ord("a") + 10
        else:
            return -1
        result = result * 16 + digit
        if result > 0xFFFF:
            return -1
    return result


__all__ = [
    "SEED_TABLE_JSON",
    "SEED_TABLE_MIGRATION_VERSION",
    "SeedTable",
    "SeedTableRuntime",
    "hex_to_decimal",
]
