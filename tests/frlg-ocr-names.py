"""Real ECS score parity, indexed pruning, sprite alternatives and timing markers."""
from pathlib import Path
from dataclasses import replace
import importlib.util
import json
import os
import random
import re
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from automation.frlg_ocr_names import OcrNameRuntime, candidate_score, materialize_ocr_names, _block
from easycon.native.engine import EasyConScriptEngine
from easycon.native.trace import ExecutionPoint
from easycon.native.errors import SourceLocation
from frlg_diagnostics import PhaseDiagnostics
from automation.frlg_data_runtime import DataRuntime
from automation.frlg_wild_data_runtime import WildDataRuntime
from automation.frlg_catalog_runtime import CatalogRuntime

CORPUS = Path(os.environ.get('FRLG_SCRIPT_CORPUS', ROOT.parent / 'auto-poke-rng-scripts/bundles/frlg-automation/files'))


@unittest.skipUnless(CORPUS.is_dir(), 'Set FRLG_SCRIPT_CORPUS to the audited script bundle')
class Names(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (CORPUS / 'lib/19_OCR_GEN3战斗场景名称.ecs').read_text(encoding='utf-8-sig')
        cls.names = json.loads(re.search(r'\$OCR候选词表 = (\[[^\n]+\])', cls.source)[1])

    def test_indexed_results_preserve_full_database_winner_for_typical_errors(self):
        r = OcrNameRuntime(self.names)
        rng = random.Random(42)
        cases = ['HAGNEHITE', 'PIKACHU', 'P1KACHU', 'PIKACH', 'IPKACHU',
                 'Wild GOLBAT appeared!', 'ZZZZZZZZZ', 'NIDORANXR']
        for _ in range(160):
            name = rng.choice(self.names)
            for _ in range(rng.randint(1, 2)):
                i = rng.randrange(len(name))
                if rng.random() < .35:
                    name = name[:i] + name[i + 1:]
                else:
                    name = name[:i] + rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + name[i + 1:]
            if name:
                cases.append(name)
        for raw in cases:
            if raw.startswith('NIDORAN'):
                continue  # Deliberate upstream aliases precede ranking.
            expected = raw if raw in self.names else min(self.names, key=lambda name: candidate_score(raw, name))
            self.assertEqual(r.correct(raw), expected, raw)

    def test_model_output_shortlists_without_scoring_all_names(self):
        records = []
        r = OcrNameRuntime(self.names, lambda **data: records.append(data))
        self.assertEqual(r.correct('HAGNEHITE'), 'MAGNEMITE')
        self.assertLess(records[-1]['scoredCount'], 30)
        self.assertEqual(records[-1]['candidates'], ['MAGNEMITE'])
        self.assertEqual(r.correct('MAGNEMITE'), 'MAGNEMITE')
        self.assertEqual(records[-1]['scoredCount'], 0)
        self.assertEqual(r.correct(''), '')
        self.assertEqual(r.choices, [])

    def test_scoring_matches_the_actual_ecs_function(self):
        funcs = '\n'.join(_block(self.source, name) for name in ('OCR最小3', 'OCR编辑距离', 'OCR公共前缀长度',
            'OCR去首字符', 'OCR清理比较文本', 'OCR名称候选得分'))
        pairs = [('HAGNEHITE', 'MAGNEMITE'), ('PIKACH', 'PIKACHU'), ('IPKACHU', 'PIKACHU'),
                 ('Wild GOLBAT appeared!', 'GOLBAT'), ('FARFETCHD', "FARFETCH'D"), ('ABC', 'ABRA')]
        program = EasyConScriptEngine().compile(funcs + '\n' + '\n'.join(
            '$score = OCR名称候选得分(' + json.dumps(a) + ', ' + json.dumps(b) + ')\nPRINT $score' for a, b in pairs))
        out = []
        program.run(output=out.append)
        self.assertEqual([int(x) for x in ''.join(out).splitlines()], [candidate_score(a, b) for a, b in pairs])

    def test_generated_wrapper_tries_candidates_and_retains_image_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'lib').mkdir()
            for name in ('19_OCR_GEN3战斗场景名称.ecs', '20_识图_抓捕对象名称识别.ecs'):
                shutil.copyfile(CORPUS / 'lib' / name, root / 'lib' / name)
            materialize_ocr_names(root)
            # Bind the actual generated lib20 wrapper with deterministic image
            # verdicts; avoid devices or hundreds of unused template getters.
            generated = (root / 'lib/20_识图_抓捕对象名称识别.ecs').read_text(encoding='utf-8')
            wrapper = _block(generated, 'OCR名称验证候选') + '\n' + _block(generated, '识别抓捕对象名称优先OCR')
            text = '''EXTERN FUNC OCR识别抓捕对象名称(): STRING FROM "test"
EXTERN FUNC OCR名称开始识别(): INT FROM "test"
EXTERN FUNC OCR名称遇敌筛选启用(): INT FROM "test"
EXTERN FUNC OCR名称V2后处理($raw: STRING): STRING FROM "test"
EXTERN FUNC OCR名称候选数量(): INT FROM "test"
EXTERN FUNC OCR名称候选读取($i: INT): STRING FROM "test"
EXTERN FUNC 英文名称查图鉴编号($name: STRING): INT FROM "test"
EXTERN FUNC OCR名称闪光匹配度确认($dex: INT, $threshold: INT): INT FROM "test"
EXTERN FUNC 识别抓捕对象名称($threshold: INT): STRING FROM "test"
''' + wrapper + '\n$result = 识别抓捕对象名称优先OCR(85)\nPRINT $result'
            for accepted in (2, 0):
                checked, out = [], []
                callbacks = {'OCR识别抓捕对象名称': lambda: 'PIKACHU', 'OCR名称候选数量': lambda: 2,
                    'OCR名称开始识别': lambda: 1, 'OCR名称遇敌筛选启用': lambda: 0,
                    'OCR名称候选读取': lambda i: ['PIKACHU', 'MAGNEMITE'][i],
                    '英文名称查图鉴编号': lambda name: 1 if name == 'PIKACHU' else 2,
                    'OCR名称闪光匹配度确认': lambda dex, threshold: checked.append(dex) or int(dex == accepted),
                    '识别抓捕对象名称': lambda threshold: 'fallback'}
                EasyConScriptEngine().compile(text).run(output=out.append, extern_functions=callbacks)
                self.assertEqual(checked, [1, 2])
                self.assertEqual(''.join(out).splitlines()[-1], 'MAGNEMITE' if accepted else 'fallback')
            # Upstream rule changes must cause an explicit migration error.
            shutil.copyfile(CORPUS / 'lib/19_OCR_GEN3战斗场景名称.ecs', root / 'lib/19_OCR_GEN3战斗场景名称.ecs')
            p = root / 'lib/19_OCR_GEN3战斗场景名称.ecs'
            p.write_text(p.read_text(encoding='utf-8-sig').replace('$OCR距离 * 1000', '$OCR距离 * 900'), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '规则已变化'):
                materialize_ocr_names(root)

    def test_phase_duration_includes_nested_ocr_but_not_player_entrance(self):
        records = []
        d = PhaseDiagnostics({'lib17': ['$n = 识别抓捕对象名称优先OCR(85)', '$dex = 英文名称查图鉴编号($n)',
            '$s = CheckCaptureShiny($dex, 85)', 'IF $s == 2']}, lambda **data: records.append(data))
        for source, line, second in [('lib17', 1, 1), ('lib19', 30, 2), ('lib17', 2, 3), ('lib17', 3, 4), ('lib20', 9, 5), ('lib17', 4, 6)]:
            d.observe(ExecutionPoint(SourceLocation(source, line, 1), 'step', second))
        self.assertEqual([x['elapsedMs'] for x in records if x['kind'] == 'phase.end'], [2000, 2000])
        d.close()
        self.assertFalse(any(x['kind'] == 'phase.interrupted' for x in records))


