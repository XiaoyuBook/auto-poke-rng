"""Offline execution contracts against the actual audited FRLG script bundle."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from easycon.native.engine import EasyConScriptEngine
from easycon.native.ast import Assignment, FunctionDeclaration, ImportStatement
from easycon.native.parser import parse_text
from easycon.native.image_labels import load_image_labels
from automation.planner import AutoSearchRequest, search_best_plan
from automation.easycon118 import (EasyCon118Options, write_configured_project,
    validate_generated_project_consistency, inspect_script_corpus, inspect_label_corpus,
    EXPECTED_SCRIPT_SHA256, EXPECTED_LABEL_SHA256)
from automation.precalibration import build_marker, update_from_manifest, read_record, PrecalibrationContext
from frlg_execution import prepare

parser = argparse.ArgumentParser()
parser.add_argument('corpus', type=Path)
args, remaining = parser.parse_known_args()
CORPUS = args.corpus.resolve()
sys.argv = [sys.argv[0], *remaining]


class GeneratedRuntime(unittest.TestCase):
    def test_capture_observation_reverse_calibration_retry_and_exact_stop(self):
        program = EasyConScriptEngine().load_file(CORPUS / 'NS火叶全自动一键乱数2.0.ecs')
        first_flow = next(s.location.line for s in program.ast.main.statements
                          if not isinstance(s, (Assignment, FunctionDeclaration, ImportStatement)))
        declarations = tuple(s for s in program.ast.main.statements
                             if isinstance(s, FunctionDeclaration) or s.location.line < first_flow)
        # Recorded Golbat observation. Use the real table, scanner, candidate
        # selection and controller; only camera/controller orchestration is omitted.
        setup = '''$游戏版本 = 1
$Seed模式 = 0
$调试日志输出 = 0
$目标Seed = "7422"
$Seed最大索引 = 取Seed最大索引($游戏版本)
FOR $种子索引 = 0 TO $Seed最大索引
    $当前Seed = 取SeedHEX($游戏版本, $种子索引, $Seed模式)
    IF $当前Seed == $目标Seed
        $目标索引 = $种子索引
        BREAK
    ENDIF
NEXT
$目标SeedMS = 取MS($游戏版本, $目标索引)
$SeedMS = $目标SeedMS
$F1等待MS = 0
$TV等待MS = 0
$F2等待MS = 0
$目标消耗帧 = 25296
$有效Seed容差 = 0
$有效最小消耗帧 = 25295
$有效最大消耗帧 = 25297
$反查算法 = 101
$目标全国图鉴编号 = 42
$性别阈值 = 127
$识图性格 = 0
$识图性别 = -1
$野生槽验证启用 = 0
$HP最小 = 30
$HP最大 = 30
$ATK最小 = 28
$ATK最大 = 28
$DEF最小 = 31
$DEF最大 = 31
$SPA最小 = 31
$SPA最大 = 31
$SPD最小 = 31
$SPD最大 = 31
$SPE最小 = 30
$SPE最大 = 30
$probe = 执行反查扫描()
PRINT "SCAN=" & $probe & "," & $命中Seed & "," & $命中消耗帧 & "," & $本轮候选命中计数
$本轮真值解 = 1
$本轮物种命中 = 1
$进入TV = 0
$总消耗帧基础补偿 = 0
$目标消耗帧 = 25294
$probe = 执行自动校准与等待更新()
PRINT "RETRY=" & $probe & "," & $本轮消耗帧误差 & "," & $消耗帧实际执行修正量
$目标消耗帧 = 25296
$probe = 执行自动校准与等待更新()
PRINT "EXACT=" & $probe & "," & $本轮消耗帧误差
'''
        ast = replace(program.ast, main=replace(program.ast.main,
                      statements=declarations + parse_text(setup, '<reverse-calibration-probe>').statements))
        output = []
        replace(program, ast=ast).run(output=output.append)
        rows = ''.join(output).splitlines()
        self.assertIn('SCAN=1,7422,25296,1', rows)
        self.assertIn('RETRY=1,2,2', rows)
        self.assertIn('EXACT=0,0', rows)

    def test_actual_reverse_generator_and_match_reject_changed_iv(self):
        program = EasyConScriptEngine().load_file(CORPUS / 'NS火叶全自动一键乱数2.0.ecs')
        # Initialize the original globals and keep every original function, but
        # replace the hardware orchestration with a captured-individual probe.
        first_flow = next(s.location.line for s in program.ast.main.statements
                          if not isinstance(s, (Assignment, FunctionDeclaration, ImportStatement)))
        declarations = tuple(s for s in program.ast.main.statements
                             if isinstance(s, FunctionDeclaration) or s.location.line < first_flow)
        for fixture, method, species in [('frlg-golbat-plan.json', 101, 42), ('frlg-starter-plan.json', 1, 1)]:
            reference = json.loads((ROOT / 'tests/fixtures' / fixture).read_text())['target']
            seed = int(reference['target_seed'], 16)
            setup = f'''$候HI = {seed >> 16}
$候LO = {seed & 65535}
$当前反查算法 = {method}
$目标全国图鉴编号 = {species}
$性别阈值 = 127
$识图性格 = 0
$识图性别 = -1
$野生槽验证启用 = 0
CALL 按算法生成个体
PRINT $PIDHI
PRINT $PIDLO
'''
            for short, key in [('HP', 'hp'), ('ATK', 'attack'), ('DEF', 'defense'), ('SPA', 'sp_attack'), ('SPD', 'sp_defense'), ('SPE', 'speed')]:
                setup += f'$%s最小 = %d\n$%s最大 = %d\nPRINT $个体%sIV\n' % (short, reference['ivs'][key], short, reference['ivs'][key], short)
            setup += 'CALL 检查是否匹配\nPRINT $匹配\n$HP最小 = 32\nCALL 检查是否匹配\nPRINT $匹配\n'
            probe = parse_text(setup, '<capture-probe>')
            ast = replace(program.ast, main=replace(program.ast.main, statements=declarations + probe.statements))
            output = []
            replace(program, ast=ast).run(output=output.append)
            rows = ''.join(output).splitlines()
            self.assertEqual((int(rows[0]) << 16) | int(rows[1]), int(reference['pid'], 16))
            self.assertEqual(list(map(int, rows[2:8])), list(reference['ivs'].values()))
            self.assertEqual(rows[8:], ['1', '0'])

    def test_audited_corpus_and_all_referenced_labels(self):
        self.assertEqual(inspect_script_corpus(CORPUS)['sha256'], EXPECTED_SCRIPT_SHA256)
        self.assertEqual(inspect_label_corpus(CORPUS / 'ImgLabel')['sha256'], EXPECTED_LABEL_SHA256)
        labels = load_image_labels([CORPUS])
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        for name in ('NS火叶全自动一键乱数2.0.ecs', 'NS火叶全自动一键乱数2.0-时间轴.ecs'):
            program = EasyConScriptEngine().load_file(CORPUS / name)
            self.assertFalse(program.external_labels - labels.labels.keys())
            for name in program.external_labels:
                labels.labels[name].preflight(frame)

    def test_generated_wild_static_and_japanese_starter_compile(self):
        request = json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text())['request']
        requests = [request]
        # Direct mode isolates runtime route coverage from planner enumeration cost.
        for category, pokemon in [('Starter', 'Bulbasaur'), ('Fossil', 'Omanyte'), ('Gift', 'Togepi'),
                                  ('GameCorner', 'Abra'), ('Stationary', 'Snorlax'), ('Legend', 'Mewtwo'),
                                  ('Event', 'Deoxys'), ('Roaming', 'Suicune')]:
            requests.append({**request, 'method': 'Static 1', 'category': category, 'pokemon': pokemon,
                             'location': '', 'direct_mode': True, 'direct_seed': '7422', 'direct_advances': 25296})
        requests.append({**requests[1], 'game': 'fr_jpn_nx'})
        with tempfile.TemporaryDirectory() as temporary:
            for index, payload in enumerate(requests):
                with self.subTest(category=payload['category'], pokemon=payload['pokemon'], game=payload['game']):
                    plan = search_best_plan(AutoSearchRequest(**payload)).plan
                    generated = prepare(plan, {'source': str(CORPUS), 'output': str(Path(temporary) / str(index)),
                        'calibrationStore': str(Path(temporary) / 'save-a.json'),
                        'options': {'update_precalibration': True, 'entry': 'timeline' if index == 0 else 'formal'}})
                    program = EasyConScriptEngine().load_file(generated['main'])
                    self.assertTrue(program.requires_video)
                    self.assertFalse(program.external_labels - load_image_labels([Path(generated['main']).parent]).labels.keys())
                    text = Path(generated['main']).read_text(encoding='utf-8')
                    self.assertIn('PRECALIBRATION_UPDATE', text)
                    self.assertIn('反查', text)

    def test_real_rng_and_ocr_postprocessing_functions(self):
        # Actual imported libraries run inside our interpreter, with no device API.
        text = '''
$hi = RNG前进N_HI(0, 29730, 25296)
$lo = RNG前进N_LO(0, 29730, 25296)
PRINT $hi
PRINT $lo
$name = OCR名称V2后处理("Wild GOLBAT appeared!")
PRINT $name
$rounded = 带符号整除四舍五入(-15, 10)
PRINT $rounded
'''
        program = EasyConScriptEngine().compile(text, script_dir=CORPUS)
        output = []
        program.run(output=output.append)
        result = ''.join(output).splitlines()
        self.assertEqual((int(result[0]) << 16) | int(result[1]), 0x95594272)
        self.assertEqual(result[2], 'GOLBAT')
        self.assertEqual(result[3], '-2')

    def test_success_marker_never_crosses_save_or_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            plan = search_best_plan(AutoSearchRequest(**json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text())['request'])).plan
            generated = prepare(plan, {'source': str(CORPUS), 'output': str(Path(temporary) / 'run'),
                'calibrationStore': str(Path(temporary) / 'save-a.json'), 'options': {'update_precalibration': True}})
            manifest = json.loads(Path(generated['manifest']).read_text(encoding='utf-8'))
            context = PrecalibrationContext(**manifest['precalibration']['context'])
            marker = build_marker(context, seed_index=42, frame_pre=123, frame_enabled=True)
            record = update_from_manifest(Path(temporary) / 'save-a.json', generated['manifest'], marker)
            self.assertIsNotNone(record)
            self.assertIsNone(read_record(Path(temporary) / 'save-b.json', context))
            self.assertIsNone(read_record(Path(temporary) / 'save-a.json', replace(context, seed_startup_scheme=1)))
            resumed = prepare(plan, {'source': str(CORPUS), 'output': str(Path(temporary) / 'resumed'),
                'calibrationStore': str(Path(temporary) / 'save-a.json'), 'options': {'update_precalibration': True}})
            resumed_manifest = json.loads(Path(resumed['manifest']).read_text(encoding='utf-8'))
            self.assertTrue(resumed_manifest['precalibration']['loaded'])
            self.assertEqual(resumed_manifest['easycon118_options']['precalibration_seed_ns1'], 42)
            self.assertEqual(resumed_manifest['easycon118_options']['precalibration_frame_ns1'], 123)


if __name__ == '__main__':
    unittest.main()
