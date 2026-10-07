"""Application-authored refinement policy, deliberately different from upstream.

Only generated ordinary wild/static runs use this policy. Device navigation,
OCR and IV intersection stay in ECS. See docs/FRLG_ADAPTIVE_REFINEMENT.md for
the changed stopping rules, evidence accounting and resource limits.
"""
from __future__ import annotations

import re
from .frlg_compute_runtime import calculate_hp_stat, calculate_non_hp_stat

MARKER = '# GUI_ADAPTIVE_REFINEMENT_V1'
DEFAULTS = {'refinement_candy_budget': 0, 'refinement_time_budget_ms': 600000}


def refinement_options(payload):
    result = {}
    for key, default in DEFAULTS.items():
        value = payload.get(key, default)
        maximum = 99 if key == 'refinement_candy_budget' else 21600000
        minimum = 0 if key == 'refinement_candy_budget' else 1000
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f'{key} 必须是 {minimum}–{maximum} 范围内的整数')
        result[key] = value
    return result


def first_informative_level(ivs, level, bases, efforts, nature, checkpoint=lambda: None):
    """Earliest later level separating any remaining IV vectors (not a truth).

    Check every level through 100. One unchanged observation is not evidence of
    stagnation: rounding can hide distinct IVs for many consecutive levels.
    Identical IV vectors cannot be separated by levelling at all.
    """
    vectors = sorted(set(ivs))
    if len(vectors) < 2:
        return 0
    for future in range(level + 1, 101):
        checkpoint()
        def stats(vector):
            return (calculate_hp_stat(bases[0], efforts[0], future, vector[0]),) + tuple(
                calculate_non_hp_stat(bases[i], efforts[i], future, vector[i], nature, (0, 1, 3, 4, 2)[i - 1])
                for i in range(1, 6))
        baseline = stats(vectors[0])
        if any(stats(vector) != baseline for vector in vectors[1:]):
            return future
    return 0