@unittest.skipUnless(CORPUS.is_dir(), 'Set FRLG_SCRIPT_CORPUS to the audited script bundle')
class EncounterScope(unittest.TestCase):
    """Original encounter constraints, distinct from the score parity above."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('reverse_fixture', ROOT / 'tests/frlg-main-reverse-migration.py')
        cls.fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.fixture)
        cls.fixture.MainReverseMigration.setUpClass()
        cls.addClassCleanup(cls.fixture.MainReverseMigration.doClassCleanups)
        cls.root = cls.fixture.MainReverseMigration.generated_root
        cls.data = DataRuntime.from_project(cls.root)
        cls.wild = WildDataRuntime.from_project(cls.root)
        cls.catalog = CatalogRuntime.from_project(cls.root).extern_functions()
        cls.names = json.loads((cls.root / 'python_ocr_names.json').read_text(encoding='utf-8'))['names']
        generated = (cls.root / 'lib/20_识图_抓捕对象名称识别.ecs').read_text(encoding='utf-8')
        cls.wrapper = _block(generated, 'OCR名称验证候选') + '\n' + _block(generated, '识别抓捕对象名称优先OCR')

    def runtime(self, records=None):
        return OcrNameRuntime(self.names, lambda **data: records.append(data) if records is not None else None,
                              data_runtime=self.data, wild_runtime=self.wild)

    def scope(self, runtime, location='常青森林', game=1, method=101, kind=2):
        return runtime.set_encounter_context(game, kind, method, self.catalog['规范化遭遇地点'](location))

    def test_all_forest_species_survive_including_rare_and_non_target_names(self):
        records = []
        r = self.runtime(records)
        self.assertEqual(self.scope(r), 5)
        pool = {'CATERPIE', 'METAPOD', 'WEEDLE', 'KAKUNA', 'PIKACHU'}
        self.assertEqual(r.allowed_names, pool)
        for raw in ('CATERPIE', 'HEEDLEt', 'MAGNEMITE', 'NIDORANXR'):
            r.correct(raw)
            self.assertEqual(set(r.choices), pool, raw)
            self.assertEqual(records[-1]['scoredCount'], 5)
            self.assertEqual(records[-1]['scopeCount'], 5)
            self.assertTrue(records[-1]['encounterContext']['enabled'])
        self.assertNotIn('MAGNEMITE', r.choices)  # Even an exact global name is restricted.

    def test_entire_audited_encounter_catalog_has_complete_recognition_pools(self):
        r = self.runtime()
        for key in self.wild.keys:
            game, method, location = key // 65536, key // 256 % 256, key % 256
            with self.subTest(game=game, method=method, location=location):
                self.assertGreater(r.set_encounter_context(game, 2, method, location), 0)
                self.assertLessEqual(len(r.allowed_names), 12)
                self.assertTrue(r.allowed_names <= r.exact)

    def test_version_location_and_encounter_method_replace_scope_instead_of_union(self):
        r = self.runtime()
        self.scope(r, '6号道路')
        self.assertEqual(r.allowed_names, {'PIDGEY', 'ODDISH', 'MEOWTH'})
        self.scope(r, '6号道路', game=2)
        self.assertEqual(r.allowed_names, {'PIDGEY', 'BELLSPROUT', 'MEOWTH'})
        self.scope(r, '6号道路', game=2, method=102)
        self.assertEqual(r.allowed_names, {'SLOWPOKE'})
        self.scope(r, '6号道路', method=201)
        self.assertEqual(r.allowed_names, {'MAGIKARP'})
        self.scope(r, '6号道路', method=202)
        self.assertEqual(r.allowed_names, {'MAGIKARP', 'POLIWAG', 'GOLDEEN'})
        self.scope(r, '真新镇', method=203)
        self.assertEqual(r.allowed_names, {'PSYDUCK', 'SHELLDER', 'HORSEA', 'SEADRA', 'GYARADOS'})

    def test_static_missing_or_incomplete_tables_clear_scope_and_retain_original_ranking(self):
        r = self.runtime()
        for args in ((1, 1, 101, 17), (1, 2, 199, 17), (1, 2, 101, 255)):
            self.scope(r)
            r.correct('CATERPIE')
            self.assertEqual(r.set_encounter_context(*args), 0)
            self.assertIsNone(r.allowed_names)
            self.assertEqual(r.choices, [])
            self.assertEqual(r.correct('HAGNEHITE'), 'MAGNEMITE')
        with patch.object(self.wild, 'packed', return_value=0):
            self.assertEqual(self.scope(r), 0)
            self.assertIsNone(r.allowed_names)
        with patch.object(self.data, 'target_en', return_value='UNKNOWN'):
            self.assertEqual(self.scope(r), 0)
            self.assertIsNone(r.allowed_names)
        without_tables = OcrNameRuntime(self.names)
        self.assertEqual(self.scope(without_tables), 0)
        self.assertEqual(without_tables.correct('HAGNEHITE'), 'MAGNEMITE')

    def test_nidoran_alias_preference_stays_inside_scope(self):
        r = self.runtime()
        self.scope(r, '3号道路')
        self.assertEqual(r.correct('NIDORAN'), 'NIDORAN♂')
        self.assertEqual(r.correct('NIDORANXR'), 'NIDORAN♀')
        self.scope(r)
        r.correct('NIDORAN')
        self.assertNotIn('NIDORAN♂', r.choices)
        self.assertEqual(len(r.choices), 5)

    def run_wrapper(self, *, raw, character_name, accepted, previous=None):
        r = self.runtime()
        self.scope(r)
        if previous:
            r.correct(previous)
        checked, fallback_calls, logs = [], [], []
        def read_ocr():
            # None models OCR NOT SUPPORT, which skips correct() entirely.
            return '' if raw is None else r.correct(raw)
        callbacks = {**r.extern_functions(), 'OCR识别抓捕对象名称': read_ocr,
            '英文名称查图鉴编号': self.data.english_to_id,
            'OCR名称闪光匹配度确认': lambda dex, threshold: checked.append(dex) or int(dex == accepted),
            '识别抓捕对象名称': lambda threshold: fallback_calls.append(threshold) or character_name}
        declarations = '''EXTERN FUNC OCR识别抓捕对象名称(): STRING FROM "test"
EXTERN FUNC OCR名称开始识别(): INT FROM "test"
EXTERN FUNC OCR名称遇敌筛选启用(): INT FROM "test"
EXTERN FUNC OCR名称V2后处理($raw: STRING): STRING FROM "test"
EXTERN FUNC OCR名称候选数量(): INT FROM "test"
EXTERN FUNC OCR名称候选读取($i: INT): STRING FROM "test"
EXTERN FUNC 英文名称查图鉴编号($name: STRING): INT FROM "test"
EXTERN FUNC OCR名称闪光匹配度确认($dex: INT, $threshold: INT): INT FROM "test"
EXTERN FUNC 识别抓捕对象名称($threshold: INT): STRING FROM "test"
'''
        EasyConScriptEngine().compile(declarations + self.wrapper +
            '\n$result = 识别抓捕对象名称优先OCR(85)\nPRINT "RESULT=" & $result').run(output=logs.append, extern_functions=callbacks)
        self.assertTrue(set(checked) <= {10, 11, 13, 14, 25})
        return checked, fallback_calls, ''.join(logs)

    def test_generated_image_confirmation_can_accept_rare_species_despite_bad_ocr(self):
        checked, fallbacks, logs = self.run_wrapper(raw='CATERPIE', character_name='', accepted=25)
        self.assertIn(25, checked)
        self.assertEqual(fallbacks, [])
        self.assertIn('RESULT=PIKACHU', logs)

    def test_character_fallback_cannot_escape_scope_or_accept_unverified_guesses(self):
        checked, fallbacks, logs = self.run_wrapper(raw=None, character_name='MAGNEMITE', accepted=13)
        self.assertEqual(fallbacks, [85])
        self.assertIn('RESULT=WEEDLE', logs)
        checked, fallbacks, logs = self.run_wrapper(raw='MAGNEMITE', character_name='PIKACHU', accepted=0)
        self.assertEqual(set(checked), {10, 11, 13, 14, 25})
        self.assertEqual(fallbacks, [85])
        self.assertIn('返回识别失败', logs)
        self.assertTrue(logs.endswith('RESULT=\n'))

    def test_unavailable_ocr_never_reuses_last_encounters_verified_choices(self):
        checked, fallbacks, logs = self.run_wrapper(raw=None, character_name='', accepted=25, previous='PIKACHU')
        self.assertEqual(checked, [])
        self.assertEqual(fallbacks, [85])
        self.assertTrue(logs.endswith('RESULT=\n'))

    def test_production_host_refreshes_actual_flow_scope_and_clears_it_for_static(self):
        import script_host
        f = self.fixture.MainReverseMigration()
        setup = '''$游戏版本 = 1
$遭遇类型 = 2
$遭遇方法 = 101
$遭遇地点 = 17
$x = 加载野生遇敌槽数据()
$name = OCR名称V2后处理("MAGNEMITE")
$count = OCR名称候选数量()
PRINT "FOREST=" & $count
$遭遇方法 = 102
$遭遇地点 = 99
$x = 加载野生遇敌槽数据()
$name = OCR名称V2后处理("TENTACOOL")
$count = OCR名称候选数量()
PRINT "LABYRINTH=" & $count
$遭遇类型 = 1
$x = 加载野生遇敌槽数据()
$name = OCR名称V2后处理("MAGNEMITE")
PRINT "STATIC=" & $name
'''
        program = f.probe(f.generated, setup)
        program = replace(program, external_labels=frozenset(), has_ocr=False, ocr_languages=frozenset())
        events = []
        with patch.object(script_host, 'emit', events.append), patch.object(script_host, 'request', lambda *_: None):
            script_host.run({'scriptDir': str(self.root), 'rootDirectory': str(self.root),
                             'name': program.source, 'text': '', 'diagnostics': True}, program)
        self.assertEqual(events[-1], {'event': 'script.done', 'status': 'completed'})
        logs = ''.join(event.get('message', '') for event in events if event.get('event') == 'script.log')
        self.assertIn('FOREST=5', logs)
        self.assertIn('LABYRINTH=3', logs)
        self.assertIn('STATIC=MAGNEMITE', logs)
        scopes = [event['context'] for event in events if event.get('kind') == 'ocr.encounter-scope']
        self.assertEqual([context['location'] for context in scopes], [17, 99, 99])
        self.assertEqual([context['enabled'] for context in scopes], [True, True, False])
        snapshot = json.loads((self.root / 'python_ocr_names.json').read_text(encoding='utf-8'))
        self.assertEqual(snapshot['application_policy'], 'GUI_OCR_ENCOUNTER_SCOPE_V1')
        self.assertTrue((self.root / snapshot['files']['main.ecs']['backup']).is_file())


if __name__ == '__main__':
    unittest.main()
