"""Python implementation of the pure FRLG calculation ECS libraries.

The generated FRLG project replaces ``lib/11_计算_RNG基础.ecs`` through
``lib/14_计算_等待参数.ecs`` with ``EXTERN`` declarations.  Those libraries
contain no device, video, OCR, timing or mutable script state; keeping them in
the Python host makes the arithmetic easier to test and avoids interpreting
the same small loops for every encounter.

Every public callback below deliberately keeps the original ECS function name
and argument order.  The comments identify the source function so a future
script update can be compared against the preserved copies in
``lib/python_backup``.  Arithmetic uses EasyCon's truncating ``/`` and ``%``
rules rather than Python's floor/modulo rules for negative values.
"""

from __future__ import annotations

from typing import Callable


def _i32(value: int) -> int:
    """EasyCon INT is signed 32-bit and wraps after every integer operation."""
    value &= 0xFFFF_FFFF
    return value - 0x1_0000_0000 if value >= 0x8000_0000 else value


def _div(left: int, right: int) -> int:
    """EasyCon INT division: truncate toward zero."""
    if right == 0:
        raise ZeroDivisionError("除数不能为 0")
    quotient = abs(int(left)) // abs(int(right))
    return _i32(-quotient if (left < 0) != (right < 0) else quotient)


def _mod(left: int, right: int) -> int:
    """EasyCon INT remainder, paired with :func:`_div`."""
    return _i32(int(left) - _div(int(left), int(right)) * int(right))


# ---------------------------------------------------------------------------
# 11_计算_RNG基础.ecs
# ---------------------------------------------------------------------------


def rng_next_lo(hi: int, lo: int) -> int:
    """RNG下一LO: the low 16 bits of the Gen-3 LCRNG step."""
    del hi  # Kept in the signature to match RNG下一LO($hi, $lo).
    # ECS: $乘低 = $lo * 20077 + 24691; RETURN $乘低 % 65536
    product = _i32(_i32(lo) * 20077)
    product = _i32(product + 24691)
    return _mod(product, 65536)


def rng_next_hi(hi: int, lo: int) -> int:
    """RNG下一HI: the high 16 bits of the Gen-3 LCRNG step."""
    product = _i32(_i32(lo) * 20077)
    product = _i32(product + 24691)
    carry = _div(product, 65536)
    part1 = _mod(_i32(_i32(hi) * 20077), 65536)
    part2 = _mod(_i32(_i32(lo) * 16838), 65536)
    return _mod(_i32(_i32(part1 + part2) + carry), 65536)


def _rng_advance(hi: int, lo: int, steps: int) -> tuple[int, int]:
    current_hi, current_lo = _i32(hi), _i32(lo)
    if steps <= 0:
        return current_hi, current_lo
    for _ in range(1, steps + 1):
        next_hi = rng_next_hi(current_hi, current_lo)
        next_lo = rng_next_lo(current_hi, current_lo)
        current_hi, current_lo = next_hi, next_lo
    return current_hi, current_lo


def rng_advance_n_hi(hi: int, lo: int, steps: int) -> int:
    """RNG前进N_HI($hi, $lo, $n)."""
    return _rng_advance(hi, lo, steps)[0]


def rng_advance_n_lo(hi: int, lo: int, steps: int) -> int:
    """RNG前进N_LO($hi, $lo, $n)."""
    return _rng_advance(hi, lo, steps)[1]


def static_pidlo(hi: int, lo: int) -> int:
    """Static_PIDLO: RNG step 1 high word."""
    return rng_advance_n_hi(hi, lo, 1)


def static_pidhi(hi: int, lo: int) -> int:
    """Static_PIDHI: RNG step 2 high word."""
    return rng_advance_n_hi(hi, lo, 2)


def static_iv1(hi: int, lo: int) -> int:
    """Static_IV1: RNG step 3 high word."""
    return rng_advance_n_hi(hi, lo, 3)


def static_iv2(hi: int, lo: int) -> int:
    """Static_IV2: RNG step 4 high word."""
    return rng_advance_n_hi(hi, lo, 4)


def static_nature(pidhi: int, pidlo: int) -> int:
    """Static_性格: PID modulo 25."""
    product = _i32(_mod(pidhi, 25) * 11)
    return _mod(_i32(product + _mod(pidlo, 25)), 25)


def static_unown_form(pidhi: int, pidlo: int) -> int:
    """Static_未知图腾形态."""
    # Use Python's arithmetic right shift directly, matching ECS ``>>`` even
    # for diagnostic negative inputs (the normal PID words are unsigned).
    pidhi = _i32(pidhi)
    pidlo = _i32(pidlo)
    value = _i32((pidhi >> 2) & 192)
    value = _i32(value + _i32((pidhi & 3) * 16))
    value = _i32(value + ((pidlo >> 6) & 12))
    value = _i32(value + (pidlo & 3))
    return _mod(value, 28)


