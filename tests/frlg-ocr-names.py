"""Real ECS score parity, indexed pruning, sprite alternatives and timing markers."""
from pathlib import Path
import json
import os
import random
import re
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from automation.frlg_ocr_names import OcrNameRuntime, candidate_score, materialize_ocr_names, _block
from easycon.native.engine import EasyConScriptEngine
from easycon.native.trace import ExecutionPoint
from easycon.native.errors import SourceLocation
from frlg_diagnostics import PhaseDiagnostics

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
            wrapper = _block((root / 'lib/20_识图_抓捕对象名称识别.ecs').read_text(encoding='utf-8'), '识别抓捕对象名称优先OCR')
            text = '''EXTERN FUNC OCR识别抓捕对象名称(): STRING FROM "test"
EXTERN FUNC OCR名称候选数量(): INT FROM "test"
EXTERN FUNC OCR名称候选读取($i: INT): STRING FROM "test"
EXTERN FUNC 英文名称查图鉴编号($name: STRING): INT FROM "test"
EXTERN FUNC OCR名称闪光匹配度确认($dex: INT, $threshold: INT): INT FROM "test"
EXTERN FUNC 识别抓捕对象名称($threshold: INT): STRING FROM "test"
''' + wrapper + '\n$result = 识别抓捕对象名称优先OCR(85)\nPRINT $result'
            for accepted in (2, 0):
                checked, out = [], []
                callbacks = {'OCR识别抓捕对象名称': lambda: 'PIKACHU', 'OCR名称候选数量': lambda: 2,
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


if __name__ == '__main__':
    unittest.main()
