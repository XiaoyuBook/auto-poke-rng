"""Indexed name correction; preserve FRLG scoring and prove pruning is safe.

Cheap length/letter bounds shortlist candidates before any edit-distance work.
Unlike a hard first-letter filter, these bounds tolerate an incorrect initial
letter and missing/extra characters. Sprite validation remains in ECS lib20.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import time

SNAPSHOT = "python_ocr_names.json"


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(row[j] + 1, current[-1] + 1, row[j - 1] + (x != y)))
        row = current
    return row[-1]


def prefix(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def clean(text):
    return ''.join(x for x in text if x not in "-.' WZ")


def base_score(raw, name):
    """Every non-distance term of the original OCR名称候选得分."""
    common = prefix(raw, name)
    score = abs(len(raw) - len(name)) * 60
    if raw and name:
        score += -80 if raw[0] == name[0] else 80
    if common >= 2:
        score -= 90
    if common >= 3:
        score -= 60
    score -= common * 70
    if common == len(name):
        score -= 180
        if len(name) <= 4:
            score -= 120
    if name in raw:
        score -= 140
    if clean(name) in clean(raw):
        score -= 420
    return score


def candidate_score(raw, name):
    score = distance(raw, name) * 1000 + base_score(raw, name)
    if len(raw) > 1 and len(name) > 1:
        tail = distance(raw[1:], name[1:])
        score -= 180 if tail <= 1 else 90 if tail <= 2 else 0
    return score


class OcrNameRuntime:
    def __init__(self, names, diagnostic=lambda **data: None):
        if not names or len(names) > 1000 or any(not isinstance(x, str) or not 1 <= len(x) <= 31 for x in names):
            raise ValueError('OCR 名称数据库无效')
        self.names = tuple(dict.fromkeys(names))
        self.exact = set(self.names)
        self.lengths = defaultdict(set)
        self.grams = defaultdict(set)
        self.counts = []
        for i, name in enumerate(self.names):
            self.lengths[len(name)].add(i)
            self.counts.append(Counter(name))
            for gram in set(zip(name, name[1:])):
                self.grams[gram].add(i)
        self.diagnostic = diagnostic
        self.choices = []

    @classmethod
    def from_project(cls, root, diagnostic=lambda **data: None):
        payload = json.loads((Path(root) / SNAPSHOT).read_text(encoding='utf-8'))
        if payload.get('migration_version') != 1:
            raise ValueError('OCR 名称迁移版本不受支持')
        return cls(payload['names'], diagnostic)

    def correct(self, raw):
        started = time.perf_counter_ns()
        self.choices = []
        raw = str(raw)
        mode, scored = 'exact', 0
        scores = []
        if raw in self.exact:
            self.choices = [raw]
        elif raw in ('NIDORANXR', 'NIDORANL', 'NIDORANO', 'NIDORANA', 'NIDORANQ', 'NIDORAN♀'):
            self.choices = ['NIDORAN♀']; mode = 'alias'
        elif raw in ('NIDORAN', 'NIDORANZ', 'NIDORANWA', 'NIDORANX', 'NIDORAN♂'):
            self.choices = ['NIDORAN♂']; mode = 'alias'
        elif raw == '|SATUQ|HATU|HNATUY|':  # Preserve the upstream literal rule.
            self.choices = ['XATU']; mode = 'alias'
        elif raw.strip() and len(raw) <= 64:
            mode = 'indexed'
            lengths = set().union(*(self.lengths[n] for n in range(max(1, len(raw) - 2), len(raw) + 3)))
            votes = Counter(i for gram in set(zip(raw, raw[1:])) for i in self.grams.get(gram, ()))
            initial = sorted(lengths & votes.keys(), key=lambda i: (-votes[i], i))[:6]
            results = {i: candidate_score(raw, self.names[i]) for i in initial}
            raw_counts = Counter(raw)
            bounds = []
            for i, name in enumerate(self.names):
                if i in results:
                    continue
                # One substitution changes at most two letter counts; one
                # insertion/deletion changes one. This is a true lower bound.
                delta = sum((raw_counts - self.counts[i]).values()) + sum((self.counts[i] - raw_counts).values())
                lower_distance = max(abs(len(raw) - len(name)), (delta + 1) // 2)
                lower_score = lower_distance * 1000 + base_score(raw, name)
                if len(raw) > 1 and len(name) > 1:
                    lower_score -= 180  # Maximum possible tail bonus.
                bounds.append((lower_score, i))
            best = min(results.values(), default=float('inf'))
            for lower, i in sorted(bounds):
                # Retain nearby alternatives for sprite validation as well as
                # the winner. Never prune by a guessed hard letter/prefix rule.
                if lower > best + 1000:
                    break
                results[i] = candidate_score(raw, self.names[i])
                best = min(best, results[i])
            scored = len(results)
            ranked = sorted(results, key=lambda i: (results[i], i))
            scores = [{'name': self.names[i], 'score': results[i]} for i in ranked]
            self.choices = [self.names[i] for i in ranked if results[i] <= best + 1000][:8]
        else:
            mode = 'empty_or_invalid'
        result = self.choices[0] if self.choices else ''
        self.diagnostic(kind='ocr.name-correction', raw=raw, corrected=result, mode=mode,
                        databaseCount=len(self.names), scoredCount=scored, candidates=self.choices, scores=scores,
                        elapsedMs=round((time.perf_counter_ns() - started) / 1e6, 3))
        return result

    def extern_functions(self):
        return {'OCR名称V2后处理': self.correct, 'OCR名称候选数量': lambda: len(self.choices),
                'OCR名称候选读取': lambda i: self.choices[int(i)] if 0 <= int(i) < len(self.choices) else ''}


def _block(text, name):
    match = re.search(r'^FUNC ' + re.escape(name) + r'\([^\n]*\n.*?^ENDFUNC', text, re.M | re.S)
    if not match:
        raise ValueError('OCR 迁移缺少函数: ' + name)
    return match[0]


def materialize_ocr_names(root):
    root = Path(root)
    library = root / 'lib' / '19_OCR_GEN3战斗场景名称.ecs'
    text = library.read_text(encoding='utf-8-sig')
    # Scoring changes must be reviewed when syncing upstream; don't silently
    # apply a Python algorithm to a different ECS contract.
    expected = {
        'OCR编辑距离': '8bf59bc50c040ed5c6acb807bd7311711bb61ecf9a7e91d0afe41018b5c8326c',
        'OCR最小3': 'dfa2e54820255fcc751dd5308cab1aa7c04e403e57eaa4d76eeb023d37ea774b',
        'OCR公共前缀长度': '7dd8376aa574e24767ab9e8811d11d7cefa49e98f9af4601f95b09c05a03f626',
        'OCR去首字符': 'f23a7191a3c97eb537b897061516d48dec952009d906f73455526f673440814a',
        'OCR清理比较文本': '7c98d231ed1e91486c2ec271a62e0b911a92022d6fc74df5cc2f33bbb04a1afa',
        'OCR名称候选得分': '6b13896c70d79a3d6b66fad95ba156a79ecaa794920f793f72a0b3a26422371c',
    }
    for name, sha in expected.items():
        if hashlib.sha256(_block(text, name).encode()).hexdigest() != sha:
            raise ValueError('上游 OCR 纠错规则已变化，需要审核 Python 迁移: ' + name)
    original = _block(text, 'OCR名称V2后处理')
    rules = re.sub(r'\$OCR候选词表 = \[[^\n]+\]', '$OCR候选词表 = DATABASE', original)
    if hashlib.sha256(rules.encode()).hexdigest() != '7566fff6a7e1f891bd199a57cacf3ec2a3b77449108bd4f28cb8fb2206477de3':
        raise ValueError('上游 OCR 候选/别名规则已变化，需要审核 Python 迁移')
    match = re.search(r'\$OCR候选词表 = (\[[^\n]+\])', original)
    if not match:
        raise ValueError('OCR 迁移缺少名称数据库')
    names = json.loads(match[1])
    OcrNameRuntime(names)  # Validate before rewriting anything.
    name_library = root / 'lib' / '20_识图_抓捕对象名称识别.ecs'
    name_text = name_library.read_text(encoding='utf-8-sig')
    original_name = _block(name_text, '识别抓捕对象名称优先OCR')
    if hashlib.sha256(original_name.encode()).hexdigest() != 'c526a0b3a463a195e1f36e9b4d44536afc770db2038c8f8a1a0478d0aa8f0b52':
        raise ValueError('上游 OCR 图像验证流程已变化，需要审核 Python 迁移')
    backup = root / 'lib' / 'ocr_backup'
    backup.mkdir(exist_ok=True)
    backup.joinpath(library.name).write_bytes(library.read_bytes())
    library.write_text(text.replace(original,
        '# GUI_OCR_NAMES_PYTHON_V1：候选筛选与纠错由 Python 执行；原规则保存在 lib/ocr_backup。\n'
        'EXTERN FUNC OCR名称V2后处理($OCR原文: STRING): STRING FROM "python:frlg_ocr_names"\n'
        'EXTERN FUNC OCR名称候选数量(): INT FROM "python:frlg_ocr_names"\n'
        'EXTERN FUNC OCR名称候选读取($下标: INT): STRING FROM "python:frlg_ocr_names"'), encoding='utf-8')
    backup.joinpath(name_library.name).write_bytes(name_library.read_bytes())
    replacement = '''FUNC 识别抓捕对象名称优先OCR($识图阈值: INT): STRING
    $OCR抓捕对象名称结果 = OCR识别抓捕对象名称()
    $OCR候选末尾 = OCR名称候选数量() - 1
    IF $OCR候选末尾 >= 0
        FOR $OCR候选序号 = 0 TO $OCR候选末尾
            $OCR抓捕对象名称结果 = OCR名称候选读取($OCR候选序号)
            $OCR抓捕对象图鉴编号 = 英文名称查图鉴编号($OCR抓捕对象名称结果)
            IF $OCR抓捕对象图鉴编号 > 0
                $OCR匹配确认 = OCR名称闪光匹配度确认($OCR抓捕对象图鉴编号, $识图阈值)
                PRINT "OCR候选验证:" & $OCR抓捕对象名称结果 & ",通过=" & $OCR匹配确认
                IF $OCR匹配确认 != 0
                    PRINT "OCR确认名称:" & $OCR抓捕对象名称结果
                    RETURN $OCR抓捕对象名称结果
                ENDIF
            ENDIF
        NEXT
    ENDIF
    PRINT OCR候选未通过图像验证，回到单字识别
    RETURN 识别抓捕对象名称($识图阈值)
ENDFUNC'''
    name_library.write_text(name_text.replace(original_name, replacement), encoding='utf-8')
    payload = {'migration_version': 1, 'names': names, 'files': {
        p.name: {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'backup': 'lib/ocr_backup/' + p.name}
        for p in (backup / library.name, backup / name_library.name)}}
    (root / SNAPSHOT).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'snapshot': SNAPSHOT, 'migration_version': 1, 'database_count': len(names), 'files': payload['files']}
