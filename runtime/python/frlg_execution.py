"""Application adapter for the pinned FRLG ECS generator.

The generator owns route logic; the shared script host owns devices and OCR.
Only the main process supplies filesystem paths, never renderer plan objects.
"""
from dataclasses import fields
import json
from pathlib import Path
import shutil

from automation.easycon118 import (
    EasyCon118Options, write_configured_project,
    validate_generated_project_consistency, STANDARD_TEMPLATE_NAME, EGG_TEMPLATE_NAME,
)
from automation.precalibration import update_from_manifest


def execution_options(payload, plan):
    if not isinstance(payload, dict):
        raise ValueError('运行参数必须是对象')
    payload = {key: value for key, value in payload.items() if key != 'entry'}
    allowed = {field.name for field in fields(EasyCon118Options)}
    unknown = set(payload) - allowed
    if unknown:
        raise ValueError('未知运行参数: ' + ', '.join(sorted(unknown)))
    values = dict(payload)
    for field in fields(EasyCon118Options):
        value = values.get(field.name)
        if value is None:
            continue
        if isinstance(field.default, bool) and not isinstance(value, bool):
            raise ValueError(f'{field.name} 必须是布尔值')
        if (isinstance(field.default, int) and not isinstance(field.default, bool)
                or field.name.startswith('precalibration_') and field.name != 'precalibration_context_kind'
                or field.name in {'reverse_expansion_layers', 'togepi_seed_reverse_frame_half_width'}):
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f'{field.name} 必须是整数')
    for key in ('reverse_expansion_seed_tolerances', 'reverse_expansion_frame_half_widths'):
        if key in values and (not isinstance(values[key], (list, tuple))
                            or any(type(value) is not int for value in values[key])):
            raise ValueError(f'{key} 必须是整数数组')
    # ROM language and model follow the searched save, not independent UI fields.
    values['japanese_starter'] = '_jpn_' in plan.request.game
    values['nx_model'] = 2 if plan.request.game.endswith('nx2') else 1
    return EasyCon118Options(**values)


def prepare(plan, payload):
    options = execution_options(payload.get('options', {}), plan)
    entry = payload.get('options', {}).get('entry', 'formal')
    if entry not in ('formal', 'timeline'):
        raise ValueError('未知火叶脚本入口')
    template = STANDARD_TEMPLATE_NAME if entry == 'formal' else EGG_TEMPLATE_NAME
    source = Path(payload['source']).resolve()
    output = Path(payload['output']).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('生成目录必须与脚本包目录分离')
    if output.exists():
        raise ValueError('本次运行目录已存在，拒绝覆盖')
    if not source.is_dir():
        raise ValueError('请先在脚本库安装「火红叶绿／野生／静态自动流程」脚本包')
    # Do not copy junctions/symlinks into the generated execution snapshot.
    for entry in source.rglob('*'):
        if entry.is_symlink() or getattr(entry, 'is_junction', lambda: False)():
            raise ValueError('火叶脚本包不允许链接文件或目录')
    store = Path(payload['calibrationStore']).resolve()
    main = write_configured_project(source, output, plan, options,
                                    template_name=template,
                                    precalibration_store_path=store)
    validate_generated_project_consistency(main, plan, options, template_name=template)
    # Keep optional resources beside generated imports (never a source checkout).
    if (source / 'Tessdata').is_dir():
        shutil.copytree(source / 'Tessdata', output / 'Tessdata')
    return {'main': str(main), 'manifest': str(output / 'plan.json'),
            'options': json.loads((output / 'plan.json').read_text(encoding='utf-8'))['easycon118_options']}


def finalize(payload):
    record = update_from_manifest(payload['calibrationStore'], payload['manifest'], payload.get('log', ''))
    return {'calibrationUpdated': record is not None, 'record': record}
