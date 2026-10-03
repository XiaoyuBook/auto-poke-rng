# 流程诊断日志与 OCR 名称纠错

2026-10-03：界面继续精简，文件保留完整输出和关键时间点。

## 保留单位

一次点击开始，到完成、失败或停止，计为 **一次流程**。准备和全部轮次写入同一个文件，轮数不消耗名额；预检失败也算一次。

位置为用户数据目录 `logs/runs/run_<开始顺序>_<runId>.jsonl`，Windows 默认为 `C:/Users/xiaoyu/AppData/Roaming/auto-poke-rng/logs/runs/`。每行一个 JSON 事件，保留最近 **30 次流程**。按开始顺序清理，仅删除本应用的归档文件；进行中的不删除，极端并行时暂时超额，结束后回到 30 次。

清空界面不清文件。沿用“自动保存磁盘日志”开关：关闭时停止收集新事件，结束仍写边界并刷新已收集数据。应在开始前开启保存。旧按日文件作为界面摘要保留 7 天；此前被过滤的原文无法补回。

## 诊断内容

| 事件 | 用途 |
| --- | --- |
| `run.started`、`frlg.plan` | 搜索请求、配置、执行选项、生成计划和预校准 |
| `script.preflight`、`ocr.model` | 执行脚本、Python 校准/反查实现和实际 OCR 权重的 SHA-256，比较算法版本 |
| `video.frame`、`videoFrame` | 实际分辨率、帧序号和视频 QPC，核对 OCR/搜图读到的帧 |
| `run.history`、`frlg.round` | 全部轮次、请求和反查落点、结果及跳过原因 |
| `script.diagnostic / ecs.output` | 界面过滤前原文：OCR、反查候选、Seed/帧可信度、冻结、投票、校准理由和下轮调整 |
| `script.bingo` | 完整分布、当前点和预测 |
| `ocr.inference.begin/end` | 区域、原文、置信度和模型推理耗时 |
| `ocr.name-correction` | 纠错结果、数据库规模、实际计算的名称及分数、备选、耗时 |
| `phase.begin/end` | 名称全阶段和图像判闪全阶段耗时，包含单字回退 |
| `script.image-result` | 标签、分数和位置，检查名称验证和普通/闪光对比 |
| `execution.wait`、`controller.request/reply` | 长等待、控制层按钮/摇杆序列及返回时间，定位 R、遭遇触发和继续我方入场的 A |
| 音频实验输出 | 窗口开始/截止 QPC、秒数、匹配结果及缺数据原因 |
| `run.finished` | 最终状态、结束时间和错误原因 |

保留宿主时间 `hostTimestamp`、接收时间 `timestamp` 和字符串 `monotonicNs`，避免 JavaScript 整数精度丢失。音频 `start_qpc_ns/end_qpc_ns` 与脚本时钟可对齐。控制返回不代表游戏画面已响应；音频日志输出时间不等于音效发生时间。

不转储每条 ECS 算术语句，不复制 PCM/视频。相同标签的整数分数和位置不变时，每秒留一次，变化立即留。完整记录不进入 React 日志列表。追加按 100ms 或 64KiB 刷盘，正常结束和关闭刷新；异常断电可能损失最后一小批事件。

## 名称纠错

保留 PP-OCRv6 small 和现有名称数据库。精确命中直接返回；识错时先用长度和相邻字母索引选择初始候选，再用长度/字母数量差建立编辑距离下界，只有可能获胜或成为近似备选的名称才计算完整编辑距离及原评分。

不要求首字母正确，不硬性锁定长度，支持错字、缺字和多字。下界只排除数学上不可能进入范围的名称；差错较大时允许扩大范围。保持原评分及同分时的词表顺序；空白/异常长原文回到单字识别。

按得分保留最多 8 个、与最佳分相差不超过 1000 的候选，逐个用已有普通/闪光图像验证；通过原阈值才继续，全部失败时回到原单字识别。最终图像判闪、抓捕、校准算法、遭遇等待时长不变。

视频截图复测 `HAGNEHITE → MAGNEMITE`：383 个名称中完整计算 12 个，纠错约 3ms。它是本机离线纠错时间，不是端到端实机时间或准确率。

## 上游同步与测试

生成器接入补丁为 `tools/frlg-runtime-patches/ocr-name-candidates.patch`，实现为 `runtime/python/frlg_planner/automation/frlg_ocr_names.py`。生成时从安装脚本词表提取 `python_ocr_names.json`，把 lib19/lib20 原文保存在 `lib/ocr_backup/` 并登记指纹。

评分、别名/候选规则和 lib20 验证流程有指纹检查。上游改规则时拒绝迁移，需对照备份更新 Python 实现与测试；词表增减自动提取。不要仅修改 `.frlg-runs/`，下一次生成不会复用它。

验证：`node --test tests/automation-run-logs.cjs tests/automation-services.cjs tests/frlg-execution.cjs`、`tests/frlg-log-policy.py`、`tests/frlg-ocr-names.py`（`FRLG_SCRIPT_CORPUS` 指向原脚本包）。覆盖 30 次保留、多轮、重启、真实 Python 到文件通道、原 ECS 评分、错字/缺字/首字母错误、候选验证与回退、上游变化拒绝及计时。

全量 `vendor-frlg-runtime --check` 在本次修改前已有三处差异：`egg_settings_retry.ecs`、`shortcut_registration_egg.ecs`、`shortcut_registration_main.ecs`。本次没有改动它们或用新指纹覆盖差异；新增生成器接入及同步补丁指纹已登记。以上针对性测试通过不等于上游全量指纹检查通过。
