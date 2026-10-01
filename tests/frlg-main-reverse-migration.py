"""Regression: generated runs must execute the whole reverse scan in Python."""
from dataclasses import replace
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from automation.planner import AutoSearchRequest, search_best_plan
from frlg_execution import prepare
from easycon.native.engine import EasyConScriptEngine
from easycon.native.ast import Assignment, ExternDeclaration, FunctionDeclaration, ImportStatement
from easycon.native.parser import parse_text
from easycon.native.errors import ScriptCancelled
from automation.frlg_main_reverse_runtime import MainReverseSession, FUNCTIONS
from automation.seed_table_runtime import SeedTableRuntime
from automation.frlg_vote_runtime import CalibrationVoteSession
from automation.frlg_bingo_runtime import BingoSession
from automation.frlg_compute_runtime import extern_functions as compute_functions

CORPUS = Path(os.environ.get('FRLG_SCRIPT_CORPUS',
                            ROOT.parent / 'auto-poke-rng-scripts/bundles/frlg-automation/files'))


class MainReverseMigration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        root = Path(cls.temporary.name)
        request = json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text())['request']
        request.update(direct_mode=True, direct_seed='7422', direct_advances=25296)
        plan = search_best_plan(AutoSearchRequest(**request)).plan
        generated = prepare(plan, {'source': str(CORPUS), 'output': str(root / 'generated'),
                                  'calibrationStore': str(root / 'save.json'), 'options': {}})
        cls.generated_root = Path(generated['main']).parent
        cls.migration = json.loads((cls.generated_root / 'python_main_reverse.json').read_text(encoding='utf-8'))
        cls.generated = EasyConScriptEngine().load_file(generated['main'])
        # Restore the exact source AFTER GUI overrides, including downloaded Seed
        # tables, not a different version of the package or differently set PID cap.
        baseline = root / 'baseline'
        shutil.copytree(cls.generated_root / 'lib', baseline / 'lib')
        for backup in ('python_backup', 'seed_backup'):
            for path in (baseline / 'lib' / backup).glob('*.ecs'):
                shutil.copy2(path, baseline / 'lib' / path.name)
        shutil.copy2(cls.generated_root / 'python_backup/main.ecs', baseline / 'main.ecs')
        cls.baseline = EasyConScriptEngine().load_file(baseline / 'main.ecs')

    @staticmethod
    def probe(program, setup):
        declaration_types = (Assignment, FunctionDeclaration, ExternDeclaration, ImportStatement)
        first_flow = next(s.location.line for s in program.ast.main.statements
                          if not isinstance(s, declaration_types))
        declarations = tuple(s for s in program.ast.main.statements
                             if isinstance(s, (FunctionDeclaration, ExternDeclaration)) or s.location.line < first_flow)
        ast = replace(program.ast, main=replace(program.ast.main,
                      statements=declarations + parse_text(setup, '<reverse-probe>').statements))
        return replace(program, ast=ast)

    def bindings(self, output, checkpoint=lambda: None):
        seed = SeedTableRuntime.from_project(self.generated_root)
        vote = CalibrationVoteSession(seed_runtime=seed)
        session = MainReverseSession(seed_runtime=seed, vote_session=vote,
                                     emit=lambda line: output.append(line + '\n'), checkpoint=checkpoint)
        callbacks = {**seed.extern_functions(), **compute_functions(), **vote.extern_functions(),
                     **BingoSession().extern_functions(), **session.extern_functions()}
        return callbacks, session, vote

    def dump(self, label='state'):
        return '\n'.join(f'PRINT "{label}:{key}=" & ${key}' for key in self.migration['outputs']) + '\n'

    def compare(self, setup, *, trace=None, state_only=False):
        expected, actual = [], []
        started = time.perf_counter()
        self.probe(self.baseline, setup).run(output=expected.append)
        baseline_time = time.perf_counter() - started
        callbacks, session, vote = self.bindings(actual)
        started = time.perf_counter()
        self.probe(self.generated, setup).run(output=actual.append, extern_functions=callbacks, trace=trace)
        python_time = time.perf_counter() - started
        expected, actual = ''.join(expected).splitlines(), ''.join(actual).splitlines()
        if state_only:
            # lib/25's previously migrated common-region printer omits its old
            # diagnostic prose. Compare every scan state and tagged vote result;
            # other tests still compare scan diagnostics byte for byte.
            expected = [line for line in expected if re.match(r'^(\d+:|CAL:)', line)]
            actual = [line for line in actual if re.match(r'^(\d+:|CAL:)', line)]
        differences = [(left, right) for left, right in zip(expected, actual) if left != right]
        self.assertEqual(len(expected), len(actual), (expected, actual))
        self.assertEqual(differences, [])
        return actual, session, vote, baseline_time, python_time

    def scan_setup(self, method=101, low=0, high=40, tolerance=0, game=1):
        seed = SeedTableRuntime.from_project(self.generated_root)
        index = next(i for i in range(seed.get_max_index(game) + 1)
                     if seed.get_seed_hex(game, i, 0) == '7422') if game == 1 else 20
        text = f'''$游戏版本 = {game}
$Seed模式 = 0
$Seed最大索引 = 取Seed最大索引($游戏版本)
$目标索引 = {index}
$目标消耗帧 = {high}
$有效Seed容差 = {tolerance}
$有效最小消耗帧 = {low}
$有效最大消耗帧 = {high}
$反查算法 = {method}
$目标全国图鉴编号 = 42
$性别阈值 = 127
$识图性格 = 0
$识图性别 = -1
$野生槽验证启用 = 0
$调试日志输出 = 1
$进入TV = 0
$Seed累计修正索引 = 0
$消耗帧实际执行修正量 = 0
$跨组筛选收集启用 = 0
$御三家严格筛选 = 0
$probe = 投票设置配置(40, 81, 6, 13, 314, 2, 1, 20, 41, 4, 3)
CALL 投票重置
'''
        for stat in ('HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'):
            text += f'${stat}最小 = 0\n${stat}最大 = 31\n'
        return text

    def test_scan_methods_and_all_written_state_match_original_ecs(self):
        for method in (1, 2, 4, 101, 102, 104, 199):
            with self.subTest(method=method):
                setup = self.scan_setup(method, high=32, tolerance=1)
                setup += '$result = 执行反查扫描()\nPRINT $result\n' + self.dump()
                rows, *_ = self.compare(setup)
                self.assertIn('1', rows)

    def test_captured_golbat_and_updated_observation_expand_then_reject(self):
        setup = self.scan_setup(low=25295, high=25295)
        for stat, value in zip(('HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'), (30, 28, 31, 31, 31, 30)):
            setup += f'${stat}最小 = {value}\n${stat}最大 = {value}\n'
        setup += '$result = 执行反查扫描()\nPRINT "ROUND0=" & $result\n'
        setup += self.dump('miss')
        setup += '$有效最大消耗帧 = 25297\n$result = 执行反查扫描()\nPRINT "ROUND1=" & $result\n'
        setup += 'PRINT "HIT=" & $命中Seed & "," & $命中消耗帧 & "," & $本轮候选命中计数\n'
        setup += self.dump('hit')
        setup += '$HP最小 = 32\n$result = 执行反查扫描()\nPRINT "ROUND2=" & $result\n' + self.dump('new-iv')
        visited = []
        rows, _, _, old_time, new_time = self.compare(setup, trace=visited.append)
        self.assertIn('ROUND0=0', rows)
        self.assertIn('ROUND1=1', rows)
        self.assertIn('HIT=7422,25296,1', rows)
        self.assertIn('ROUND2=0', rows)
        # One result write per scan is allowed; the thousands of RNG steps must
        # never re-enter the ECS evaluator or produce per-step trace events.
        self.assertEqual(sum('临RAND' in point.action for point in visited), 4)  # initialization + 3 writes
        # No time threshold in CI: trace exclusion is the stable performance contract.
        print(f'Golbat 3 rounds: ECS={old_time:.3f}s Python={new_time:.3f}s')

    def test_tv_strict_common_region_and_vote_history_are_shared(self):
        setup = self.scan_setup(199, high=45, tolerance=1)
        setup += '''$进入TV = 1
$TV单次消耗帧 = 314
$跨组筛选收集启用 = 1
$御三家严格筛选 = 1
$Seed累计修正索引 = -2
$消耗帧实际执行修正量 = -5
$probe = 共同区设置严格模式(1)
$probe = 投票设置帧窗(3, -1, 4)
$probe = 投票设置Seed窗(0, 1)
$probe = 投票设置TV帧窗(3, 0, 1)
'''
        for n in range(2):
            setup += '$result = 执行反查扫描()\nPRINT $result\n' + self.dump(str(n))
            setup += '''$probe = 共同区提交()
PRINT "CAL:submit=" & $probe
$probe = 投票决策($进入TV, $消耗帧实际执行修正量, $Seed累计修正索引)
PRINT "CAL:decide=" & $probe
$probe = 投票取帧最高堆()
PRINT "CAL:peak=" & $probe
$probe = 共同区选择本轮配对()
PRINT "CAL:pair=" & $probe
$Seed累计修正索引 += 1
$消耗帧实际执行修正量 += 1
'''
        self.compare(setup, state_only=True)

    def test_roamer_gender_and_wild_slot_level_filters(self):
        setup = self.scan_setup()
        for method, species, gender in ((1, 243, 0), (2, 244, 254), (4, 245, 255),
                                        (101, 42, 127), (102, 42, 127), (104, 42, 127)):
            setup += f'''$当前反查算法 = {method}
$目标全国图鉴编号 = {species}
$性别阈值 = {gender}
$候HI = 38233
$候LO = 17010
CALL 按算法生成个体
$识图性格 = $个体性格
$识图性别 = $个体性别
$野生槽验证启用 = 1
$当前野生百分槽表 = [{','.join(['0'] * 100)}]
$当前野生槽打包表 = [{','.join([str(species + 512 * 10 + 65536 * 10)] * 12)}]
$野生遭遇初始等级 = 10
CALL 检查是否匹配
PRINT "MATCH=" & $匹配
'''
            setup += self.dump('matched')
            setup += '$识图性别 = 9\nCALL 检查是否匹配\nPRINT "GENDER=" & $匹配\n'
            setup += '$识图性别 = -1\n$野生遭遇初始等级 = 11\nCALL 检查是否匹配\n' + self.dump('level')
            setup += '$目标全国图鉴编号 = 1\nCALL 检查是否匹配\n' + self.dump('species')
            setup += '$当前野生百分槽表 = [' + ','.join(['-1'] * 100) + ']\nCALL 检查是否匹配\n' + self.dump('slot')
        rows, *_ = self.compare(setup)
        self.assertEqual(rows.count('MATCH=1'), 6)
        self.assertEqual(rows.count('GENDER=0'), 6)

    def test_runtime_host_binds_scanner_and_writes_state_back(self):
        # Exercise script_host.run itself: only the controller acquisition is
        # stubbed. No alternative test-only binder may hide a production omission.
        import script_host
        setup = self.scan_setup(high=45) + '$result = 执行反查扫描()\nPRINT "HOST=" & $本轮候选命中计数\n'
        program = self.probe(self.generated, setup)
        program = replace(program, external_labels=frozenset(), has_ocr=False, ocr_languages=frozenset())
        events, requests = [], []
        with patch.object(script_host, 'emit', events.append), patch.object(
                script_host, 'request', lambda method, params: requests.append(method)):
            script_host.run({'scriptDir': str(self.generated_root), 'rootDirectory': str(self.generated_root),
                             'name': program.source, 'text': ''}, program)
        self.assertEqual(requests, ['script.acquire'])
        self.assertEqual(events[-1], {'event': 'script.done', 'status': 'completed'})
        self.assertTrue(any(event.get('message', '').startswith('HOST=') and event['message'].strip() != 'HOST=0'
                            for event in events))

    def test_missing_seed_empty_frames_and_pid_retry_exhaustion(self):
        cases = ('$Seed模式 = 99\n', '$目标索引 = -500\n',
                 '$有效最小消耗帧 = 10\n$有效最大消耗帧 = 0\n',
                 '$野生PID尝试上限 = 0\n', '$野生PID尝试上限 = 1\n')
        for change in cases:
            with self.subTest(change=change):
                self.compare(self.scan_setup(199, high=3) + change +
                             '$result = 执行反查扫描()\nPRINT $result\n' + self.dump())

    def test_leafgreen_and_seed_table_boundary(self):
        for index in ('0', '$Seed最大索引'):
            with self.subTest(index=index):
                self.compare(self.scan_setup(1, high=24, tolerance=2, game=2) +
                             f'$目标索引 = {index}\n$result = 执行反查扫描()\nPRINT $result\n' + self.dump())

    def test_long_scan_cancels_inside_python_and_does_not_write_results(self):
        actual = []
        checks = 0
        def checkpoint():
            nonlocal checks
            checks += 1
            if checks == 5:
                raise ScriptCancelled('test stop')
        callbacks, *_ = self.bindings(actual, checkpoint)
        program = self.probe(self.generated, self.scan_setup(high=10000000) +
                             '$result = 执行反查扫描()\nPRINT "UNREACHABLE"\n')
        with self.assertRaises(ScriptCancelled):
            program.run(extern_functions=callbacks, output=actual.append)
        self.assertEqual(checks, 5)
        self.assertNotIn('UNREACHABLE', ''.join(actual))

    def test_actual_generated_entries_remove_the_ecs_scan_loop(self):
        request = json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text())['request']
        request.update(direct_mode=True, direct_seed='7422', direct_advances=25296)
        plan = search_best_plan(AutoSearchRequest(**request)).plan
        with tempfile.TemporaryDirectory() as temporary:
            for entry in ('formal', 'timeline'):
                with self.subTest(entry=entry):
                    generated = prepare(plan, {
                        'source': str(CORPUS), 'output': str(Path(temporary) / entry),
                        'calibrationStore': str(Path(temporary) / 'save.json'),
                        'options': {'entry': entry},
                    })
                    main = Path(generated['main'])
                    text = main.read_text(encoding='utf-8')
                    scan = re.search(r'(?ms)^FUNC 执行反查扫描.*?^ENDFUNC', text)[0]
                    self.assertNotIn('FOR ', scan, 'Seed/ADV scan still runs inside the ECS interpreter')
                    self.assertIn('Python反查执行入口', scan)
                    self.assertTrue((main.parent / 'python_main_reverse.json').is_file())
                    for name in FUNCTIONS:
                        block = re.search(rf'(?ms)^FUNC {name}.*?^ENDFUNC', text)[0]
                        self.assertNotRegex(block, r'(?m)^\s*(FOR|WHILE|IF) ')
                    EasyConScriptEngine().load_file(main)

    def test_egg_generator_migrates_the_shared_wild_seed_scanner(self):
        from automation.easycon118 import EggRunRequest, write_configured_egg_project
        request = EggRunRequest(game='fr_nx', seed_mode=0, target_seed='7422',
                                held_advances=1000, pickup_advances=4000, species_id=25,
                                compatibility=70, parent_a_gender='雌', parent_a_ivs=(31,) * 6,
                                parent_b_gender='雄', parent_b_ivs=(31,) * 6)
        with tempfile.TemporaryDirectory() as temporary:
            main = write_configured_egg_project(CORPUS, Path(temporary) / 'egg', request,
                                                precalibration_store_path=Path(temporary) / 'save.json')
            text = main.read_text(encoding='utf-8')
            scan = re.search(r'(?ms)^FUNC 执行反查扫描.*?^ENDFUNC', text)[0]
            self.assertNotIn('FOR ', scan)
            self.assertIn('Python反查执行入口', scan)
            self.assertTrue((main.parent / 'python_main_reverse.json').is_file())
            EasyConScriptEngine().load_file(main)


if __name__ == '__main__':
    unittest.main()
