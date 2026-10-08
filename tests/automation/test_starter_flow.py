import os
from types import SimpleNamespace
import threading

import pytest

if os.environ.get('BDSP_CONTRACT_REFERENCE') == '1':
    pytest.skip('Built-in starter automation extends the frozen reference contract', allow_module_level=True)

from auto_bdsp_rng.automation.auto_rng.models import AutoRngConfig, AutoRngPhase, AutoRngSeedResult, AutoRngTarget, ShinyCheckResult
from auto_bdsp_rng.automation.auto_rng.runner import AutoRngRunner, AutoRngServices
from auto_bdsp_rng.automation.auto_rng.starter_flow import (
    DialogObserver, STARTER_TIMING, StarterFlow, StarterTargetMissed,
    TIMELINE_BUFFER, is_start_dialog, is_doctor_dialog, is_second_dialog,
    is_ball_dialog, normalize_dialog, selection_script, validate_starter_delay,
)
from auto_bdsp_rng.rng_core.seed import SeedState32
from blink_core import Xorshift
from blink_timing import BlinkTracking


class Clock:
    def __init__(self):
        self.now = 0.0
    def time(self):
        return self.now
    def sleep(self, seconds):
        self.now += seconds


def run_flow(species=387, delay=40, *, missing_second=False, stop_at=None, late_zero=None, script_log=None):
    clock, observations = Clock(), []
    scripts = [] if script_log is None else script_log
    seed = AutoRngSeedResult(SeedState32(0x12345678, 0x9ABCDEF0, 0x11111111, 0x22222222),
                             current_advances=1, npc=1, measured_at=0.0)
    target = AutoRngTarget(raw_target_advances=401)
    dialogue = ["怎么回事？刚才那两人……", "哦！我们去看看吧！", "怎么了？你说不要到草丛里去？",
                "………………", "没事没事！", "是个手提箱……", "一定是刚才那人掉的，怎么办？",
                "就是想还也不知道对方是谁啊，虽然有听到叫博士……"]
    index = 0
    paused_at_zero = False
    def text():
        nonlocal paused_at_zero
        timeline = flow.tracker.timeline
        at_first_zero = flow.tracker.countdown == 0 and timeline is None
        at_second_zero = timeline is not None and timeline.delay2_zero_at is not None
        if not paused_at_zero and ((late_zero == "first" and at_first_zero) or (late_zero == "second" and at_second_zero)):
            paused_at_zero = True
            clock.sleep(.2)  # Simulate a stalled worker after the clock update.
        if index < len(dialogue):
            return normalize_dialog(dialogue[index])
        if index == len(dialogue):
            return normalize_dialog("哇啊！宝、宝可梦！？")
        if index == len(dialogue)+1:
            return "其他对话" if missing_second else "搞什么啊"
        if index == len(dialogue)+2:
            return "是精灵球用它来应战吧"
        return "要选哪一只"
    def press(script, name):
        nonlocal index
        scripts.append((name, clock.time(), flow.tracker.update(clock.time())["advances"]))
        index += 1
        clock.sleep(.1)
    flow = StarterFlow(seed,target,delay,species,{"menuClose":True},latest_text=text,run_script=press,
                       monotonic=clock.time,sleep=clock.sleep,
                       progress=lambda stage,msg,current:observations.append((stage,current,clock.time())),
                       should_stop=lambda:stop_at is not None and clock.time()>=stop_at)
    result = flow.run()
    return result, scripts, observations, flow, seed


@pytest.mark.parametrize("species,rights", [(387,0),(390,1),(393,2)])
def test_starter_runs_two_clock_gates_then_selects_at_software_delay(species, rights):
    result,scripts,observations,flow,seed = run_flow(species)
    assert result.count("RIGHT") == rights
    assert any(line.startswith("UP ") for line in result.splitlines())
    assert scripts[0][0] == "御三家·起点对话"
    first = next(row for row in scripts if row[0] == "御三家·第一段归零")
    second = next(row for row in scripts if row[0] == "御三家·第二段归零")
    anchor = next(row for row in observations if row[0] == "first_countdown")
    assert anchor[1] == 401-TIMELINE_BUFFER
    # Replay both visible Timer zeroes; advance compensation occurs later.
    oracle = BlinkTracking(Xorshift(*seed.seed.words), {**STARTER_TIMING,"mode":"recover","menuClose":True},0,0,0)
    oracle.update(anchor[2])
    assert oracle.request_timeline()
    oracle.update(first[1])
    assert oracle.countdown == 0
    assert oracle.timeline is None
    assert first[1] == pytest.approx(anchor[2] + 11 * 1.018, abs=.021)
    assert first[2] == 401-200+22
    oracle.update(second[1])
    assert oracle.timeline is not None
    assert oracle.timeline.delay2_count == 0
    assert second[1] == pytest.approx(oracle.timeline.delay2_zero_at, abs=.021)
    assert oracle.timeline.delay2_at is None
    assert second[2] == 401-200+22+41+10
    assert sum(name == "御三家·第一段归零" for name, *_ in scripts) == 1
    assert sum(name == "御三家·第二段归零" for name, *_ in scripts) == 1
    oracle.update(observations[-1][2])
    assert flow.tracker.update(observations[-1][2])["advances"] == 401-40
    assert flow.tracker.rng.get_state() == oracle.rng.get_state()
    assert observations[-1][0] == "confirm"


@pytest.mark.parametrize("species,rights", [(387,0),(390,1),(393,2)])
def test_selection_only_uses_short_presses_without_menu_waits(species, rights):
    commands = [line.split() for line in selection_script(species).splitlines()]
    assert [command for command, _ in commands] == ["RIGHT"] * rights + ["A", "UP", "A"]
    durations = [int(duration) for _, duration in commands]
    assert all(0 < duration <= 30 for duration in durations)
    assert sum(durations) <= (rights + 3) * 30


