"""Python session runtime for ``28_反查_孵蛋.ecs``.

This is a direct port of the FRLG/TenLines scan order.  The former ECS global
arrays are fields on :class:`EggReverseSession`; each host run gets one fresh
instance, while all public function names remain available to unchanged flow
scripts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .frlg_compute_runtime import (
    rng_next_hi,
    rng_next_lo,
    static_gender,
    static_nature,
)


@dataclass
class EggReverseSession:
    data_runtime: object | None = None
    parents_set: int = 0
    observation_set: int = 0
    A: list[int] = field(default_factory=lambda: [0] * 6)
    B: list[int] = field(default_factory=lambda: [0] * 6)
    species: int = 0
    nature: int = -1
    gender: int = -1
    ability: int = -1
    shiny: int = -1
    tid: int = 0
    sid: int = 0
    iv_min: list[int] = field(default_factory=lambda: [0] * 6)
    iv_max: list[int] = field(default_factory=lambda: [31] * 6)
    held_frames: list[int] = field(default_factory=list)
    held_pid_lows: list[int] = field(default_factory=list)
    results: list[dict[str, object]] = field(default_factory=list)
    total_hits: int = 0
    save_limit: int = 0
    work_hi: int = 0
    work_lo: int = 0
    random16: int = 0
    current: dict[str, int] = field(default_factory=dict)
    inheritance: list[int] = field(default_factory=lambda: [0] * 6)
    inheritance_source: list[int] = field(default_factory=lambda: [0] * 6)

    def _threshold(self, species: int) -> int:
        if self.data_runtime is None:
            return -1
        try:
            return int(self.data_runtime.gender_threshold(species))
        except AttributeError:
            return -1

    def set_parents(self, *values: int) -> int:
        if len(values) != 12 or any(int(value) < 0 or int(value) > 31 for value in values):
            self.parents_set = 0
            return 0
        self.A = [int(value) for value in values[:6]]
        self.B = [int(value) for value in values[6:]]
        self.parents_set = 1
        return 1

    def set_observation(self, species: int, nature: int, gender: int, ability: int, shiny: int,
                        tid: int, sid: int, *ranges: int) -> int:
        if int(species) <= 0 or not (-1 <= int(nature) <= 24) or not (-1 <= int(gender) <= 2):
            self.observation_set = 0
            return 0
        if not (-1 <= int(ability) <= 1) or not (-1 <= int(shiny) <= 1) or not (0 <= int(tid) <= 65535 and 0 <= int(sid) <= 65535):
            self.observation_set = 0
            return 0
        if len(ranges) != 12:
            self.observation_set = 0
            return 0
        pairs = [(int(ranges[i]), int(ranges[i + 1])) for i in range(0, 12, 2)]
        if any(lo < 0 or hi > 31 or lo > hi for lo, hi in pairs):
            self.观察已设置 = 0
            return 0
        self.species, self.nature, self.gender, self.ability, self.shiny = map(int, (species, nature, gender, ability, shiny))
        self.tid, self.sid = int(tid), int(sid)
        self.iv_min = [pair[0] for pair in pairs]
        self.iv_max = [pair[1] for pair in pairs]
        self.observation_set = 1
        return 1

    def set_observation_iv(self, species: int, *ranges: int) -> int:
        return self.set_observation(species, -1, -1, -1, -1, 0, 0, *ranges)

    def set_individual_observation(self, species: int, nature: int, gender: int, *ranges: int) -> int:
        return self.set_observation(species, nature, gender, -1, -1, 0, 0, *ranges)

    @staticmethod
    def xor16(a: int, b: int) -> int:
        return (int(a) | int(b)) - (int(a) & int(b))

    def rng_step(self) -> int:
        new_hi = rng_next_hi(self.work_hi, self.work_lo)
        new_lo = rng_next_lo(self.work_hi, self.work_lo)
        self.work_hi, self.work_lo, self.random16 = new_hi, new_lo, new_hi
        return self.random16

    def rng_advance(self, steps: int) -> int:
        for _ in range(max(0, int(steps))):
            self.rng_step()
        return 1

    def parent_iv(self, parent: int, stat: int) -> int:
        return (self.A if int(parent) == 0 else self.B)[max(0, min(5, int(stat)))]

    def option_get(self, index: int) -> int:
        return int(index)

    def option_delete(self, start: int, size: int) -> int:
        # ECS shifts from the selected value, exactly matching PokeFinder's
        # avoid(stat,size) operation.
        start, size = int(start), int(size)
        for i in range(max(0, start), min(5, size - 1)):
            self._options[i] = self._options[i + 1]
        return 1

    @staticmethod
    def ability_map(choice: int) -> int:
        return [0, 1, 2, 5, 3, 4][max(0, min(5, int(choice)))]

    def apply_one_inheritance(self, stat: int, parent: int) -> int:
        stat, parent = int(stat), int(parent)
        self.inheritance[stat] = self.parent_iv(parent, stat)
        self.inheritance_source[stat] = parent + 1
        return 1

    def apply_inheritance(self) -> int:
        self.inheritance = [0] * 6
        self.inheritance_source = [0] * 6
        self._options = [0, 1, 2, 3, 4, 5]
        for random, parent, size in zip(self._inherit_random, self._parent_random, (5, 4, 3)):
            choice = self._options[random]
            self.apply_one_inheritance(self.ability_map(choice), parent)
            self.option_delete(choice, size)
        for index, value in enumerate(self.inheritance):
            self.current["iv" + str(index)] = value if self.inheritance_source[index] else self.current["iv" + str(index)]
        return 1

    def actual_gender(self, pid_low: int) -> int:
        actual_species = self.species
        if self.species == 29 and (int(pid_low) & 32768):
            actual_species = 32
        elif self.species == 314 and (int(pid_low) & 32768):
            actual_species = 313
        threshold = self._threshold(actual_species)
        return -1 if threshold < 0 else static_gender(int(pid_low), threshold)

    def iv_match(self) -> int:
        return int(all(self.iv_min[i] <= self.current.get("iv" + str(i), 0) <= self.iv_max[i] for i in range(6)))

    def result_match(self) -> int:
        pid_hi, pid_lo = self.current["pid_hi"], self.current["pid_lo"]
        current_nature = static_nature(pid_hi, pid_lo)
        current_ability = pid_lo & 1
        current_gender = self.actual_gender(pid_lo)
        shiny_value = self.xor16(self.xor16(self.tid, self.sid), self.xor16(pid_hi, pid_lo))
        current_shiny = int(shiny_value < 8)
        if self.nature >= 0 and current_nature != self.nature: return 0
        if self.gender >= 0 and current_gender != self.gender: return 0
        if self.ability >= 0 and current_ability != self.ability: return 0
        if self.shiny >= 0 and current_shiny != self.shiny: return 0
        self.current.update(nature=current_nature, gender=current_gender, ability=current_ability, shiny=current_shiny)
        return 1

    def save_current(self) -> int:
        self.total_hits += 1
        if len(self.results) < self.save_limit:
            self.results.append({
                "held": self.current["held"], "pickup": self.current["pickup"],
                "pid_hi": self.current["pid_hi"], "pid_lo": self.current["pid_lo"],
                "iv": [self.current.get("iv" + str(i), 0) for i in range(6)],
                "inheritance": list(self.inheritance_source),
            })
        return 1

    def reset_results(self) -> int:
        self.held_frames, self.held_pid_lows, self.results = [], [], []
        self.total_hits, self.save_limit = 0, 0
        return 1

    def execute(self, relation: int, held_seed: int, pickup_seed: int, held_min: int, held_max: int,
                pickup_min: int, pickup_max: int, held_offset: int, pickup_offset: int,
                method: int, compatibility: int, save_limit: int) -> int:
        self.reset_results()
        if not self.parents_set or not self.observation_set or relation not in (0, 1): return -1
        if not (0 <= held_seed <= 65535 and 0 <= pickup_seed <= 65535): return -1
        if relation == 0 and held_seed != pickup_seed: return -1
        if held_min < 0 or held_max < held_min or pickup_min < 0 or pickup_max < pickup_min: return -1
        if held_max - held_min > 20000 or pickup_max - pickup_min > 20000: return -1
        if held_offset < 0 or pickup_offset < 0 or method not in (11, 12, 13, 14) or compatibility not in (20, 50, 70) or not (0 < save_limit <= 256): return -1
        if self._threshold(self.species) < 0: return -1
        self.save_limit = int(save_limit)
        # Held: one compatibility roll then one PID-low roll per frame.
        self.work_hi, self.work_lo = 0, int(held_seed)
        self.rng_advance(held_min + held_offset)
        held_state = (self.work_hi, self.work_lo)
        for frame in range(int(held_min), int(held_max) + 1):
            self.work_hi, self.work_lo = held_state
            compatibility_random = self.rng_step()
            next_state = (self.work_hi, self.work_lo)
            pid_low = (self.rng_step() % 65534) + 1
            if (compatibility_random * 100) // 65535 >= compatibility:
                held_state = next_state
                continue
            current_ability = pid_low & 1
            current_gender = self.actual_gender(pid_low)
            if (self.ability >= 0 and current_ability != self.ability) or (self.gender >= 0 and current_gender != self.gender):
                held_state = next_state
                continue
            self.held_frames.append(frame)
            self.held_pid_lows.append(pid_low)
            held_state = next_state
        if not self.held_frames: return 0
        # Pickup: PID high, IV words, then FRLG's three inherited stats.
        self.work_hi, self.work_lo = 0, int(pickup_seed)
        self.rng_advance(pickup_min + pickup_offset)
        pickup_state = (self.work_hi, self.work_lo)
        for frame in range(int(pickup_min), int(pickup_max) + 1):
            self.work_hi, self.work_lo = pickup_state
            pid_hi = self.rng_step()
            pickup_next_state = (self.work_hi, self.work_lo)
            if method in (11, 13): self.rng_advance(1)
            iv1 = self.rng_step()
            if method == 12: self.rng_advance(1)
            iv2 = self.rng_step()
            ivs = [iv1 & 31, (iv1 >> 5) & 31, (iv1 >> 10) & 31, (iv2 >> 5) & 31, (iv2 >> 10) & 31, iv2 & 31]
            self.rng_advance(1 if method in (11, 12) else 2)
            self._inherit_random = [self.rng_step() % 6, self.rng_step() % 5, self.rng_step() % 4]
            self._parent_random = [self.rng_step() % 2, self.rng_step() % 2, self.rng_step() % 2]
            self.current = {"pid_hi": int(pid_hi), "iv0": ivs[0], "iv1": ivs[1], "iv2": ivs[2], "iv3": ivs[3], "iv4": ivs[4], "iv5": ivs[5]}
            self.apply_inheritance()
            if self.iv_match():
                for held, pid_low in zip(self.held_frames, self.held_pid_lows):
                    self.current.update(held=int(held), pickup=int(frame), pid_lo=int(pid_low))
                    if self.result_match(): self.save_current()
            pickup_state = pickup_next_state
        return self.total_hits

    def execute_hex(self, relation: int, held_seed_text: str, pickup_seed_text: str, *args: int) -> int:
        try:
            held_seed, pickup_seed = int(str(held_seed_text).strip(), 16), int(str(pickup_seed_text).strip(), 16)
        except (TypeError, ValueError):
            return -1
        return self.execute(relation, held_seed, pickup_seed, *args)

    def result_value(self, index: int, key: str, stat: int | None = None) -> int:
        if index < 0 or index >= len(self.results): return -1
        result = self.results[index]
        if key == "iv": return int(result["iv"][int(stat)]) if stat is not None and 0 <= stat < 6 else -1
        if key == "inheritance": return int(result["inheritance"][int(stat)]) if stat is not None and 0 <= stat < 6 else -1
        return int(result[key])

    def extern_functions(self) -> dict[str, Callable[..., object]]:
        f: dict[str, Callable[..., object]] = {
            "孵蛋反查_设置双亲": self.set_parents,
            "孵蛋反查_设置观察": self.set_observation,
            "孵蛋反查_设置观察IV": self.set_observation_iv,
            "孵蛋反查_设置个体观察": self.set_individual_observation,
            "孵蛋反查_异或16": self.xor16,
            "孵蛋反查_RNG前进一步": self.rng_step,
            "孵蛋反查_RNG推进": self.rng_advance,
            "孵蛋反查_取双亲IV": self.parent_iv,
            "孵蛋反查_取可选项": self.option_get,
            "孵蛋反查_删除可选项": self.option_delete,
            "孵蛋反查_能力顺序映射": self.ability_map,
            "孵蛋反查_应用一项遗传": self.apply_one_inheritance,
            "孵蛋反查_应用FRLG遗传": self.apply_inheritance,
            "孵蛋反查_计算实际性别": self.actual_gender,
            "孵蛋反查_当前IV匹配": self.iv_match,
            "孵蛋反查_当前结果匹配": self.result_match,
            "孵蛋反查_保存当前结果": self.save_current,
            "孵蛋反查_重置结果": self.reset_results,
            "孵蛋反查_执行HEX": self.execute_hex,
            "孵蛋反查_执行": self.execute,
            "孵蛋反查_取总命中数": lambda: self.total_hits,
            "孵蛋反查_取已保存结果数": lambda: len(self.results),
            "孵蛋反查_候选是否唯一": lambda: int(self.total_hits == 1),
            "孵蛋反查_取结果Held帧": lambda i: self.result_value(i, "held"),
            "孵蛋反查_取结果Pickup帧": lambda i: self.result_value(i, "pickup"),
            "孵蛋反查_取结果PID高": lambda i: self.result_value(i, "pid_hi"),
            "孵蛋反查_取结果PID低": lambda i: self.result_value(i, "pid_lo"),
            "孵蛋反查_取结果IV": lambda i, stat: self.result_value(i, "iv", stat),
            "孵蛋反查_取结果遗传来源": lambda i, stat: self.result_value(i, "inheritance", stat),
        }
        return f


def extern_functions(*, data_runtime: object | None = None) -> dict[str, Callable[..., object]]:
    return EggReverseSession(data_runtime=data_runtime).extern_functions()


__all__ = ["EggReverseSession", "extern_functions"]
