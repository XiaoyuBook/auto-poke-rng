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
            # These are positive detector outcomes, independent of the optional
            # pre-calibration marker. Setup/threshold logs never count as a shiny.
            if line in ("已识别到闪光个体", "已识别到出闪，脚本停止", "时差检测到出闪",
                        "狩猎区闪光已确认，继续投球；仅在抓获成功后停止"):
                patch.update(result="发现闪光", shiny=True)
            if line == "已在孵化蛋能力页识别到闪光，目标命中并结束反查":
                patch.update(result="目标出闪", shiny=True)
            non_target = re.fullmatch(r"遇到非目标闪光：图鉴\s*(\d+)，目标\s*(\d+)；按配置停止脚本", line)
            if non_target and 1 <= int(non_target[1]) <= 386 and 1 <= int(non_target[2]) <= 386 and int(non_target[1]) != int(non_target[2]):
                patch.update(result="非目标出闪", shiny=True, observedDex=int(non_target[1]))
            if line.startswith("PRECALIBRATION_UPDATE|") and "|EVIDENCE=TARGET_SHINY|" in line:
                fields = dict(part.split("=", 1) for part in line.split("|")[1:] if "=" in part)
                try:
                    target, observed = int(fields["TARGET_DEX"]), int(fields["OBSERVED_DEX"])
                    if 1 <= target <= 386 and target == observed:
                        patch.update(result="目标出闪", shiny=True, observedDex=observed,
                                     executionCorrection={"seedIndex": int(fields["SEED_INDEX"]),
                                                          "frame": int(fields["FRAME_PRE"])},
                                     note="已识别目标闪光；保存当前执行修正，未反查实际 Seed / 帧")
                except (KeyError, ValueError):
                    pass
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
