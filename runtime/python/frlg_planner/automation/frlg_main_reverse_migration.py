"""把 main.ecs 的通用反查计算替换成一次调用的 Python 状态桥。"""
import hashlib
import json
from pathlib import Path
import re

from .frlg_main_reverse_runtime import FUNCTIONS

MARKER = '# PYTHON_MAIN_REVERSE_MIGRATION_V1'
SNAPSHOT = 'python_main_reverse.json'


def materialize_python_main_reverse(project_dir):
    root = Path(project_dir)
    main = root / 'main.ecs'
    source = main.read_text(encoding='utf-8-sig')
    if MARKER in source:
        raise ValueError('主脚本反查已迁移，拒绝覆盖原始审计副本')
    blocks = {}
    for name in (*FUNCTIONS, 'IV是否在范围'):
        matches = re.findall(rf'(?ms)^FUNC {re.escape(name)}(?:\([^\n]*\))?[^\n]*\n.*?^ENDFUNC', source)
        if len(matches) != 1:
            raise ValueError(f'主脚本反查缺少唯一函数: {name}')
        blocks[name] = matches[0]

    # 只同步这组函数涉及的主脚本全局变量，不把整个 ECS 环境暴露给 Python。
    # 每次进入都接收当前值，返回时写回原函数可能修改的变量；循环中无桥接调用。
    code = '\n'.join(blocks[name] for name in FUNCTIONS)
    code = '\n'.join(line.split('#', 1)[0] for line in code.splitlines())
    names = sorted(set(re.findall(r'\$([\w]+)', code)))
    writes = set(re.findall(r'(?m)^\s*\$([\w]+)\s*(?:[+\-*/%]?=)', code))
    writes.update(re.findall(r'FOR \$([\w]+) =', code))
    initial = dict(re.findall(r'(?m)^\$([\w]+) = ([^\n]+)', source.split('FUNC ', 1)[0]))
    # 原 处理匹配候选 内的局部临时量，不属于主脚本全局环境。
    local_names = {'当前候选帧原始', '当前候选离群', '投票忽略'}
    names = [name for name in names if name not in local_names]
    writes.difference_update(local_names)
    unknown = set(names) - initial.keys()
    if unknown:
        raise ValueError('反查状态不是已声明主脚本全局变量: ' + ', '.join(sorted(unknown)))
    types = {name: ('文本' if initial[name].startswith('"') else
                    '数组' if initial[name].startswith('[') else '整数') for name in names}
    if any(types[name] == '数组' for name in writes):
        raise ValueError('反查源代码新增数组写操作，需审计后扩展 Python 迁移')
    prefix = [MARKER,
              '# 主脚本纯反查计算→frlg_main_reverse_runtime.py；原文在 python_backup/main.ecs。',
              '# 以下 EXTERN 只同步当前状态；Seed/ADV/PID 循环和候选处理在 Python 内完成。']
    for kind, ecs_type in (('整数', 'INT'), ('文本', 'STRING'), ('数组', 'INT[]')):
        prefix.append(f'EXTERN FUNC Python反查写{kind}($键: STRING, $值: {ecs_type}): INT FROM "python:frlg_main_reverse"')
        if kind != '数组':
            prefix.append(f'EXTERN FUNC Python反查读{kind}($键: STRING): {ecs_type} FROM "python:frlg_main_reverse"')
    prefix.append('EXTERN FUNC Python反查执行入口($入口: STRING): INT FROM "python:frlg_main_reverse"')

    for name, method in FUNCTIONS.items():
        header = blocks[name].splitlines()[0]
        wrapper = [header,
                   f'    # 原 {name} → MainReverseSession.{method}；ECS 只负责输入/输出同步。']
        wrapper.extend(f'    CALL Python反查写{types[key]}("{key}", ${key})' for key in names)
        wrapper.append(f'    $Python反查返回值 = Python反查执行入口("{name}")')
        wrapper.extend(f'    ${key} = Python反查读{types[key]}("{key}")' for key in sorted(writes))
        if name == '执行反查扫描':
            wrapper.append('    RETURN $Python反查返回值')
        wrapper.append('ENDFUNC')
        source = source.replace(blocks[name], '\n'.join(wrapper))
    source = source.replace(blocks['IV是否在范围'],
        'EXTERN ' + blocks['IV是否在范围'].splitlines()[0] + ' FROM "python:frlg_main_reverse"')
    backup = root / 'python_backup' / 'main.ecs'
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(main.read_bytes())
    main.write_text('\n'.join(prefix) + '\n' + source, encoding='utf-8')
    payload = {
        'migration_version': 1,
        'runtime': 'runtime/python/frlg_planner/automation/frlg_main_reverse_runtime.py',
        'backup': 'python_backup/main.ecs',
        'sha256': hashlib.sha256(backup.read_bytes()).hexdigest(),
        'inputs': types,
        'outputs': sorted(writes),
        'functions': {name: {'python': FUNCTIONS.get(name, 'IV是否在范围'),
                             'sha256': hashlib.sha256(block.encode('utf-8')).hexdigest()}
                      for name, block in blocks.items()},
    }
    (root / SNAPSHOT).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return payload