def install_refinement(source, outputs, types):
    """Install fail-closed, versioned hooks after upstream generation/migration.

    We keep the unmodified generator output in python_backup/main.ecs. This
    overlay must never be mistaken for parity with the original ECS policy.
    """
    if MARKER in source:
        return source
    start = source.index('FUNC 执行识图反查直到候选唯一(): INT\n')
    end = source.index('\nENDFUNC', start)
    block = source[start:end]
    def replace(old, new):
        nonlocal block
        if block.count(old) != 1:
            raise ValueError('自适应细分入口变化，需重新审计: ' + old[:70])
        block = block.replace(old, new, 1)
    replace('    $候选细分累计范围有效 = 0\n', '''    # 原创策略：普通目标按可分辨性升级；御三家和孵蛋保持原流程。
    $自适应细分启用 = 0
    IF $静态或野生 != "孵蛋" and 是否御三家目标() == 0
        $自适应细分启用 = Python细分开始($循环计数)
    ENDIF
    $自适应细分起始MS = TIME()
    $候选细分累计范围有效 = 0
''')
    anchor = '        IF $御三家严格筛选 == 1\n            PRINT 御三家完整候选保留:'
    if block.count(anchor) != 1:
        raise ValueError('自适应细分缺少唯一候选分支')
    pos = block.index(anchor)
    args = ['$等级', '$本轮糖果次数', '$自适应细分糖果预算',
            'TIME() - $自适应细分起始MS', '$自适应细分时间预算MS', '$识图性格']
    args += ['$种族' + stat for stat in ('HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE')]
    args += ['$努力' + stat for stat in ('HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE')]
    adaptive = '''        IF $自适应细分启用 == 1
            $自适应细分结果 = Python细分决策(''' + ', '.join(args) + ''')
            IF $自适应细分结果 == 1
                CALL 自适应细分应用结果
                CALL 输出最佳命中结果
                RETURN 1
            ELIF $自适应细分结果 == -1
                RETURN 3
            ENDIF
        ELSE
'''
    # The whole legacy stop/vote/stagnation branch is bypassed only in the new
    # policy. Candy navigation remains the exact existing ECS block below it.
    candy = '        IF $目标全国图鉴编号 == 175 and $波克比Seed复核已抓野生 == 1\n'
    if block.count(candy) != 2:
        raise ValueError('自适应细分糖果导航入口变化')
    candy_pos = block.index(candy)
    block = block[:pos] + adaptive + block[pos:candy_pos] + '        ENDIF\n\n' + block[candy_pos:]
    replace('        IF $神奇糖果结果 == 0\n', '''        IF $神奇糖果结果 == 0
            IF $自适应细分启用 == 1
                $自适应细分结果 = Python细分中止("神奇糖果已用完或使用失败")
                RETURN 3
            ENDIF
''')
    source = source[:start] + block + source[end:]
    outer = '        IF $反查细分成功 == -1\n'
    if source.count(outer) != 1:
        raise ValueError('自适应细分缺少唯一轮次出口')
    source = source.replace(outer, '''        IF $反查细分成功 == 3
            PRINT 自适应细分未消歧：保留最终候选，本轮不校准
            $循环计数 += 1
            BREAK
        ENDIF
''' + outer, 1)
    # Avoid the legacy common-candidate regeneration (which treats 199 as a
    # generating method), but carry its trusted evidence into calibration.
    trusted = '    IF ($御三家严格筛选 == 1 or $跨组筛选回退启用 == 1) and $御三家共同证据可信 == 1\n'
    if source.count(trusted) != 1:
        raise ValueError('自适应细分缺少唯一共同证据校准门控')
    source = source.replace(trusted,
        '    IF ($御三家严格筛选 == 1 or $跨组筛选回退启用 == 1 or $自适应细分启用 == 1) and $御三家共同证据可信 == 1\n', 1)
    declarations = '''# GUI_ADAPTIVE_REFINEMENT_V1
# 原创行为差异见 docs/FRLG_ADAPTIVE_REFINEMENT.md。
# 0颗预算表示按信息量升级至最高LV100；另有每只10分钟耗时预算。
$自适应细分糖果预算 = 0
$自适应细分时间预算MS = 600000
$自适应细分启用 = 0
$自适应细分起始MS = 0
$自适应细分结果 = 0
EXTERN FUNC Python细分开始($轮次: INT): INT FROM "python:frlg_main_reverse"
EXTERN FUNC Python细分中止($原因: STRING): INT FROM "python:frlg_main_reverse"
EXTERN FUNC Python细分取整数($键: STRING): INT FROM "python:frlg_main_reverse"
'''
    names = ('等级 糖果 糖果预算 耗时 时间预算 性格 HP ATK DEF SPA SPD SPE 努力HP 努力ATK 努力DEF 努力SPA 努力SPD 努力SPE').split()
    declarations += 'EXTERN FUNC Python细分决策(' + ', '.join('$' + name + ': INT' for name in names) + '): INT FROM "python:frlg_main_reverse"\n'
    source = declarations + source
    # Python already owns the selected candidate; read its result directly.
    # Calling the ordinary write/read wrapper here would overwrite it with the
    # last scanned candidate, particularly wrong for All Wild Methods (199).
    helper = '\nFUNC 自适应细分应用结果\n'
    for key in outputs:
        kind = types[key]
        helper += f'    ${key} = Python反查读{kind}("{key}")\n'
    helper += '''    $本轮真值解 = Python细分取整数("independent")
    $御三家共同证据可信 = Python细分取整数("commonTrusted")
    $跨组筛选回退启用 = 0
ENDFUNC
'''
    return source + helper


def configure_refinement(main, payload):
    """Freeze application options into the run and disclose them in plan.json."""
    import json
    options = refinement_options(payload)
    text = main.read_text(encoding='utf-8')
    for name, key in (('自适应细分糖果预算', 'refinement_candy_budget'),
                      ('自适应细分时间预算MS', 'refinement_time_budget_ms')):
        text, count = re.subn(rf'(?m)^\${name} = \d+$', f'${name} = {options[key]}', text)
        if count != 1:
            raise ValueError('生成脚本缺少自适应细分预算: ' + name)
    main.write_text(text, encoding='utf-8')
    manifest = main.with_name('plan.json')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    data.setdefault('runtime_overrides', {})['candidate_refinement'] = {
        'policy': MARKER.lstrip('# '), 'origin': 'application_authored', **options}
    manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
