"""主脚本反查计算的 Python 实现（普通、野生、御三家及孵蛋 Seed 复核）。

对应 main.ecs 的执行反查扫描/临时RNG前进一次/按算法生成个体/
检查是否匹配/重置本轮候选状态/处理匹配候选/记录当前候选为最佳候选。
生成器保留 python_backup/main.ecs 和逐函数指纹供对照。

ECS 只在入口/返回时同步状态；扫描内部所有循环、匹配和投票均为 Python。
state 的中文键故意与原全局变量同名。每次调用重新接收当前流程状态，
因此扩窗、喂糖更新 IV、跨轮累计修正不会读取生成时的过期快照。
投票使用宿主同一个 CalibrationVoteSession，不能另建一套校准历史。
"""
from __future__ import annotations

from .frlg_compute_runtime import (
    _i32, _div, _mod, candidate_mse, normalize_mod_period, signed_round_division,
    static_gender,
)
from .seed_table_runtime import hex_to_decimal


FUNCTIONS = {
    '执行反查扫描': 'scan',
    '临时RNG前进一次': 'step',
    '按算法生成个体': 'generate',
    '检查是否匹配': 'match',
    '重置本轮候选状态': 'reset',
    '处理匹配候选': 'collect',
    '记录当前候选为最佳候选': 'record_best',
}
STATS = ('HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE')


def advance(seed: int, count: int) -> int:
    """与逐次 RNG前进 相同的 LCG 复合；预消耗改为 O(log N)，无 ECS 循环。"""
    multiplier, increment = 0x41C64E6D, 0x6073
    while count > 0:
        if count & 1:
            seed = (seed * multiplier + increment) & 0xFFFFFFFF
        increment = (increment * (multiplier + 1)) & 0xFFFFFFFF
        multiplier = (multiplier * multiplier) & 0xFFFFFFFF
        count >>= 1
    return seed


