"""Python sidecar for FRLG target, encounter-method and location catalogs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping


CATALOG_JSON = "python_catalog.json"
CATALOG_MIGRATION_VERSION = 1


def _i32(value: int) -> int:
    """Match EasyCon's signed INT32 wrap for 07_数据_目标组合.ecs."""
    value &= 0xFFFF_FFFF
    return value - 0x1_0000_0000 if value >= 0x8000_0000 else value


class CatalogRuntime:
    def __init__(self, payload: Mapping[str, object], *, source: Path) -> None:
        if payload.get("migration_version") != CATALOG_MIGRATION_VERSION:
            raise ValueError("FRLG catalog Python 迁移版本不受支持")
        self.source = source
        self.catalog = payload
        self.targets = payload.get("targets")
        self.versions = payload.get("versions")
        self.methods = payload.get("methods")
        self.locations = payload.get("locations")
        if not all(isinstance(value, Mapping) for value in (self.targets, self.versions, self.methods, self.locations)):
            raise ValueError("python_catalog.json 缺少 catalog sections")

    @classmethod
    def from_project(cls, project_dir: str | Path) -> "CatalogRuntime":
        path = Path(project_dir) / CATALOG_JSON
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取 FRLG catalog Python 快照: {path}") from exc
        if not isinstance(payload, Mapping):
            raise ValueError("python_catalog.json 根节点必须是对象")
        return cls(payload, source=path)

    @staticmethod
    def _map_value(mapping: object, key: object, default: int = -1) -> int:
        if isinstance(mapping, Mapping) and str(key) in mapping:
            return int(mapping[str(key)])
        return default

    def normalize_version(self, value: str) -> int:
        return self._map_value(self.versions.get("normalize"), value)

    def version_name(self, version: int) -> str:
        values = self.versions.get("names")
        return str(values.get(str(version), "未知版本")) if isinstance(values, Mapping) else "未知版本"

    def normalize_method(self, value: str) -> int:
        return self._map_value(self.methods.get("normalize"), value)

    def method_name(self, method: int) -> str:
        values = self.methods.get("names")
        return str(values.get(str(method), "未知遭遇方法")) if isinstance(values, Mapping) else "未知遭遇方法"

    def normalize_location(self, value: str) -> int:
        return self._map_value(self.locations.get("normalize"), value)

    def location_name(self, location: int) -> str:
        values = self.locations.get("names")
        return str(values.get(str(location), "未知地点")) if isinstance(values, Mapping) else "未知地点"

    def game_corner(self, game: int, species: int, method: int) -> int:
        if method != 4:
            return 0
        common = {35, 63, 137, 147}
        if species in common:
            return 1
        return int((game == 1 and species == 123) or (game == 2 and species == 127))

    def game_corner_level(self, game: int, species: int) -> int:
        return self._map_value(self.targets.get("game_corner_levels"), f"{game}:{species}")

    def combination_index(self, game: int, species: int, method: int, location: int) -> int:
        exact = self.encode_target(game, species, method, location)
        wildcard = self.encode_target(game, species, method, 0)
        keys = self.targets.get("keys", ())
        if isinstance(keys, list):
            # The ECS loop is FOR 0 TO 1999; materialization validates that
            # every one of those slots is present before creating the sidecar.
            for index, key in enumerate(keys[:2000]):
                if int(key) in (exact, wildcard):
                    return index
        return -1

    def encode_target(self, game: int, species: int, method: int, location: int) -> int:
        value = _i32(_i32(game) * 400)
        value = _i32(value + _i32(species))
        value = _i32(value * 256)
        value = _i32(value + _i32(method))
        value = _i32(value * 256)
        return _i32(value + _i32(location))

    def _combination_value(self, name: str, game: int, species: int, method: int, location: int) -> int:
        if self.game_corner(game, species, method):
            return self.game_corner_level(game, species) if name in {"default_level", "min_level", "max_level"} else (100 if name == "rate" else 1)
        index = self.combination_index(game, species, method, location)
        if index < 0:
            return -1
        values = self.targets.get(name, ())
        return int(values[index]) if isinstance(values, list) else -1

    def target_supported(self, game: int, species: int, method: int, location: int) -> int:
        return int(self.game_corner(game, species, method) or self.combination_index(game, species, method, location) >= 0)

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        return {
            "规范化游戏版本": self.normalize_version,
            "游戏版本名称": self.version_name,
            "规范化遭遇方法": self.normalize_method,
            "目标遭遇方法名称": self.method_name,
            "规范化遭遇地点": self.normalize_location,
            "目标遭遇地点名称": self.location_name,
            "是否游戏角目标": self.game_corner,
            "游戏角目标等级": self.game_corner_level,
            "目标组合编码": self.encode_target,
            "查找目标组合索引": self.combination_index,
            "目标是否支持": self.target_supported,
            "目标默认等级": lambda g, s, m, l: self._combination_value("default_level", g, s, m, l),
            "目标最低等级": lambda g, s, m, l: self._combination_value("min_level", g, s, m, l),
            "目标最高等级": lambda g, s, m, l: self._combination_value("max_level", g, s, m, l),
            "目标出现率": lambda g, s, m, l: self._combination_value("rate", g, s, m, l),
            "目标默认计算方法": lambda g, s, m, l: self._combination_value("method", g, s, m, l),
            "调试_目标组合存在": self.target_supported,
        }


__all__ = ["CATALOG_JSON", "CATALOG_MIGRATION_VERSION", "CatalogRuntime"]