def test_missed_second_dialog_never_returns_selection():
    with pytest.raises(RuntimeError,match="第二段|搞什么"):
        run_flow(missing_second=True)


def test_stop_during_countdown_does_not_dispatch_later_presses():
    with pytest.raises(RuntimeError,match="已停止"):
        run_flow(stop_at=105)


@pytest.mark.parametrize("stage", ["first", "second"])
def test_late_timer_zero_never_dispatches_a_later_countdown_press(stage):
    scripts = []
    with pytest.raises(StarterTargetMissed, match="倒计时按键超时"):
        run_flow(late_zero=stage, script_log=scripts)
    missed_press = "御三家·第一段归零" if stage == "first" else "御三家·第二段归零"
    assert all(name != missed_press for name, *_ in scripts)


@pytest.mark.parametrize("delay", [-1,78,100,200])
def test_impossible_software_delay_is_rejected_without_changing_200(delay):
    with pytest.raises(ValueError,match="200"):
        validate_starter_delay(delay)


def test_dialog_keywords_accept_recording_punctuation_and_traditional_chinese():
    assert is_start_dialog(normalize_dialog("久司：怎么回事？\n刚才那两人……"))
    assert is_doctor_dialog(normalize_dialog("就是想還也不知道對方是誰啊，雖然有聽到叫博士……"))
    assert is_second_dialog(normalize_dialog("搞什麼啊！"))
    assert is_ball_dialog(normalize_dialog("要選哪一隻？"))
    assert not is_doctor_dialog("好像是博士")


def test_slow_ocr_does_not_block_clock_reader_or_publish_after_close():
    entered, release = threading.Event(), threading.Event()
    def read():
        entered.set()
        release.wait(1)
        return "搞什么啊"
    observer = DialogObserver(read,lambda:False)
    observer.start()
    assert entered.wait(1)
    assert observer.latest() is None
    observer.close()
    release.set()
    observer.thread.join(1)
    assert observer.latest() is None


def test_builtin_runner_hands_back_to_reverse_and_freezes_delay_each_round(tmp_path):
    seed_path, reverse_path = tmp_path/'seed.ecs', tmp_path/'reverse.ecs'
    seed_path.write_text("A 100\n",encoding="utf-8")
    reverse_path.write_text("A 100\n",encoding="utf-8")
    seed = AutoRngSeedResult(SeedState32(1,2,3,4),1,1,measured_at=0)
    trace, saved = [], []
    delays = iter((40,42))
    config = AutoRngConfig(script_dir=tmp_path,seed_script_path=seed_path,reverse_script_path=reverse_path,
                           starter_automation=True,target_species=393,auto_reverse=True,fixed_delay=40,
                           loop_mode="count",loop_count=2)
    services = AutoRngServices(capture_seed=lambda:seed,search_candidates=lambda _:[SimpleNamespace(advances=401,pid=1,ec=2)],
        run_script_text=lambda text,name:trace.append(name),monotonic=lambda:0,
        resolve_round_delay=lambda:next(delays),
        run_starter_flow=lambda seed,target,delay:trace.append((target.used_delay,delay)) or ShinyCheckResult(False,1.0),
        run_reverse_lookup=lambda seed,target:trace.append("reverse") or (41,),
        record_delay_observation=lambda values:saved.append(values))
    runner = AutoRngRunner(config,services=services)
    assert runner.run().phase == AutoRngPhase.COMPLETED
    assert trace == ["seed.ecs",(40,40),"reverse","seed.ecs",(42,42),"reverse"]
    assert saved == [(41,),(41,)]


def test_shiny_and_unknown_results_keep_existing_stop_rules(tmp_path):
    seed = AutoRngSeedResult(SeedState32(1,2,3,4),1,1,measured_at=0)
    for result,phase in [(ShinyCheckResult(True,5.0),AutoRngPhase.COMPLETED),(ShinyCheckResult(False),AutoRngPhase.FAILED)]:
        config = AutoRngConfig(script_dir=tmp_path,start_phase=AutoRngPhase.CAPTURE_SEED,starter_automation=True,
                               target_species=387,auto_reverse=True,fixed_delay=40,record_shiny=False)
        reverse = []
        runner = AutoRngRunner(config,services=AutoRngServices(capture_seed=lambda:seed,monotonic=lambda:0,
            search_candidates=lambda _:[SimpleNamespace(advances=401,pid=1,ec=2)],
            run_starter_flow=lambda *_:result,run_reverse_lookup=lambda *_:reverse.append(True)))
        assert runner.run().phase == phase
        assert not reverse


def test_missed_timing_never_runs_reverse_or_reports_a_normal_encounter(tmp_path):
    seed = AutoRngSeedResult(SeedState32(1,2,3,4),1,1,measured_at=0)
    config = AutoRngConfig(script_dir=tmp_path,start_phase=AutoRngPhase.CAPTURE_SEED,starter_automation=True,
                           target_species=387,auto_reverse=True,fixed_delay=40,record_shiny=False)
    reverse,history = [],[]
    def missed(*_):
        raise StarterTargetMissed('已错过选择帧，本轮不选精灵')
    runner = AutoRngRunner(config,services=AutoRngServices(capture_seed=lambda:seed,monotonic=lambda:0,
        search_candidates=lambda _:[SimpleNamespace(advances=401,pid=1,ec=2)],
        run_starter_flow=missed,run_reverse_lookup=lambda *_:reverse.append(True)),
        history_callback=lambda event,args:history.append(event))
    result = runner.run()
    assert result.result_kind == 'missed'
    assert '错过选择帧' in result.log_message
    assert 'starter_missed' in history
    assert 'cycle_result' not in history
    assert not reverse