def static_gender(pidlo: int, gender_threshold: int) -> int:
    """Static_性别: return 0 male, 1 female, 2 genderless."""
    gender_code = _mod(pidlo, 256)
    if gender_threshold == 255:
        return 2
    if gender_threshold == 254:
        return 1
    if gender_threshold == 0:
        return 0
    return 1 if gender_code < gender_threshold else 0


def static_hpiv(iv1: int) -> int:
    return _i32(iv1) & 31


def static_atkiv(iv1: int) -> int:
    return (_i32(iv1) >> 5) & 31


def static_defiv(iv1: int) -> int:
    return (_i32(iv1) >> 10) & 31


def static_speiv(iv2: int) -> int:
    return _i32(iv2) & 31


def static_spaiv(iv2: int) -> int:
    return (_i32(iv2) >> 5) & 31


def static_spdiv(iv2: int) -> int:
    return (_i32(iv2) >> 10) & 31


# ---------------------------------------------------------------------------
# 12_计算_IV范围.ecs
# ---------------------------------------------------------------------------


def nature_multiplier(nature: int, stat_index: int) -> int:
    """取性格倍率($性格, $性格项), in percent."""
    raised = _div(nature, 5)
    lowered = _mod(nature, 5)
    if raised != lowered:
        if stat_index == raised:
            return 110
        if stat_index == lowered:
            return 90
    return 100


def calculate_hp_stat(base: int, effort: int, level: int, iv: int) -> int:
    """计算HP能力值."""
    inner = _i32(_i32(2 * _i32(base)) + _i32(iv))
    inner = _i32(inner + _div(effort, 4))
    value = _div(_i32(inner * _i32(level)), 100)
    return _i32(_i32(value + _i32(level)) + 10)


def calculate_non_hp_stat(base: int, effort: int, level: int, iv: int,
                          nature: int, stat_index: int) -> int:
    """计算非HP能力值."""
    inner = _i32(_i32(2 * _i32(base)) + _i32(iv))
    inner = _i32(inner + _div(effort, 4))
    value = _i32(_div(_i32(inner * _i32(level)), 100) + 5)
    return _div(_i32(value * nature_multiplier(nature, stat_index)), 100)


def _matching_iv_values(calculator: Callable[[int], int], actual: int) -> list[int]:
    return [iv for iv in range(32) if calculator(iv) == actual]


def calculate_hp_iv_min(base: int, effort: int, level: int, actual: int) -> int:
    """计算HP_IV最小; -1 means no IV can produce the observed value."""
    values = _matching_iv_values(
        lambda iv: calculate_hp_stat(base, effort, level, iv), actual
    )
    return values[0] if values else -1


def calculate_hp_iv_max(base: int, effort: int, level: int, actual: int) -> int:
    """计算HP_IV最大; -1 means no IV can produce the observed value."""
    values = _matching_iv_values(
        lambda iv: calculate_hp_stat(base, effort, level, iv), actual
    )
    return values[-1] if values else -1


def calculate_non_hp_iv_min(base: int, effort: int, level: int, actual: int,
                            nature: int, stat_index: int) -> int:
    """计算非HP_IV最小."""
    values = _matching_iv_values(
        lambda iv: calculate_non_hp_stat(base, effort, level, iv, nature, stat_index),
        actual,
    )
    return values[0] if values else -1


def calculate_non_hp_iv_max(base: int, effort: int, level: int, actual: int,
                            nature: int, stat_index: int) -> int:
    """计算非HP_IV最大."""
    values = _matching_iv_values(
        lambda iv: calculate_non_hp_stat(base, effort, level, iv, nature, stat_index),
        actual,
    )
    return values[-1] if values else -1


# ---------------------------------------------------------------------------
# 13_计算_自动校准.ecs
# ---------------------------------------------------------------------------


def signed_round_division(numerator: int, denominator: int) -> int:
    """带符号整除四舍五入."""
    if denominator <= 0:
        return 0
    if numerator >= 0:
        return _div(_i32(_i32(numerator) + _div(denominator, 2)), denominator)
    return _i32(-_div(_i32(-_i32(numerator) + _div(denominator, 2)), denominator))


def normalize_mod_period(error: int, period: int) -> int:
    """模周期归一($误差, $周期)."""
    if period <= 0:
        return error
    return _i32(_i32(error) - _i32(signed_round_division(error, period) * _i32(period)))


def ewa_update_center(center: int, measurement: int, beta_fixed: int,
                      ratio: int) -> int:
    """EWA更新中心."""
    delta = _i32(_i32(measurement) - _i32(center))
    return _i32(_i32(center) + signed_round_division(_i32(_i32(beta_fixed) * delta), ratio))


