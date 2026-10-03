"""Persist observed target shiny execution corrections without capture/reverse."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from automation.precalibration import (PrecalibrationContext, build_marker, parse_marker,
    read_record, update_record, update_from_log, update_from_manifest)
from easycon.native.engine import EasyConScriptEngine
from frlg_round_records import RoundRecorder

CORPUS = Path(os.environ.get('FRLG_SCRIPT_CORPUS',
    ROOT.parent / 'auto-poke-rng-scripts/bundles/frlg-automation/files'))


class PrecalibrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = self.root / 'precalibration.json'
        self.context = PrecalibrationContext('fr', 2, 8, 'FORMAL', 'WILD')

    def shiny(self, *, target=25, observed=25, seed=3, frame=-6):
        return build_marker(self.context, seed_index=seed, frame_enabled=True, frame_pre=frame) + (
            f'|EVIDENCE=TARGET_SHINY|TARGET_DEX={target}|OBSERVED_DEX={observed}')

    def test_target_shiny_saves_working_corrections_with_evidence(self):
        result = update_from_log(self.store, self.context, self.shiny())
        self.assertEqual((result['seed_ns2'], result['frame_ns2']), (3, -6))
        loaded = read_record(self.store, self.context)
        self.assertEqual(loaded['evidence'], {'kind': 'target_shiny', 'target_species_id': 25})
        self.assertIsNone(read_record(self.store, PrecalibrationContext('fr', 2, 8, 'FORMAL', 'WILD', 1)))

    def test_non_target_incomplete_and_unknown_evidence_do_not_save(self):
        for marker in [self.shiny(observed=81), self.shiny(target=0, observed=0),
                       self.shiny().replace('|OBSERVED_DEX=25', ''),
                       self.shiny().replace('TARGET_SHINY', 'UNKNOWN')]:
            self.assertIsNone(parse_marker(marker))
            with self.assertRaises(ValueError):
                update_from_log(self.store, self.context, marker)
            self.assertFalse(self.store.exists())

    def test_reverse_confirmation_is_preferred_and_latest_shiny_is_fallback(self):
        full = build_marker(self.context, seed_index=4, frame_enabled=True, frame_pre=-8)
        for text in [self.shiny() + '\n' + full, full + '\n' + self.shiny()]:
            record = update_from_log(self.store, self.context, text)
            self.assertEqual((record['seed_ns2'], record['frame_ns2']), (4, -8))
            self.assertEqual(record['evidence']['kind'], 'full_target_hit')
        record = update_from_log(self.store, self.context, self.shiny() + '\n' + self.shiny(seed=5))
        self.assertEqual(record['seed_ns2'], 5)

    def test_manifest_rejects_another_species_even_when_context_matches(self):
        manifest = self.root / 'plan.json'
        manifest.write_text(json.dumps({'precalibration': {'enabled': True,
            'context': self.context.to_dict(), 'target_species_id': 25}}), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '不是本次方案目标'):
            update_from_manifest(self.store, manifest, self.shiny(target=81, observed=81))
        self.assertFalse(self.store.exists())
        self.assertIsNotNone(update_from_manifest(self.store, manifest, self.shiny()))

    def test_recovery_evidence_survives_reload_and_old_schema_still_works(self):
        update_record(self.store, self.context, {'seed_ns2': 3, 'frame_ns2': -6})
        self.assertNotIn('evidence', read_record(self.store, self.context))
        evidence = {'kind': 'user_confirmed_target_shiny', 'round': 29,
                    'request': {'seedMs': 64170, 'f2': 10460}}
        update_record(self.store, self.context, {'seed_ns2': 3}, evidence=evidence)
        self.assertEqual(read_record(self.store, self.context)['evidence'], evidence)
        before = self.store.read_bytes()
        with self.assertRaises(ValueError):
            update_record(self.store, self.context, {'seed_ns2': 99}, evidence={'kind': 'unknown'})
        self.assertEqual(self.store.read_bytes(), before)

    def test_round_record_marks_shiny_without_inventing_reverse_coordinates(self):
        rows = []
        recorder = RoundRecorder(rows.append)
        recorder.consume('第29轮开始')
        recorder.consume(self.shiny())
        patch = rows[-1]['data']
        self.assertEqual(rows[-1]['number'], 29)
        self.assertEqual(patch['result'], '目标出闪')
        self.assertEqual(patch['executionCorrection'], {'seedIndex': 3, 'frame': -6})
        self.assertNotIn('hitSeed', patch)
        self.assertNotIn('hitFrame', patch)

    @unittest.skipUnless(CORPUS.is_dir(), 'Set FRLG_SCRIPT_CORPUS to installed scripts')
    def test_generated_formal_and_timeline_read_saved_values_and_guard_shiny_target(self):
        from automation.planner import AutoSearchRequest, search_best_plan
        from frlg_execution import prepare
        request = json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text(encoding='utf-8'))['request']
        request.update(direct_mode=True, direct_seed='7422', direct_advances=25296)
        plan = search_best_plan(AutoSearchRequest(**request)).plan
        for entry in ['formal', 'timeline']:
            context = PrecalibrationContext('fr', 1, plan.seed_mode,
                                            'FORMAL' if entry == 'formal' else 'TIMELINE', 'WILD')
            update_record(self.store, context, {'seed_ns1': 3, 'frame_ns1': -6},
                          evidence={'kind': 'target_shiny', 'target_species_id': plan.species_id})
            result = prepare(plan, {'source': str(CORPUS), 'output': str(self.root / entry),
                'calibrationStore': str(self.store), 'options': {'entry': entry, 'update_precalibration': True}})
            main = Path(result['main'])
            text = main.read_text(encoding='utf-8')
            manifest = json.loads(Path(result['manifest']).read_text(encoding='utf-8'))
            self.assertEqual(manifest['precalibration']['loaded']['seed_ns1'], 3)
            self.assertEqual(manifest['easycon118_options']['precalibration_frame_ns1'], -6)
            EasyConScriptEngine().load_file(main)
            self.assertIn('CALL 清空最近出闪检测\n        $本轮流程结果 =', text)
            helper = re.search(r'(?ms)^FUNC 保存目标出闪预校准\n.*?^ENDFUNC', text)[0]
            base = '\n'.join([
                'EXTERN FUNC 读取最近出闪检测结果(): INT FROM "python:test"',
                'EXTERN FUNC 读取最近出闪检测图鉴编号(): INT FROM "python:test"',
                '$循环计数 = 29', '$Seed累计修正索引 = 3', '$消耗帧实际执行修正量 = -6', helper])
            for enabled, shiny, dex, expected in [(1, 1, plan.species_id, True),
                    (1, 1, 25, False), (1, 0, plan.species_id, False), (0, 1, plan.species_id, False)]:
                logs = []
                EasyConScriptEngine().compile(base + f'\n$更新预校准 = {enabled}\nCALL 保存目标出闪预校准').run(
                    extern_functions={'读取最近出闪检测结果': lambda: shiny,
                                      '读取最近出闪检测图鉴编号': lambda: dex}, output=logs.append)
                markers = [line for line in logs if 'PRECALIBRATION_UPDATE|' in line]
                self.assertEqual(bool(markers), expected)
                if expected:
                    record = update_from_manifest(self.store, result['manifest'], ''.join(markers))
                    self.assertEqual(record['evidence']['kind'], 'target_shiny')


if __name__ == '__main__':
    unittest.main()
