"""Extract GUI round records from generated FRLG PRINTs before log filtering.

The script remains the authority for round numbers and observations. Unknown
values stay absent; these records never participate in calibration decisions.
"""
import re


class RoundRecorder:
    def __init__(self, publish):
        self.publish = publish
        self.number = 0

    def consume(self, message):
        for raw in str(message).splitlines():
            line = raw.strip()
            start = re.fullmatch(r"(?:孵蛋同Seed实战)?第\s*(\d+)\s*轮(?:开始)?", line)
            if start:
                self.number = int(start[1])
                self.publish({"number": self.number, "start": True})
                continue
            patch = {}
            request = re.search(r"^(本轮请求|下轮请求):\s*Seed\s*(-?\d+)\s*ms[，,]\s*F1\s*(-?\d+)[，,]\s*TV\s*(-?\d+)[，,]\s*F2\s*(-?\d+)[，,]\s*菜单\s*(-?\d+)", line)
            if request:
                patch["request" if request[1] == "本轮请求" else "nextRequest"] = dict(zip(("seedMs", "f1", "tv", "f2", "menu"), map(int, request.groups()[1:])))
            egg = re.search(r"^(本轮请求):\s*Seed\s*(-?\d+)\s*ms，Held\s*(-?\d+)，Pickup\s*(-?\d+)", line)
            if egg:
                patch["request"] = {"seedMs": int(egg[2]), "held": int(egg[3]), "pickup": int(egg[4])}
            result = re.search(r"^本轮结果:\s*Seed\s*([\da-fA-F]+)（偏差\s*(-?\d+)），消耗帧\s*(-?\d+)（偏差\s*(-?\d+)）", line)
            if result:
                patch.update(hitSeed=result[1], seedOffset=int(result[2]), hitFrame=int(result[3]), frameError=int(result[4]), result="已反查")
            for pattern, field, numeric in (
                (r"^命中Seed:\s*([\da-fA-F]+)$", "hitSeed", False),
                (r"^与目标Seed差:\s*(-?\d+)", "seedOffset", True),
                (r"^命中消耗帧:\s*(-?\d+)", "hitFrame", True),
                (r"^(?:真实消耗帧误差|误差):\s*(-?\d+)\s*帧", "frameError", True),
                (r"^(?:SeedMS误差|误差):\s*(-?\d+)\s*ms", "seedMsError", True),
                (r"^(?:候选数|候选命中数量):\s*(\d+)", "candidateCount", True),
                (r"^(?:下轮Seed请求|下轮Seed等待):\s*(-?\d+)", "nextSeedMs", True),
                (r"^F1等待帧:\s*(-?\d+)", "f1", True),
                (r"^TV等待帧:\s*(-?\d+)", "tv", True),
                (r"^F2等待帧:\s*(-?\d+)", "f2", True),
            ):
                match = re.search(pattern, line)
                if match:
                    patch[field] = int(match[1]) if numeric else match[1]
                    if field == 'hitSeed':
                        patch['result'] = '已反查'
            if line.startswith(("原因:", "Seed结果:", "蛋帧结果:", "无蛋结果:", "下轮帧修正:", "观测差:", "修正模式:")):
                patch["note"] = line
            if line == "本轮没有找到匹配个体" or line == "Seed容差内没有找到候选":
                patch["result"] = "无匹配个体"
            if line.startswith("本轮停止反查"):
                patch["result"] = "反查中止"
            if line.startswith(("本轮离群跳过", "本轮结果波动较大，参数保持不变")):
                # These calibration branches return before the usual round
                # summary. Record their real outcome without inventing a hit.
                patch.update(result="校准跳过", note=line)
            if line.startswith(("目标获取未完成", "孵蛋Seed预校准反查失败", "本轮时间轴截止已错过")):
                patch.update(result="继续重试", note=line)
            if patch:
                self.publish({"number": self.number, "data": patch})
