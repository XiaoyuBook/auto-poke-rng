"""Cancellable BDSP worker. No Qt, camera or serial ownership.

Frames come from the C++ shared-memory ABI; scripts, native search and the
shared OCR service are requested through Electron over JSONL.
"""
from __future__ import annotations
import base64
from dataclasses import fields, is_dataclass, replace
from enum import Enum
import json
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

from auto_bdsp_rng.automation.auto_rng.models import AutoRngConfig, AutoRngPhase, AutoRngSeedResult, ShinyCheckResult
from auto_bdsp_rng.automation.auto_rng.runner import AutoRngRunner, AutoRngServices
from auto_bdsp_rng.automation.auto_rng.delay_strategy import DelayStrategyConfig, DelaySampleRound, calculate_delay
from auto_bdsp_rng.automation.auto_rng.scripts import validate_auto_scripts
from auto_bdsp_rng.automation.auto_tid_rng import AutoTidRngConfig, AutoTidRngPhase, AutoTidSeedResult, AutoTidRngRunner, AutoTidRngServices, predict_tid_elapsed_seconds
from auto_bdsp_rng.gen8_id import generate_ids
from auto_bdsp_rng.rng_core import SeedState32


class Cancelled(Exception):
    pass


class ScriptSnapshot:
    def __init__(self, name, text):
        self.name, self.text = name, text
    def read_text(self, **_kwargs):
        return self.text
    def __str__(self):
        return self.name
    def exists(self):
        return True


def reidentify_windows(noisy, hint, max_advances, *, exit_scene=False):
    """Return absolute endpoints (blink_core converts noisy ends to lengths)."""
    if exit_scene:
        return [(0, 1000000)]
    full = (0, 100000 if noisy else max(100000, max_advances))
    if hint is None:
        return [full]
    low = max(0, int(hint) - 10000)
    windows = [(low, max(low + 1, int(hint) + 20000))]
    fallbacks = [(max(0, int(hint) - 100000), max(0, int(hint) - 100000) + 100000),
                 (int(hint), int(hint) + 100000)] if noisy else [full]
    return list(dict.fromkeys(windows + fallbacks))


def discard_warmup(detector, started, timestamp):
    # Keep the pending single/double sample until the detector has returned to
    # IDLE; clearing it while SINGLE would make a second blink index an empty list.
    if len(detector.intervals) == 1 and detector.offset - started < 1 and timestamp - detector.offset > .7:
        detector.intervals.clear()
        detector.blinks.clear()