def candidate_mse(seed_distance: int, frame_distance: int,
                  seed_weight: int, frame_weight: int) -> int:
    """候选MSE评分."""
    seed_term = _i32(_i32(seed_weight) * _i32(seed_distance))
    seed_term = _i32(seed_term * _i32(seed_distance))
    frame_term = _i32(_i32(frame_weight) * _i32(frame_distance))
    frame_term = _i32(frame_term * _i32(frame_distance))
    return _i32(seed_term + frame_term)


def accumulate_execution_correction(current: int, added: int) -> int:
    """累加实际执行修正量."""
    return _i32(_i32(current) + _i32(added))


# ---------------------------------------------------------------------------
# 14_计算_等待参数.ecs
# ---------------------------------------------------------------------------


def frames_to_60fps_ms(frames: int) -> int:
    return _div(_i32(_i32(frames) * 100), 6)


def frames_to_120fps_ms(frames: int) -> int:
    return _div(_i32(_i32(frames) * 100), 12)


def calculate_normal_f2_frame(target: int, correction: int, f1_fixed: int,
                              f2_fixed: int, base_compensation: int) -> int:
    value = _i32(_i32(target) - _i32(correction))
    value = _i32(value - _i32(f1_fixed))
    value = _i32(value - _i32(f2_fixed))
    return _i32(value + _i32(base_compensation))


def calculate_tv_frame(target: int, correction: int, f1_fixed: int,
                       f2_fixed: int, base_compensation: int,
                       tv_frame_cost: int) -> int:
    value = calculate_normal_f2_frame(target, correction, f1_fixed, f2_fixed, base_compensation)
    return _div(value, tv_frame_cost)


def calculate_tv_mode_f2_frame(target: int, correction: int, f1_fixed: int,
                               f2_fixed: int, base_compensation: int,
                               tv_frame_cost: int) -> int:
    value = calculate_normal_f2_frame(target, correction, f1_fixed, f2_fixed, base_compensation)
    return _mod(value, tv_frame_cost)


def parity_adjusted_f1_frame(f1_frame: int, f2_frame: int) -> int:
    return _i32(_i32(f1_frame) + 1) if _mod(f2_frame, 2) != 0 else _i32(f1_frame)


def parity_adjusted_f2_frame(f2_frame: int) -> int:
    return _i32(_i32(f2_frame) - 1) if _mod(f2_frame, 2) != 0 else _i32(f2_frame)


def _callbacks() -> dict[str, Callable[..., object]]:
    """Public ECS names -> Python callbacks, kept in one auditable table."""
    return {
        # 11_计算_RNG基础.ecs
        "RNG下一LO": rng_next_lo,
        "RNG下一HI": rng_next_hi,
        "RNG前进N_HI": rng_advance_n_hi,
        "RNG前进N_LO": rng_advance_n_lo,
        "Static_PIDLO": static_pidlo,
        "Static_PIDHI": static_pidhi,
        "Static_IV1": static_iv1,
        "Static_IV2": static_iv2,
        "Static_性格": static_nature,
        "Static_未知图腾形态": static_unown_form,
        "Static_性别": static_gender,
        "Static_HPIV": static_hpiv,
        "Static_ATKIV": static_atkiv,
        "Static_DEFIV": static_defiv,
        "Static_SPEIV": static_speiv,
        "Static_SPAIV": static_spaiv,
        "Static_SPDIV": static_spdiv,
        # 12_计算_IV范围.ecs
        "取性格倍率": nature_multiplier,
        "计算HP能力值": calculate_hp_stat,
        "计算非HP能力值": calculate_non_hp_stat,
        "计算HP_IV最小": calculate_hp_iv_min,
        "计算HP_IV最大": calculate_hp_iv_max,
        "计算非HP_IV最小": calculate_non_hp_iv_min,
        "计算非HP_IV最大": calculate_non_hp_iv_max,
        # 13_计算_自动校准.ecs
        "带符号整除四舍五入": signed_round_division,
        "模周期归一": normalize_mod_period,
        "EWA更新中心": ewa_update_center,
        "候选MSE评分": candidate_mse,
        "累加实际执行修正量": accumulate_execution_correction,
        # 14_计算_等待参数.ecs
        "帧转60FPS毫秒": frames_to_60fps_ms,
        "帧转120FPS毫秒": frames_to_120fps_ms,
        "计算普通F2帧": calculate_normal_f2_frame,
        "计算TV帧": calculate_tv_frame,
        "计算TV模式F2帧": calculate_tv_mode_f2_frame,
        "奇偶修正后F1帧": parity_adjusted_f1_frame,
        "奇偶修正后F2帧": parity_adjusted_f2_frame,
    }


def extern_functions() -> dict[str, Callable[..., object]]:
    """Return callbacks for generated ``EXTERN`` calculation declarations."""
    return _callbacks()


__all__ = ["extern_functions"]