class MainReverseSession:
    def __init__(self, *, seed_runtime, vote_session, emit=lambda message: None,
                 checkpoint=lambda: None):
        self.seed_runtime = seed_runtime
        self.vote = vote_session.extern_functions()
        self.emit = emit
        self.checkpoint = checkpoint
        self.state = {}

    def put(self, name, value):
        self.state[name] = value
        return 0

    def get(self, name):
        # 不用默认值掩盖生成器遗漏的输入或写回字段。
        return self.state[name]

    def execute(self, name):
        self.checkpoint()
        result = getattr(self, FUNCTIONS[name])()
        self.checkpoint()
        return result if result is not None else 0

    def extern_functions(self):
        return {
            'Python反查写整数': self.put,
            'Python反查写文本': self.put,
            'Python反查写数组': self.put,
            'Python反查读整数': self.get,
            'Python反查读文本': self.get,
            'Python反查执行入口': self.execute,
            'IV是否在范围': lambda value, low, high: int(low <= value <= high),
        }

    def scan(self):
        """原 执行反查扫描：保持 Seed/ADV/101→102→104 的顺序与并列首选。"""
        s = self.state
        self.reset()
        s['找到候选Seed'] = 0
        s['扫描起始索引'] = max(0, _i32(s['目标索引'] - s['有效Seed容差']))
        s['扫描结束索引'] = min(s['Seed最大索引'], _i32(s['目标索引'] + s['有效Seed容差']))
        s['种子索引'] = s['扫描起始索引']  # ECS FOR 空区间也赋初始值。
        for index in range(s['扫描起始索引'], s['扫描结束索引'] + 1):
            self.checkpoint()
            s['种子索引'] = index
            s['差索引'] = _i32(index - s['目标索引'])
            s['差索引绝对值'] = _i32(abs(s['差索引']))
            if s['差索引绝对值'] > s['有效Seed容差']:
                continue
            s['当前MS'] = _i32(self.seed_runtime.get_ms(s['游戏版本'], index) + s['NXSeed平台偏移MS'])
            s['当前Seed'] = self.seed_runtime.get_seed_hex(s['游戏版本'], index, s['Seed模式'])
            if not s['当前Seed']:
                continue
            seed = s['候选Seed十进制'] = hex_to_decimal(s['当前Seed'])
            if seed < 0:
                continue
            s['找到候选Seed'] = 1
            low, high = s['有效最小消耗帧'], s['有效最大消耗帧']
            if low > 0:
                seed = advance(seed, low)
                s['预消耗帧'] = low
                s['新HI'], s['新LO'] = seed >> 16, seed & 65535
            s['候HI'], s['候LO'] = seed >> 16, seed & 65535
            s['当前消耗帧'] = low
            methods = (101, 102, 104) if s['反查算法'] == 199 else (s['反查算法'],)
            for frame in range(low, high + 1):
                if (frame - low) % 128 == 0:
                    self.checkpoint()
                s['当前消耗帧'] = frame
                for method in methods:
                    s['当前反查算法'] = method
                    self.generate()
                    self.match()
                    self.collect()
                seed = (seed * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
                s['新HI'], s['新LO'] = seed >> 16, seed & 65535
                s['候HI'], s['候LO'] = s['新HI'], s['新LO']
        if s['找到候选Seed'] == 0:
            self.emit('')
            self.emit('Seed容差内没有找到候选')
            return 0
        if s['本轮候选命中计数'] == 0:
            self.emit('')
            self.emit('本轮没有找到匹配个体')
            return 0
        if s['调试日志输出'] == 1:
            self.emit('')
            self.emit('候选命中数量:' + str(s['本轮候选命中计数']))
        return 1

    def step(self):
        """原 临时RNG前进一次；仅供外部单独调用，扫描内直接执行整数 LCG。"""
        s = self.state
        seed = (((s['临HI'] << 16) | s['临LO']) * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
        s['新HI'] = s['临HI'] = s['临RAND'] = seed >> 16
        s['新LO'] = s['临LO'] = seed & 65535

    def generate(self):
        """原 按算法生成个体：Static 1/2/4、Wild 1/2/4 和游走 IV Bug。"""
        s = self.state
        seed = (s['候HI'] << 16) | s['候LO']
        method = s['当前反查算法']
        s['临HI'], s['临LO'] = s['候HI'], s['候LO']
        s['野生遇敌值'] = s['野生等级值'] = s['野生PID尝试'] = 0
        s['野生锁定性格'], s['野生PID找到'] = -1, 1
        if method not in (1, 2, 4, 101, 102, 104):
            self.emit('')
            self.emit('未支持的反查算法:' + str(method))
            s['野生PID找到'] = 0
            return  # 保留原不支持分支的提前返回（不擅自清空旧个体）。

        def rand():
            nonlocal seed
            seed = (seed * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
            return seed >> 16

        if method >= 101:
            s['野生遇敌值'] = rand()
            s['野生等级值'] = rand()
            nature = s['野生锁定性格'] = rand() % 25
            s['野生PID找到'] = 0
            s['野生PID尝试'] = 1
            for attempt in range(1, s['野生PID尝试上限'] + 1):
                if attempt % 64 == 0:
                    self.checkpoint()
                s['野生PID尝试'] = attempt
                pidlo, pidhi = rand(), rand()
                s['个体性格'] = ((pidhi << 16) | pidlo) % 25
                if s['个体性格'] == nature:
                    s['野生PID找到'] = 1
                    break
        else:
            pidlo, pidhi = rand(), rand()
            s['个体性格'] = ((pidhi << 16) | pidlo) % 25

        if s['野生PID找到']:
            if method in (2, 102):
                s['跳过RAND'] = rand()
            iv1 = rand()
            if method in (4, 104):
                s['跳过RAND'] = rand()
            iv2 = rand()
        else:
            pidlo = pidhi = iv1 = iv2 = 0
        s['PIDLO'], s['PIDHI'], s['IV1'], s['IV2'] = pidlo, pidhi, iv1, iv2
        s['临HI'] = s['新HI'] = s['临RAND'] = seed >> 16
        s['临LO'] = s['新LO'] = seed & 65535
        if not s['野生PID找到']:
            s['个体性格'] = s['个体性别'] = -1
            for stat in STATS:
                s['个体' + stat + 'IV'] = 0
            return
        s['个体性别'] = static_gender(pidlo, s['性别阈值'])
        if s['目标全国图鉴编号'] in (243, 244, 245):
            iv1, iv2 = iv1 % 256, 0
            s['IV1'], s['IV2'] = iv1, iv2
        values = (iv1 & 31, (iv1 >> 5) & 31, (iv1 >> 10) & 31,
                  (iv2 >> 5) & 31, (iv2 >> 10) & 31, iv2 & 31)
        for stat, value in zip(STATS, values):
            s['个体' + stat + 'IV'] = value

    def match(self):
        """原 检查是否匹配：槽位物种/初始等级→性格/性别→六项 IV。"""
        s = self.state
        s['匹配'] = 1
        if s['当前反查算法'] >= 101 and s['野生槽验证启用'] == 1:
            percent = s['野生遇敌百分值'] = s['野生遇敌值'] % 100
            slot = s['野生遇敌槽'] = s['当前野生百分槽表'][percent]
            if slot < 0:
                s['匹配'] = 0
            else:
                packed = s['野生候选打包值'] = s['当前野生槽打包表'][slot]
                s['野生候选图鉴编号'] = _mod(packed, 512)
                if s['野生候选图鉴编号'] != s['目标全国图鉴编号']:
                    s['匹配'] = 0
                low = s['野生候选最低等级'] = _mod(_div(packed, 512), 128)
                high = s['野生候选最高等级'] = _mod(_div(packed, 65536), 128)
                if low > 0:
                    s['野生候选等级范围'] = high - low + 1
                    s['野生候选等级'] = low + _mod(s['野生等级值'], s['野生候选等级范围'])
                    if s['野生候选等级'] != s['野生遭遇初始等级']:
                        s['匹配'] = 0
        if s['个体性格'] != s['识图性格']:
            s['匹配'] = 0
        if s['识图性别'] != -1 and s['个体性别'] != s['识图性别']:
            s['匹配'] = 0
        for stat in STATS:
            s['IV在范围'] = int(s[stat + '最小'] <= s['个体' + stat + 'IV'] <= s[stat + '最大'])
            if not s['IV在范围']:
                s['匹配'] = 0

    def reset(self):
        """原 重置本轮候选状态；投票历史不随每次扫描重置。"""
        s = self.state
        if s['跨组筛选收集启用'] == 1:
            self.vote['共同区开始扫描']()
        for name in (
            '本轮候选命中计数 找到个体 候选同一消耗帧有效 候选全部同一消耗帧 '
            '候选同一Seed有效 候选同一Seed值 候选全部同一Seed 最佳候选有效 最佳候选离群 '
            '当前候选距离 当前候选Seed距离 当前候选TV帧距离 当前候选剩余帧离群 '
            '当前候选Seed离群 当前候选TV帧离群 最佳候选剩余帧离群 最佳候选Seed离群 '
            '最佳候选TV帧离群 命中反查算法 命中差索引 命中个体性格 命中个体性别 '
            '命中HPIV 命中ATKIV 命中DEFIV 命中SPAIV 命中SPDIV 命中SPEIV '
            '命中野生锁定性格 命中野生PID尝试'
        ).split():
            s[name] = 0
        for name in ('候选同一消耗帧', '命中SeedMS', '命中消耗帧', '命中Seed索引'):
            s[name] = -1
        for name in ('最佳候选距离', '最佳候选Seed距离', '最佳候选TV帧距离', '最佳候选剩余帧距离'):
            s[name] = 30000
        s['允许更新SeedMS本轮'] = s['允许更新消耗帧本轮'] = 1
        s['命中Seed'] = ''

    def collect(self):
        """原 处理匹配候选：同帧/同 Seed、共同区、投票、离群优先和 MSE。"""
        s, v = self.state, self.vote
        if s['匹配'] != 1:
            return
        s['找到个体'] = 1
        s['本轮候选命中计数'] = _i32(s['本轮候选命中计数'] + 1)
        for axis, value, field in (('消耗帧', s['当前消耗帧'], '候选同一消耗帧'),
                                   ('Seed', s['差索引'], '候选同一Seed值')):
            if s['候选同一' + axis + '有效'] == 0:
                s[field] = value
                s['候选同一' + axis + '有效'] = s['候选全部同一' + axis] = 1
            elif value != s[field]:
                s['候选全部同一' + axis] = 0
        raw = s['当前候选帧原始'] = _i32(s['当前消耗帧'] - s['目标消耗帧'])
        fc, sc, tv, period = (s['消耗帧实际执行修正量'], s['Seed累计修正索引'], s['进入TV'], s['TV单次消耗帧'])
        if s['跨组筛选收集启用'] == 1:
            s['投票忽略'] = v['共同区收集'](s['游戏版本'], s['种子索引'], sc, s['当前消耗帧'], fc, s['NXSeed平台偏移MS'])
        s['投票忽略'] = v['投票投候选'](s['差索引'], raw, sc, fc, s['候选全部同一Seed'], tv, period)
        absolute = s['当前候选绝对帧'] = _i32(raw + fc)
        if tv == 1:
            phase = s['当前候选剩余帧落点'] = absolute % period
            centre = s['当前候选剩余帧中心'] = v['投票取剩余帧中心']()
            s['当前候选距离'] = _i32(abs(normalize_mod_period(_i32(phase - centre), period)))
            ring = s['当前候选TV帧落点'] = signed_round_division(absolute, period)
            s['当前候选TV帧距离'] = _i32(abs(_i32(ring - v['投票取TV帧中心']())))
        else:
            s['当前候选距离'] = _i32(abs(_i32(absolute - v['投票取剩余帧中心']())))
            s['当前候选TV帧距离'] = 0
        s['当前候选Seed距离'] = _i32(abs(_i32(s['差索引'] + sc - s['Seed路径中心'])))
        sw, fw = s['候选权重Seed'], s['候选权重帧']
        mse = candidate_mse(s['当前候选Seed距离'], s['当前候选距离'], sw, fw)
        if tv == 1:
            mse = _i32(mse + s['当前候选TV帧距离'] ** 2 * fw)
        if s['御三家严格筛选'] == 1:
            mse = _i32(mse + v['共同区候选加权距离'](_i32(s['种子索引'] + sc), _i32(s['当前消耗帧'] + fc), sw, fw))
        s['当前候选MSE'] = mse
        s['当前候选剩余帧离群'] = v['投票候选是否离群'](raw, fc, tv)
        s['当前候选Seed离群'] = v['投票Seed候选是否离群'](s['差索引'], sc)
        s['当前候选TV帧离群'] = v['投票TV帧候选是否离群'](raw, fc, tv)
        outlier = s['当前候选剩余帧离群']
        if s['当前候选Seed离群'] == 1 or s['当前候选TV帧离群'] == 1:
            outlier = 1
        s['当前候选离群'] = outlier
        if (s['最佳候选有效'] == 0 or (s['最佳候选离群'] == 1 and outlier == 0)
                or (s['最佳候选离群'] == outlier and mse < s['最佳候选MSE'])):
            self.record_best()
            s['最佳候选离群'] = outlier

    def record_best(self):
        """原 记录当前候选为最佳候选：同步所有后续校准/日志消费的结果。"""
        s = self.state
        s['最佳候选有效'] = 1
        for suffix in ('距离', 'Seed距离', 'TV帧距离', '剩余帧离群', 'Seed离群', 'TV帧离群', 'MSE'):
            s['最佳候选' + suffix] = s['当前候选' + suffix]
        s['最佳候选剩余帧距离'] = s['当前候选距离']
        for target, source in (
            ('SeedMS', '当前MS'), ('消耗帧', '当前消耗帧'), ('Seed索引', '种子索引'),
            ('Seed', '当前Seed'), ('反查算法', '当前反查算法'), ('差索引', '差索引'),
            ('个体性格', '个体性格'), ('个体性别', '个体性别'),
            ('野生锁定性格', '野生锁定性格'), ('野生PID尝试', '野生PID尝试'),
        ):
            s['命中' + target] = s[source]
        for stat in STATS:
            s['命中' + stat + 'IV'] = s['个体' + stat + 'IV']