def serialize(value):
    if isinstance(value, SeedState32):
        return {'words': [f'{word:08X}' for word in value.words], 'pair': list(value.to_seed_pair64().format_seeds())}
    if isinstance(value, (Enum, Path, ScriptSnapshot)):
        return value.value if isinstance(value, Enum) else str(value)
    if is_dataclass(value):
        return {field.name: serialize(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, SimpleNamespace):
        return serialize(vars(value))
    if isinstance(value, dict):
        return {str(key): serialize(item) for key,item in value.items()}
    if isinstance(value, (list,tuple)):
        return [serialize(item) for item in value]
    return value


class Session:
    def __init__(self, config, emit):
        self.config, self.emit = config, emit
        self.cancel = threading.Event()
        self.battle = threading.Event()
        self.pending, self.counter = {}, 0
        self.lock = threading.Lock()
        self.runner = None

    def receive(self, message):
        if message.get('command') == 'stop':
            self.cancel.set()
            if self.runner:
                if self.config.get('kind') == 'tid':
                    self.runner.stop(message.get('reason') or '用户停止')
                else:
                    self.runner.stop()
        elif message.get('event') == 'battle':
            self.battle.set()
        elif 'id' in message:
            with self.lock:
                pending = self.pending.get(message['id'])
                if pending:
                    pending['response'] = message
                    pending['ready'].set()

    def check(self):
        if self.cancel.is_set():
            raise Cancelled('自动流程已停止')

    def request(self, method, **params):
        self.check()
        with self.lock:
            self.counter += 1
            identifier = self.counter
            pending = {'ready': threading.Event()}
            self.pending[identifier] = pending
        self.emit(event='request', id=identifier, method=method, params=serialize(params))
        try:
            while not pending['ready'].wait(.02):
                self.check()
            self.check()
            response = pending['response']
            if response.get('error'):
                raise RuntimeError(response['error'])
            return response.get('result')
        finally:
            with self.lock:
                self.pending.pop(identifier, None)

    def sleep(self, seconds):
        self.cancel.wait(max(0, seconds))
        self.check()

    def log(self, message):
        self.emit(event='log', message=message)

    def frame(self):
        import numpy as np
        from frames import Frames
        self.check()
        with Frames(self.config['video']['sharedMemory']) as frames:
            frame = frames.read(max_age_ms=500)
            if frame is None:
                raise RuntimeError('公共视频源没有可用的新画面')
            return np.frombuffer(frame.bgr, np.uint8).reshape(frame.height, frame.width, 3).copy()

    def ocr(self, image, operation='text', **options):
        import cv2
        ok, encoded = cv2.imencode('.png', image)
        if not ok:
            raise RuntimeError('OCR 图像编码失败')
        return self.request('ocr', imageBase64=base64.b64encode(encoded).decode('ascii'), operation=operation, **options)

    def run_script(self, text, name):
        return self.request('script', text=text, name=name)

    def capture(self, previous=None, *, exit_scene=False, tid=False):
        import numpy as np
        from frames import Frames
        from blink_core import BlinkDetector, decode_eye, match_eye, recover
        post_exit = exit_scene or (previous is not None and previous.after_exit_reseed)
        config = dict(self.config.get('exitBlink') or self.config['blink']) if post_exit else dict(self.config['blink'])
        config['mode'] = 'munchlax' if tid else 'reidentify' if previous else 'recover'
        if post_exit:
            config['noisy'] = True
        config['seed'] = [f'{word:08X}' for word in previous.seed.words] if previous else config['seed']
        count = 64 if tid else 20 if exit_scene or (previous and config['noisy']) else 7 if previous else 40
        eye = decode_eye(config['eye'])
        detector, gray_before, last_timestamp = None, None, None
        last_progress, last_frame_at, milestones = 0, time.monotonic(), set()
        with Frames(self.config['video']['sharedMemory']) as frames:
            while True:
                self.check()
                frame = frames.read(next_frame=True, max_age_ms=250)
                if frame is None:
                    if time.monotonic() - last_frame_at > 3:
                        raise RuntimeError('采集画面已中断')
                    self.sleep(.003)
                    continue
                last_frame_at = time.monotonic()
                timestamp = frame.timestamp_ns / 1e9
                if last_timestamp is not None and timestamp - last_timestamp > .2:
                    raise RuntimeError('视频帧间隔超过200毫秒，可能漏掉眨眼')
                last_timestamp = timestamp
                if (frame.width,frame.height) != (config['sourceWidth'],config['sourceHeight']):
                    raise RuntimeError('画面分辨率已改变，请重新框选')
                if detector is None:
                    detector = BlinkDetector(config['mode'], config['threshold'], count, timestamp)
                    started = timestamp
                pixels = np.frombuffer(frame.bgr,np.uint8).reshape(frame.height,frame.width,3)
                score, location, gray = match_eye(pixels,eye,config['roi'])
                detector.feed(score,timestamp,gray_before is None or not np.array_equal(gray,gray_before))
                gray_before = gray
                # Match the old capture warm-up rule: discard an early first blink.
                discard_warmup(detector, started, timestamp)
                done = len(detector.intervals)
                if time.monotonic() - last_progress >= .1:
                    self.emit(event='capture', captured=done,target=count,score=score,location=location)
                    last_progress = time.monotonic()
                if done and done % 10 == 0 and done < count and done not in milestones:
                    milestones.add(done)
                    # Do not block frame consumption while a keep-alive key completes.
                    self.emit(event='keepalive')
                if detector.done:
                    break
        hint = getattr(previous,'expected_advances_hint',None)
        windows = reidentify_windows(config['noisy'], hint, self.config['parameters'].get('max_advances', 100000), exit_scene=exit_scene)
        result = None
        for low,high in windows:
            self.check()
            config.update(searchMin=low,searchMax=high)
            try:
                rng, result = recover(config,detector.blinks,detector.intervals)
                break
            except ValueError:
                if (low,high) == windows[-1]:
                    raise
                self.log(f'校正范围 {low}..{high} 未命中，复用观测扩大范围')
        self.check()
        elapsed = 0 if tid else max(0,round(time.perf_counter()-detector.offset)) * (config['npc']+1)
        rng.advance(elapsed)
        state = SeedState32(*rng.get_state())
        now = time.monotonic()
        if tid:
            seed = AutoTidSeedResult(state,0,max(0,config.get('pokemonNpc',0)),' '.join(state.to_seed_pair64().format_seeds()),now,time.time())
        elif previous:
            timeline = bool(config['noisy'])
            seed = replace(previous,current_advances=(result['matchedAdvance'] or 0)+elapsed,npc=config['npc'],measured_at=now,
                advance_mode='timeline' if timeline else 'linear',timing_seed=state,
                timeline_npc=config.get('timelineNpc',0),pokemon_npc=max(1,config.get('pokemonNpc',0)) if timeline else 0,
                white_delay=config.get('timeDelay',0),advance_delay=config.get('advanceDelay',0),advance_delay_2=config.get('advanceDelay2',0))
        else:
            seed = AutoRngSeedResult(state,0,config['npc'],' '.join(state.to_seed_pair64().format_seeds()),now)
        self.emit(event='seed',seed=serialize(seed))
        return seed

    def search(self, seed, lead=None, nature=None, reverse=None):
        rows = self.request('search',seed=seed.seed,lead=lead,nature=nature,reverse=reverse)
        return [SimpleNamespace(**{**row,'pid':int(row['pid'],16),'ec':int(row['ec'],16)}) for row in rows]

    def recover_zoom(self):
        from auto_bdsp_rng.automation.auto_rng.zoom_recovery import recover_zoom_overlay, contains_zoom_overlay_text
        return recover_zoom_overlay(self.frame,self.run_script,
            detect_overlay=lambda image: contains_zoom_overlay_text(self.ocr(image)['text']),
            should_stop=self.cancel.is_set,sleep=self.sleep)

    def shiny(self,text,name,threshold):
        from auto_bdsp_rng.automation.auto_rng.dialog_timing import measure_keyword_interval, DialogKeywordTimeoutError
        starter = self.config['species'] in (387,390,393)
        roamer = self.config['species'] in (481,488)
        errors, done = [],threading.Event()
        self.battle.clear()
        def script():
            try:
                self.run_script(text,name)
            except BaseException as error:
                errors.append(error)
            finally:
                done.set()
        thread = threading.Thread(target=script,daemon=True)
        started = time.monotonic()
        thread.start()
        def check_script():
            self.check()
            if errors:
                raise errors[0]
            if time.monotonic()-started > 300:
                raise RuntimeError('撞闪脚本超过300秒，自动流程停止')
        if roamer:
            while not self.battle.wait(.05):
                check_script()
                if done.is_set():
                    return ShinyCheckResult(False)
        # OCR requests return text, while capture callbacks keep the monitor's
        # observation timestamp before inference, matching the reference.
        def read_dialog(image):
            check_script()
            return self.ocr(image,field='shiny_dialog')['text']
        try:
            timing = measure_keyword_interval(self.frame,read_dialog,
                first_keyword=('去吧','上吧') if starter else '出现了！',
                second_keyword=('战斗','戰鬥') if starter else ('去吧','上吧'),
                second_capture_frame=self.frame if starter else None,
                second_read_text=(lambda image:self.ocr(image,field='starter_battle')['text']) if starter else None,
                should_stop=lambda:self.cancel.is_set() or bool(errors),sleep=self.sleep,
                script_done=done,grace_seconds=30,hard_timeout_seconds=300,
                event_callback=lambda event:self.log(f'判闪 {event.event} · {event.keyword or ""} · {event.interval_seconds or event.elapsed_seconds:.3f}s'))
            result = ShinyCheckResult(timing.interval_seconds>=threshold,timing.interval_seconds)
        except DialogKeywordTimeoutError:
            result = ShinyCheckResult(False)
            self.log('判闪关键词超时，结果未知')
        while not done.wait(.05):
            check_script()
        check_script()
        return result

    def reverse(self,seed,target):
        from auto_bdsp_rng.automation.auto_rng.pokemon_info_ocr import compute_characteristic
        path = self.runner.config.reverse_script_path
        self.run_script(path.read_text(),path.name); self.sleep(1)
        notes = self.ocr(self.frame(),'notes')
        if notes.get('characteristic_match_failed'):
            self.log('个性匹配失败：ROI与全图均未命中，按性格和能力值反查')
        self.run_script('RIGHT 100\nWAIT 2000\n','反查翻页')
        rows = self.search(seed,reverse={'target':serialize(target),'nature':notes.get('nature')})
        labels = ['HP','攻击','防御','特攻','特防','速度']
        matches = []
        for expansion in (0,1,2):
            stats = self.ocr(self.frame(),'stats',expansion=expansion).get('stats') or {}
            if all(stats.get(label) for label in labels):
                matches = [row for row in rows if list(row.stats)==[stats[label] for label in labels]
                    and (not notes.get('characteristic') or compute_characteristic(row.ec,row.ivs)==notes['characteristic'])]
            if matches:
                break
            if expansion<2:
                self.sleep(.5)
        delay = target.used_delay if target.used_delay is not None else self.runner.config.fixed_delay
        delays = sorted({row.advances-target.raw_target_advances+delay for row in matches if row.advances-target.raw_target_advances+delay>=0})
        self.emit(event='history',name='reverse_result',args=serialize([matches,delays]))
        self.log(f'反查完成：{len(matches)} 个候选；实际 delay：{delays or "未匹配"}')
        return delays

    def resolve_delay(self):
        profile = self.request('delay_profile')
        result = calculate_delay(DelayStrategyConfig(**profile['config']),[DelaySampleRound(**sample) for sample in profile['samples']])
        self.emit(event='delay',value=result)
        return result

    def calibrate(self):
        from auto_bdsp_rng.automation.auto_rng.dialog_timing import measure_keyword_interval, suggested_shiny_threshold
        starter = self.config['species'] in (387, 390, 393)
        timing = measure_keyword_interval(self.frame, lambda image: self.ocr(image, field='shiny_dialog')['text'],
            first_keyword=('去吧','上吧') if starter else '出现了！',
            second_keyword=('战斗','戰鬥') if starter else ('去吧','上吧'),
            second_capture_frame=self.frame if starter else None,
            second_read_text=(lambda image: self.ocr(image, field='starter_battle')['text']) if starter else None,
            should_stop=self.cancel.is_set, sleep=self.sleep, timeout_seconds=45)
        self.emit(event='result', result={'interval': timing.interval_seconds, 'suggested': suggested_shiny_threshold(timing.interval_seconds)})

    def progress(self,value):
        self.emit(event='progress',progress=serialize(value),clock=time.monotonic(),wall=time.time())

    def run(self):
        c = self.config
        if c.get('command') == 'calibrate':
            self.emit(event='ready')
            self.calibrate()
            return
        if c.get('command') == 'delay-estimate':
            value = calculate_delay(DelayStrategyConfig(**c['profile']['config']),[DelaySampleRound(**sample) for sample in c['profile']['samples']])
            self.emit(event='result',result=value); return
        if c.get('command') == 'tid-preview':
            seed=SeedState32.from_hex_words(c['seed'])
            states=generate_ids(seed.to_seed_pair64(),max_advances=c['frame_threshold']+1)
            elapsed=predict_tid_elapsed_seconds(seed,[row.advances for row in states],should_stop=self.cancel.is_set)
            self.emit(event='result',result=serialize({'id_states':states,'id_elapsed_seconds':elapsed})); return
        parameters = c['parameters']
        scripts = {key:ScriptSnapshot(value['path'],value['text']) if value else None for key,value in c['scripts'].items()}
        if c['kind']=='tid':
            allowed = {field.name for field in fields(AutoTidRngConfig)}
            values = {key:value for key,value in parameters.items() if key in allowed}
            config = AutoTidRngConfig(**{**values,'script_dir':Path(c['scriptRoot']), 'seed_script_path':scripts.get('seed'), 'name_script_path':scripts.get('name'),
                'start_phase':AutoTidRngPhase.CAPTURE_TIDSID if parameters['start']=='capture' else AutoTidRngPhase.RUN_SEED_SCRIPT})
            services = AutoTidRngServices(capture_seed=lambda:self.capture(tid=True),run_script_text=self.run_script,
                recover_zoom_mode=self.recover_zoom,sleep=self.sleep)
            self.runner=AutoTidRngRunner(config,services=services,progress_callback=self.progress,log_callback=self.log)
        else:
            allowed = {field.name for field in fields(AutoRngConfig)}
            values = {key:value for key,value in parameters.items() if key in allowed}
            config=AutoRngConfig(**{**values,'script_dir':Path(c['scriptRoot']), 'target_species':c['species'],
                **{key+'_script_path':value for key,value in scripts.items()},
                'start_phase':{'script':AutoRngPhase.RUN_SEED_SCRIPT,'capture':AutoRngPhase.CAPTURE_SEED,'reidentify':AutoRngPhase.REIDENTIFY}[parameters['start']],
                'has_body_filters':any(f['heightMin']>0 or f['heightMax']<255 or f['weightMin']>0 or f['weightMax']<255 for f in parameters['filters'])})
            validate_auto_scripts(config.seed_script_path,config.advance_script_path,config.hit_script_path,
                escape_continue=config.escape_continue,escape_script_path=config.escape_script_path,
                shiny_threshold_seconds=config.shiny_threshold_seconds,target_species=c['species'])
            current=SeedState32.from_hex_words(c['blink']['seed']) if parameters['start']=='reidentify' else None
            services=AutoRngServices(capture_seed=self.capture,reidentify=self.capture,reidentify_exit=lambda seed:self.capture(seed,exit_scene=True),
                current_seed=lambda:AutoRngSeedResult(current,0,c['blink']['npc'],' '.join(current.to_seed_pair64().format_seeds()),time.monotonic()),
                search_candidates=self.search,search_sync=self.search,run_script_text=self.run_script,
                run_hit_script_with_shiny_check=self.shiny,run_reverse_lookup=self.reverse,
                resolve_round_delay=self.resolve_delay,record_delay_observation=lambda values:self.request('delay_record',candidates=values),
                recover_zoom_mode=self.recover_zoom,sleep=self.sleep)
            self.runner=AutoRngRunner(config,services=services,progress_callback=self.progress,log_callback=self.log,
                history_callback=lambda name,args:self.emit(event='history',name=name,args=serialize(args)))
        self.emit(event='ready')
        while not self.cancel.is_set():
            progress=self.runner.run(max_steps=10000)
            if progress.phase.value in ('已完成','失败'):
                self.emit(event='done',status='failed' if progress.phase.value=='失败' else 'completed',message=progress.log_message)
                return
        raise Cancelled('自动流程已停止')


def main():
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'clients'))
    for stream in (sys.stdin,sys.stdout,sys.stderr):
        stream.reconfigure(encoding='utf-8')
    output_lock=threading.Lock()
    def emit(**payload):
        with output_lock:
            print(json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')),flush=True)
    config=json.loads(sys.stdin.readline())
    session=Session(config,emit)
    def receive():
        for line in sys.stdin:
            try:
                session.receive(json.loads(line))
            except (ValueError,TypeError):
                session.cancel.set()
        session.receive({'command':'stop'})
    try:
        if config.get('command') not in ('tid-preview', 'delay-estimate'):
            # Native initialization may flush C stdio on Windows. Complete it
            # before the reader holds stdin's CRT lock waiting for a command.
            import numpy  # noqa: F401
            import cv2  # noqa: F401
            import blink_core  # noqa: F401
        threading.Thread(target=receive,daemon=True).start()
        session.run()
    except Cancelled as error:
        emit(event='done',status='stopped',message=str(error))
    except Exception as error:
        emit(event='done',status='stopped' if session.cancel.is_set() else 'failed',message=str(error))


if __name__=='__main__':
    main()
