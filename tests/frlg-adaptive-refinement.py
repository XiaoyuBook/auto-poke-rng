"""Original policy regressions; these are not upstream parity assertions."""
from dataclasses import replace
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'runtime/python'), str(ROOT / 'runtime/python/frlg_planner')]
from automation.frlg_candidate_refinement import first_informative_level, refinement_options
from automation.frlg_compute_runtime import calculate_non_hp_stat
from automation.frlg_main_reverse_runtime import MainReverseSession, STATS
from automation.frlg_vote_runtime import CalibrationVoteSession
from automation.frlg_bingo_runtime import BingoSession
from frlg_round_records import RoundRecorder


def candidate(index, frame, ivs=(0, 0, 0, 0, 0, 0), method=101):
    c = {key: 0 for key in ('当前候选距离 当前候选Seed距离 当前候选TV帧距离 '
         '当前候选剩余帧离群 当前候选Seed离群 当前候选TV帧离群 当前候选MSE 当前候选离群 '
         '个体性格 个体性别 野生锁定性格 野生PID尝试').split()}
    c.update(当前MS=100 + index, 当前Seed=f'{index:04X}', 当前消耗帧=frame,
             种子索引=index, 差索引=index - 10, 当前反查算法=method)
    c.update({'个体' + stat + 'IV': iv for stat, iv in zip(STATS, ivs)})
    return c


