"""Pure display text callbacks migrated from ``23_显示_文本.ecs``.

These functions only select constant strings. The generated project retains the
original file in ``lib/python_backup`` and exposes same-name EXTERN declarations
so a reviewer can compare every branch directly.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping


TEXT_JSON = "python_text.json"
TEXT_MIGRATION_VERSION = 1


class TextRuntime:
    def __init__(self, payload: Mapping[str, object], *, source: Path) -> None:
        if payload.get("migration_version") != TEXT_MIGRATION_VERSION:
            raise ValueError("FRLG 文本 Python 迁移版本不受支持")
        self.source = source
        tables = payload.get("tables")
        if not isinstance(tables, Mapping):
            raise ValueError("python_text.json 缺少 tables")
        self.tables = tables

    @classmethod
    def from_project(cls, project_dir: str | Path) -> "TextRuntime":
        path = Path(project_dir) / TEXT_JSON
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取 FRLG 文本 Python 快照: {path}") from exc
        if not isinstance(payload, Mapping):
            raise ValueError("python_text.json 根节点必须是对象")
        return cls(payload, source=path)

    def _lookup(self, function: str, value: int, fallback: str) -> str:
        table = self.tables.get(function, {})
        if isinstance(table, Mapping):
            result = table.get(str(int(value)))
            if result is not None:
                return str(result)
        return fallback

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "性别文本": lambda value: self._lookup("性别文本", value, "未知 / Unknown"),
            "性格文本": lambda value: self._lookup("性格文本", value, "未知 / Unknown"),
            "反查算法文本": lambda value: self._lookup("反查算法文本", value, "未知算法"),
            "雌性比例文本": lambda value: self._lookup("雌性比例文本", value, "未知"),
        }


__all__ = ["TEXT_JSON", "TEXT_MIGRATION_VERSION", "TextRuntime"]
