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
from automation.frlg_candidate_refinement import DEFAULTS as REFINEMENT_OPTIONS, refinement_options, configure_refinement


def execution_options(payload, plan):
    if not isinstance(payload, dict):
        raise ValueError('运行参数必须是对象')
    if 'auto_complete_pokedex' in payload and not isinstance(payload['auto_complete_pokedex'], bool):
        raise ValueError('auto_complete_pokedex 必须是布尔值')
    refinement_options(payload)
    payload = {key: value for key, value in payload.items() if key not in {'entry', 'auto_complete_pokedex', *REFINEMENT_OPTIONS}}
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


def add_pokedex_confirmation(text, species_id, *, japanese_starter=False):
    """Observe the current attempt independently of optional calibration storage."""
    attempt = '        $本轮流程结果 = 执行RNG启动与目标获取()'
    if text.count(attempt) != 1:
        raise ValueError('火叶模板缺少唯一目标获取入口，无法记录图鉴完成证据')
    reset = '        CALL 清空最近出闪检测\n'
    if reset + attempt not in text:
        text = text.replace(attempt, reset + attempt, 1)
    text = text.replace(attempt, attempt + '\n        CALL 记录图鉴目标出闪', 1)
    if japanese_starter:
        # This fixed starter route detects shininess on its own summary page.
        # Feed that positive branch into the same per-attempt detector record.
        start = text.index('FUNC 读取并输出日版御三家识图结果(): INT\n')
        end = text.index('\nENDFUNC', start)
        block = text[start:end]
        shiny = '        PRINT 已识别到出闪，脚本停止'
        if block.count(shiny) != 1:
            raise ValueError('日版御三家缺少唯一出闪分支，无法记录图鉴完成证据')
        block = block.replace(shiny, f'        $图鉴出闪记录 = 记录最近出闪检测({species_id})\n' + shiny, 1)
        text = text[:start] + block + text[end:]
    return text + (
        '\n\nFUNC 记录图鉴目标出闪\n'
        f'    IF $循环计数 > 0 and 读取最近出闪检测结果() == 1 and 读取最近出闪检测图鉴编号() == {species_id}\n'
        f'        PRINT "FRLG_TARGET_CONFIRMED|V=1|DEX={species_id}|KIND=TARGET_SHINY"\n'
        '    ENDIF\nENDFUNC\n'
    )


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
    configure_refinement(main, payload.get('options', {}))
    if payload.get('options', {}).get('auto_complete_pokedex') is True:
        text = add_pokedex_confirmation(main.read_text(encoding='utf-8'), plan.species_id,
                                        japanese_starter=options.japanese_starter)
        main.write_text(text, encoding='utf-8')
    # Keep optional resources beside generated imports (never a source checkout).
    if (source / 'Tessdata').is_dir():
        shutil.copytree(source / 'Tessdata', output / 'Tessdata')
    return {'main': str(main), 'manifest': str(output / 'plan.json'), 'targetSpeciesId': plan.species_id,
            'options': json.loads((output / 'plan.json').read_text(encoding='utf-8'))['easycon118_options']}


def finalize(payload):
    record = update_from_manifest(payload['calibrationStore'], payload['manifest'], payload.get('log', ''))
    return {'calibrationUpdated': record is not None, 'record': record}