class AdaptivePolicy(unittest.TestCase):
    def session(self, candidates):
        vote = CalibrationVoteSession()
        vote.common_set_strict(1)
        logs = []
        session = MainReverseSession(seed_runtime=None, vote_session=vote, emit=logs.append)
        session.state.update(本轮候选命中计数=len(candidates), Seed累计修正索引=0, 消耗帧实际执行修正量=0)
        session.refinement_begin(1)
        session.refinement_candidates = candidates
        for c in candidates:
            vote.common_collect_pair(c['当前MS'], c['当前消耗帧'], c['种子索引'])
        return session, vote, logs

    def decide(self, s, level=3, candies=0, budget=0, elapsed=0):
        return s.refinement_decide(level, candies, budget, elapsed, 600000,
                                   0, 45, 30, 35, 20, 20, 45, *([0] * 6))

    def test_low_level_rounding_requires_more_than_eight_candies(self):
        vectors = [(0, 0, 0, 0, 0, 0), (0, 1, 0, 0, 0, 0)]
        self.assertEqual(first_informative_level(vectors, 3, (45, 30, 35, 20, 20, 45), [0] * 6, 0), 23)
        s, v, logs = self.session([candidate(10, 100, vectors[0]), candidate(11, 102, vectors[1])])
        for level in range(3, 13):
            self.assertEqual(self.decide(s, level, level - 3), 0)
        self.assertIn('NEXT_LEVEL=23', logs[-1])
        self.assertEqual(v.common_rounds, [])
        self.assertEqual(self.decide(s, 13, 10, budget=8), -1)
        self.assertEqual(len(v.common_rounds), 1)

    def test_nature_indices_and_nonzero_effort_match_ecs_stat_order(self):
        # ECS stores HP/ATK/DEF/SPA/SPD/SPE, whereas nature indices put SPE third.
        for offset, nature_index in enumerate((0, 1, 3, 4, 2), 1):
            first = (0,) * 6
            second = list(first)
            second[offset] = 1
            bases, efforts, nature = [30] * 6, [100] * 6, 14
            expected = next(level for level in range(4, 101)
                            if calculate_non_hp_stat(30, 100, level, 0, nature, nature_index)
                            != calculate_non_hp_stat(30, 100, level, 1, nature, nature_index))
            self.assertEqual(first_informative_level([first, tuple(second)], 3, bases, efforts, nature), expected)

    def test_identical_ivs_distinct_points_do_not_waste_candy_or_guess(self):
        s, v, logs = self.session([candidate(10, 100), candidate(11, 102)])
        self.assertEqual(self.decide(s), -1)
        self.assertNotIn('命中Seed', s.state)
        self.assertIn('升级能力值无法区分', logs[-1])
        self.assertEqual(len(v.common_rounds), 1)
        self.assertEqual(s.refinement_stop('重复结束'), -1)
        self.assertEqual(len(v.common_rounds), 1)

    def test_unique_points_enter_history_and_keep_actual_all_wild_method(self):
        s, v, _ = self.session([candidate(10, 100, method=104), candidate(10, 100, method=102)])
        self.assertEqual(self.decide(s), 1)
        self.assertEqual(s.state['命中反查算法'], 104)
        self.assertEqual(s.refinement_metrics['independent'], 1)
        self.assertEqual(len(v.common_rounds), 1)

    def test_prior_common_evidence_selects_only_current_candidate_pair(self):
        s, v, _ = self.session([candidate(11, 101, method=102), candidate(30, 400)])
        current = list(v.common_current)
        for index in (10, 11, 12):
            v.common_start()
            v.common_collect_pair(100 + index, 90 + index, index)
            v.common_submit()
        v.common_start()
        v.common_current = current
        self.assertEqual(self.decide(s), 1)
        self.assertEqual(s.state['命中消耗帧'], 101)
        self.assertEqual(s.state['命中反查算法'], 102)
        self.assertEqual(s.refinement_metrics['commonTrusted'], 1)

    def test_limits_overflow_failed_upgrade_and_candy_exhaustion_skip_calibration(self):
        candidates = [candidate(10, 100), candidate(11, 102, (0, 1, 0, 0, 0, 0))]
        for reason in ('time', 'overflow', 'no_progress', 'no_candy'):
            s, v, logs = self.session(candidates)
            if reason == 'time':
                result = self.decide(s, elapsed=600000)
            elif reason == 'overflow':
                s.refinement_overflow = True
                result = self.decide(s)
            elif reason == 'no_progress':
                self.assertEqual(self.decide(s), 0)
                result = self.decide(s, candies=1)
            else:
                result = s.refinement_stop('神奇糖果已用完或使用失败')
            self.assertEqual(result, -1)
            self.assertNotIn('命中Seed', s.state)
            self.assertIn('STATUS=unresolved', logs[-1])

    def test_configuration_is_strict_and_round_logs_do_not_invent_hits(self):
        self.assertEqual(refinement_options({})['refinement_candy_budget'], 0)
        for key, value in (('refinement_candy_budget', True), ('refinement_candy_budget', -1),
                           ('refinement_time_budget_ms', 0), ('refinement_time_budget_ms', 1000.5)):
            with self.assertRaises(ValueError):
                refinement_options({key: value})
        records = []
        recorder = RoundRecorder(records.append)
        recorder.consume('第2轮开始')
        recorder.consume('FRLG_REFINEMENT|V=1|CANDIDATES=32|POINTS=16|LEVEL=11|CANDIES=8|NEXT_LEVEL=23|STATUS=refining|REASON=继续升级')
        self.assertEqual(records[-1]['data']['nextObservationLevel'], 23)
        recorder.consume('FRLG_REFINEMENT|V=1|CANDIDATES=32|POINTS=16|LEVEL=11|CANDIES=8|NEXT_LEVEL=0|STATUS=unresolved|REASON=预算耗尽')
        self.assertEqual(records[-1]['data']['result'], '待消歧')
        self.assertNotIn('hitSeed', records[-1]['data'])

    def test_outside_display_counts_do_not_enter_the_original_grid(self):
        snapshots = []
        bingo = BingoSession(update=snapshots.append)
        for seed, frame in ((-2, -85), (1, -6)):
            bingo.set_context(seed, frame, 4, 4, 4, 20, 2107, 2310, 1, 0, 0, 314, 2, 2)
            self.assertEqual(bingo.record_hit(), 0)
        self.assertEqual(snapshots[-1]['reverseCount'], 2)
        self.assertEqual(snapshots[-1]['outsideCount'], 2)
        self.assertEqual(sum(map(sum, bingo.counts)), 0)
        bingo.set_context(1, 2, 4, 4, 4, 20, 2107, 2310, 1, 0, 0, 314, 2, 2)
        self.assertEqual(bingo.record_hit(), 1)
        self.assertEqual(sum(map(sum, bingo.counts)), 1)
        bingo.clear()
        self.assertEqual(snapshots[-1]['reverseCount'], 0)
        self.assertEqual(snapshots[-1]['outsideCount'], 0)


class GeneratedPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('reverse_fixture', ROOT / 'tests/frlg-main-reverse-migration.py')
        cls.fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.fixture)
        cls.fixture.MainReverseMigration.setUpClass()
        cls.addClassCleanup(cls.fixture.MainReverseMigration.doClassCleanups)

    def test_selected_candidate_bridge_preserves_wild_method_and_commits_evidence(self):
        f = self.fixture.MainReverseMigration()
        logs = []
        callbacks, session, vote = f.bindings(logs)
        setup = f.scan_setup(method=199, low=25296, high=25296)
        for stat, value in zip(STATS, (30, 28, 31, 31, 31, 30)):
            setup += f'${stat}最小 = {value}\n${stat}最大 = {value}\n'
        setup += '''CALL 御三家准备共同筛选
$x = Python细分开始(1)
$x = 执行反查扫描()
$x = Python细分决策(5, 0, 0, 0, 600000, 0, 75, 80, 70, 65, 75, 90, 0, 0, 0, 0, 0, 0)
CALL 自适应细分应用结果
PRINT "HIT=" & $命中Seed & "," & $命中消耗帧 & "," & $命中反查算法
PRINT "INDEPENDENT=" & $本轮真值解
'''
        f.probe(f.generated, setup).run(output=logs.append, extern_functions=callbacks)
        self.assertIn('HIT=7422,25296,101', ''.join(logs))
        self.assertIn('INDEPENDENT=1', ''.join(logs))
        self.assertEqual(len(vote.common_rounds), 1)

    def test_budgets_are_frozen_for_both_generated_entries(self):
        import tempfile
        from automation.planner import AutoSearchRequest, search_best_plan
        from frlg_execution import prepare
        request = json.loads((ROOT / 'tests/fixtures/frlg-golbat-plan.json').read_text())['request']
        request.update(direct_mode=True, direct_seed='7422', direct_advances=25296)
        plan = search_best_plan(AutoSearchRequest(**request)).plan
        with tempfile.TemporaryDirectory() as temporary:
            for entry in ('formal', 'timeline'):
                options = dict(entry=entry, refinement_candy_budget=20, refinement_time_budget_ms=900000)
                result = prepare(plan, dict(source=str(self.fixture.CORPUS), output=str(Path(temporary) / entry),
                                            calibrationStore=str(Path(temporary) / 'save.json'), options=options))
                main = Path(result['main'])
                text = main.read_text(encoding='utf-8')
                self.assertIn('$自适应细分糖果预算 = 20', text)
                self.assertIn('$自适应细分时间预算MS = 900000', text)
                policy = json.loads(main.with_name('plan.json').read_text(encoding='utf-8'))['runtime_overrides']['candidate_refinement']
                self.assertEqual(policy['origin'], 'application_authored')
                self.assertEqual(policy['refinement_candy_budget'], 20)

    def test_common_trusted_hit_enters_original_calibration_gate_without_legacy_regeneration(self):
        from easycon.native.engine import EasyConScriptEngine
        text = (self.fixture.MainReverseMigration.generated_root / 'main.ecs').read_text(encoding='utf-8')
        # Execute the actual generated calibration gate, with path gates
        # already closed. The remainder-frame freeze must retain precedence.
        start = text.index('    IF ($御三家严格筛选 == 1 or $跨组筛选回退启用 == 1 or')
        end = text.index('    $投票忽略 = 投票记真值解(', start)
        for trusted, allowed, expected in ((1, 1, 'GATES=1111'), (1, 0, 'GATES=1010'), (0, 1, 'GATES=0000')):
            logs = []
            setup = f'''$御三家严格筛选 = 0
$跨组筛选回退启用 = 0
$自适应细分启用 = 1
$御三家共同证据可信 = {trusted}
$本轮剩余帧校准允许 = {allowed}
$Seed本轮可信 = 0
$剩余帧本轮可信 = 0
$TV帧本轮可信 = 0
$消耗帧本轮可信 = 0
'''
            program = EasyConScriptEngine().compile(setup + text[start:end] +
                'PRINT "GATES=" & $Seed本轮可信 & $剩余帧本轮可信 & $TV帧本轮可信 & $消耗帧本轮可信\n')
            program.run(output=logs.append)
            self.assertIn(expected, ''.join(logs))

    def test_actual_generated_loop_feeds_past_eight_and_never_calls_legacy_stop(self):
        # Run the real generated ECS loop with device-free observations. Its
        # candidate scan has two IVs hidden until LV23, reproducing low levels.
        fixture = self.fixture.MainReverseMigration()
        program = fixture.generated
        text = Path(fixture.generated_root / 'main.ecs').read_text(encoding='utf-8')
        self.assertIn('GUI_ADAPTIVE_REFINEMENT_V1', text)
        self.assertIn('RETURN 3', text)
        callbacks, session, vote = fixture.bindings([])
        calls, logs = [], []
        def observation():
            session.state.update(本轮候选命中计数=2, Seed累计修正索引=0, 消耗帧实际执行修正量=0)
            session.refinement_candidates = [candidate(10, 100), candidate(11, 102, (0, 1, 0, 0, 0, 0))]
            vote.common_start()
            for c in session.refinement_candidates:
                vote.common_collect_pair(c['当前MS'], c['当前消耗帧'], c['种子索引'])
            return 1
        # Replace only device/scan functions; all new control flow is executed.
        from easycon.native.ast import FunctionDeclaration
        names = {'读取并输出识图结果', '准备反查参数与输出', '合并候选细分IV范围',
                 '执行反查扫描', '使用神奇糖果', '打开能力值识图页面', '校验野生遭遇初始等级'}
        def without_devices(unit):
            return replace(unit, statements=tuple(statement for statement in unit.statements
                if not isinstance(statement, FunctionDeclaration) or statement.name not in names))
        ast = replace(program.ast, main=without_devices(program.ast.main),
                      libraries=tuple(without_devices(unit) for unit in program.ast.libraries))
        program = replace(program, ast=ast)
        setup = '''$静态或野生 = "野生"
$目标全国图鉴编号 = 10
$循环计数 = 2
$等级 = 3
$识图性格 = 0
$种族HP = 45
$种族ATK = 30
$种族DEF = 35
$种族SPA = 20
$种族SPD = 20
$种族SPE = 45
$调试日志输出 = 0
CALL 御三家准备共同筛选
FUNC 读取并输出识图结果(): INT
    RETURN 1
ENDFUNC
FUNC 准备反查参数与输出(): INT
    RETURN 1
ENDFUNC
FUNC 合并候选细分IV范围(): INT
    RETURN 1
ENDFUNC
FUNC 校验野生遭遇初始等级(): INT
    RETURN 1
ENDFUNC
EXTERN FUNC 执行反查扫描(): INT FROM "test:scan"
EXTERN FUNC 使用神奇糖果(): INT FROM "test:candy"
FUNC 打开能力值识图页面
    $等级 += 1
ENDFUNC
$result = 执行识图反查直到候选唯一()
PRINT "RESULT=" & $result
PRINT "CANDY=" & $本轮糖果次数
'''
        callbacks['执行反查扫描'] = observation
        def candy():
            calls.append(1)
            return int(len(calls) <= 12)
        callbacks['使用神奇糖果'] = candy
        fixture.probe(program, setup).run(output=logs.append, extern_functions=callbacks)
        self.assertEqual(len(calls), 13)
        self.assertIn('RESULT=3', ''.join(logs))
        self.assertIn('CANDY=12', ''.join(logs))
        self.assertEqual(len(vote.common_rounds), 1)

    def test_candy_rescans_replace_provisional_votes_and_keep_final_evidence(self):
        f = self.fixture.MainReverseMigration()
        logs = []
        callbacks, session, vote = f.bindings(logs)
        setup = f.scan_setup(high=32, tolerance=1)
        setup += '$x = Python细分开始(2)\n$result = 执行反查扫描()\n'
        f.probe(f.generated, setup).run(output=logs.append, extern_functions=callbacks)
        first = list(vote.phase_table)
        count = session.state['本轮候选命中计数']
        session.scan()
        self.assertEqual(session.state['本轮候选命中计数'], count)
        self.assertEqual(vote.phase_table, first)

    def test_logged_caterpie_observations_reproduce_candidates_and_reported_hit_candidates(self):
        from automation.frlg_data_runtime import DataRuntime
        from automation.frlg_catalog_runtime import CatalogRuntime
        from automation.frlg_wild_data_runtime import WildDataRuntime
        from automation.frlg_compute_runtime import calculate_hp_iv_min, calculate_hp_iv_max, calculate_non_hp_iv_min, calculate_non_hp_iv_max
        f = self.fixture.MainReverseMigration()
        callbacks, session, vote = f.bindings([])
        callbacks.update(CatalogRuntime.from_project(f.generated_root).extern_functions())
        callbacks.update(WildDataRuntime.from_project(f.generated_root).extern_functions())
        data = DataRuntime.from_project(f.generated_root).extern_functions()
        setup = f.scan_setup(method=199, low=24296, high=26296, tolerance=20)
        setup += '''$目标全国图鉴编号 = 10
$目标消耗帧 = 25296
$性别阈值 = 127
$遭遇类型 = 2
$遭遇方法 = 101
$遭遇地点 = 规范化遭遇地点("常青森林")
$x = 加载野生遇敌槽数据()
CALL 御三家准备共同筛选
$x = 执行反查扫描()
'''
        f.probe(f.generated, setup).run(output=lambda _: None, extern_functions=callbacks)
        self.assertEqual(session.state['野生槽验证启用'], 1)
        fixture = json.loads((ROOT / 'tests/fixtures/frlg-caterpie-observations.json').read_text())
        last_round, ranges = None, {}
        for row in fixture['observations']:
            if row['round'] != last_round:
                last_round, ranges = row['round'], {}
                session.refinement_begin(last_round)
            s = session.state
            s['目标全国图鉴编号'] = row['species']
            bases = [data['取种族' + stat](1, row['species']) for stat in STATS]
            s['识图性格'], s['识图性别'], s['野生遭遇初始等级'] = row['nature'], row['gender'], row['level'] if not ranges else s['野生遭遇初始等级']
            for i, stat in enumerate(STATS):
                args = (bases[i], 0, row['level'], row['stats'][i])
                if i == 0:
                    low, high = calculate_hp_iv_min(*args), calculate_hp_iv_max(*args)
                else:
                    args += (row['nature'], (0, 1, 3, 4, 2)[i - 1])
                    low, high = calculate_non_hp_iv_min(*args), calculate_non_hp_iv_max(*args)
                old_low, old_high = ranges.get(stat, (0, 31))
                ranges[stat] = max(low, old_low), min(high, old_high)
                s[stat + '最小'], s[stat + '最大'] = ranges[stat]
            self.assertEqual(session.scan(), 1, row)
            if 'expectedCandidates' in row:
                self.assertEqual(s['本轮候选命中计数'], row['expectedCandidates'], row)
            if row['round'] == 1 and row['level'] == 7 or row['round'] == 6:
                points = {(c['当前Seed'], c['当前消耗帧']) for c in session.refinement_candidates}
                self.assertIn(('EBC0', 25211) if row['round'] == 1 else ('BD96', 25290), points)
                if row['round'] == 1:
                    self.assertEqual(points, {('EBC0', 25211), ('EBC0', 25217)})
                    self.assertEqual(self.decide_for_observation(session, row, bases), -1)
        # This replays the actual observations. No unobserved future abilities
        # are fabricated or claimed as successful real-device calibration.

    @staticmethod
    def decide_for_observation(session, row, bases):
        return session.refinement_decide(row['level'], row['level'] - 4, 0, 0, 600000,
                                         row['nature'], *bases, *([0] * 6))


if __name__ == '__main__':
    unittest.main()
