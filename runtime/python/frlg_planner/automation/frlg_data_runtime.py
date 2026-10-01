"""Python sidecar for the generated FRLG name/stat lookup libraries.

``04_数据_宝可梦名称.ecs`` through ``06_数据_宝可梦性别阈值.ecs`` are
finite generated lookup tables.  The project builder extracts their values
from the copied ECS files, stores them in ``python_data.json`` and leaves
same-name ``EXTERN`` declarations in the generated libraries.  The copied
files in ``lib/python_backup`` remain the comparison source.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping


DATA_JSON = "python_data.json"
DATA_MIGRATION_VERSION = 1


class DataRuntime:
    def __init__(self, payload: Mapping[str, object], *, source: Path) -> None:
        if payload.get("migration_version") != DATA_MIGRATION_VERSION:
            raise ValueError("FRLG 数据 Python 迁移版本不受支持")
        self.source = source
        names = payload.get("names")
        stats = payload.get("stats")
        gender = payload.get("gender")
        if not isinstance(names, Mapping) or not isinstance(stats, Mapping) or not isinstance(gender, Mapping):
            raise ValueError("python_data.json 缺少 names/stats/gender")
        self.names = names
        self.stats = stats
        self.gender = gender

    @classmethod
    def from_project(cls, project_dir: str | Path) -> "DataRuntime":
        path = Path(project_dir) / DATA_JSON
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取 FRLG 数据 Python 快照: {path}") from exc
        if not isinstance(payload, Mapping):
            raise ValueError("python_data.json 根节点必须是对象")
        return cls(payload, source=path)

    @staticmethod
    def _int_key(mapping: Mapping[str, object], key: int) -> object | None:
        return mapping.get(str(int(key)))

    def target_name(self, game: int, species: int) -> str:
        values = self.names.get("target", {})
        record = self._int_key(values, species) if isinstance(values, Mapping) else None
        if isinstance(record, Mapping):
            games = record.get("games", {})
            if isinstance(games, Mapping) and str(game) in games:
                return str(games[str(game)])
            return str(record.get("default", "未知"))
        return "未知 / Unknown"

    def target_zh(self, game: int, species: int) -> str:
        values = self.names.get("zh", {})
        record = self._int_key(values, species) if isinstance(values, Mapping) else None
        if isinstance(record, Mapping):
            games = record.get("games", {})
            if isinstance(games, Mapping) and str(game) in games:
                return str(games[str(game)])
            return str(record.get("default", "未知"))
        return "未知"

    def target_en(self, species: int) -> str:
        values = self.names.get("en", {})
        if isinstance(values, Mapping):
            value = self._int_key(values, species)
            if value is not None:
                return str(value)
        return "UNKNOWN"

    def english_to_id(self, value: str) -> int:
        values = self.names.get("english_to_id", {})
        if isinstance(values, Mapping):
            result = values.get(str(value))
            if result is not None:
                return int(result)
        return -1

    def input_to_id(self, value: str) -> int:
        # Keep the original function's exact, case-sensitive uppercase path.
        explicit = {"尼多兰♀": 29, "尼多兰♂": 32}
        if value in explicit:
            return explicit[value]
        result = self.english_to_id(value)
        if result > 0:
            return result
        values = self.names.get("input_to_id", {})
        if isinstance(values, Mapping):
            result = values.get(str(value))
            if result is not None:
                return int(result)
        return -1

    def stat(self, function: str, game: int, species: int) -> int:
        table = self.stats.get(function, {})
        if not isinstance(table, Mapping):
            return -1
        record = self._int_key(table.get("values", {}), species) if isinstance(table.get("values", {}), Mapping) else None
        if not isinstance(record, Mapping):
            return int(table.get("default", -1))
        games = record.get("games", {})
        if isinstance(games, Mapping) and str(game) in games:
            return int(games[str(game)])
        return int(record.get("default", table.get("default", -1)))

    def gender_threshold(self, species: int) -> int:
        values = self.gender.get("values", {})
        if isinstance(values, Mapping):
            result = self._int_key(values, species)
            if result is not None:
                return int(result)
        return int(self.gender.get("default", -1))

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "目标名称": self.target_name,
            "目标中文名称": self.target_zh,
            "目标英文名称": lambda species: self.target_en(species),
            "英文名称查图鉴编号": self.english_to_id,
            "目标宝可梦名称查图鉴编号": self.input_to_id,
            "取种族HP": lambda game, species: self.stat("取种族HP", game, species),
            "取种族ATK": lambda game, species: self.stat("取种族ATK", game, species),
            "取种族DEF": lambda game, species: self.stat("取种族DEF", game, species),
            "取种族SPA": lambda game, species: self.stat("取种族SPA", game, species),
            "取种族SPD": lambda game, species: self.stat("取种族SPD", game, species),
            "取种族SPE": lambda game, species: self.stat("取种族SPE", game, species),
            "取性别阈值": self.gender_threshold,
        }


__all__ = ["DATA_JSON", "DATA_MIGRATION_VERSION", "DataRuntime"]
