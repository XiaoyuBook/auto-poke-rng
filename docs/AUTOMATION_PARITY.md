# BDSP 自动流程迁移契约

基准：auto-bdsp-rng `494793ed467cd1a2ef376d5886d0add5924b620f`。以该版本**代码和测试**为准；旧设计文档只作背景。先冻结原版、建立测试，再实现接线。界面采用本项目 React/TypeScript，IPC/资源管理采用 Electron，算法与流程使用现有独立 Python 运行时，视频/伊机控仍由现有 C++ 服务持有。不引入 PySide、旧 Capture Broker 或第二套串口所有者。

## 边界与验收

自动定点、自动 TID、OCR 设置、delay 配置、轮次记录和详细日志在范围内。交互保留原版的任务参数/脚本分区、分别保存、启动前检查、入口选择、单次/有限/无限循环、开始/停止、候选表、运行状态及相关日志跳转。界面美化后续进行。

验证分三层：原版业务契约（虚拟设备与虚拟时钟）、本项目适配器（真实 JSONL/IPC 和模拟设备）、React/Electron 交互。仅业务契约通过不代表接线完成；模拟设备通过也不代表实机时序已验收。任何无法自动化的部分均在验收记录中明确列出，不用预览值代替实际识别结果。

## 自动定点完整路径

```text
起点：测种脚本 / 捕获 Seed / 使用当前 Seed 校正
  → 捕获 → 搜索并锁定最早可达候选 → 判断距离
  → [过帧 → 普通校正或完整重测 → 再判断]
  → [预留过场帧 → 过场脚本 → 过场校正 → 重新搜索]
  → 最终实时校准 / 软件等待 / 动态调整脚本闪帧 → 撞闪
  → 判闪 → 出闪录像并结束
          → 明确未闪且有后续候选：逃跑 → 校正 → 同轮续搜
          → 反查脚本 → 详情 OCR → 反查候选 → 保存 delay 样本
          → 本轮结束 → 按循环模式进入测种脚本或完成
```

| 编号 | 原版行为与边界 | 原版测试资产 |
| --- | --- | --- |
| S01 | 默认先执行测种脚本；捕获/校正入口只影响第一轮，后续从测种脚本开始 | `auto_rng_runner`: starts_by_running / start_first_cycle / start_from_reidentify |
| S02 | 搜索按多个筛选方案取并集，按 Adv 排序；先过滤已过/不可达帧，再按同步来源+PID+EC 去重 | runner: unreachable_linear / timeline_candidates / sync_candidate_source；search 层另测 |
| S03 | 线性模式可达性根据启动帧差能否整除 `npc+1` 判断；Timeline 不用该模数过滤 | runner: linear_trigger_reachability / keeps_timeline_candidates |
| S04 | 同步关闭/普通队首/同步队首；有体型筛选时才搜索另一张同步表，切换队首后更新来源及游走瞬移槽位 | runner: sync / teleport / secondary_no_sync |
| S05 | 无候选也消耗一轮；单次结束，有限模式严格计数，无限继续；同 Seed 连续三次零候选停止 | runner: no_candidate / repeated_seed |
| S06 | 连续捕获失败五次终止；成功清零失败计数；用户取消不得计作捕获失败或继续重试 | runner: capture_failures / fifth_failure / user_cancel |
| S07 | `raw - round_delay - script_wait` 得脚本启动帧，减当前 Adv 得剩余；不改变 Seed 或搜索原始 Adv | runner: target_1800 / target_1000 / uses_flash_frames |
| S08 | 默认最大等待窗口 300；窗口外将理论剩余写入 `_目标帧数`，不再减脚本自带的 300 等偏移 | runner: preserves_original_advance_request / runs_advance_script |
| S09 | 过帧量 **大于**校正上限才完整重测，等于上限仍校正；默认上限 900000 | runner: above_threshold / at_threshold |
| S10 | 普通校正默认 2 次，可配置；失败策略为下一轮或同轮补救测种（默认 1 次）；补救成功清除旧目标、旧候选并重搜，delay 仍冻结 | runner: configurable_ordinary / recaptures_seed_in_same_round / discards_previous_target |
| S11 | 一次补救序列耗尽才计一次全局捕获失败，连续五次终止；停止中断补救及降级路径 | runner: exhausted_seed_recovery / stop_during_seed_recovery |
| S12 | 有过场脚本时默认预留 500000 帧；进入预留区执行过场；过场后只校正，最多 2 次；失败、超校正上限或不可达则下一轮，禁止原地完整重测 | runner: reserves_threshold / exit_reseed / post_exit |
| S13 | 过场后过帧脚本的 `$地下过帧` 置零；逃跑后清理旧过帧/过场状态，但保持当前同步队首 | runner: zeroes_underground / escape_clears / escape_preserves |
| S14 | 未声明 `_闪帧` 时软件等到 `raw-delay`，脚本原文执行；声明时保留脚本内部等待，不能重复扣除 | runner: missing_flash / without_flash / bug_repro_raw11915 / raw3674 |
| S15 | 剩余大于脚本闪帧且在窗口内：等待完整剩余值；等于闪帧：最终校准；剩余 6..闪帧-1：动态改为剩余-1；≤5 放弃 | runner: remaining_equal / remaining_less / remaining_20 / remaining_6 / remaining_5 |
| S16 | 最终校准使用 1.018 秒线性活帧和整数推进；已错过不撞闪；最终等待直接进入撞闪，不再次采集眨眼 | runner: recomputes_hit_start / final_wait / does_not_reidentify_again |
| S17 | Timeline 使用 1.017 秒玩家事件和宝可梦随机眨眼事件；两段帧延迟及白屏延迟按原时序生效 | runner: timeline_counter / applies_delay_fields / timeline_mode |
| S18 | 出闪优先停止循环并录像；明确未闪且有后续候选时逃跑优先于反查，仍为同一轮 | runner: stops_after_shiny / record_script / escape_continue_takes_priority |
| S19 | 无后续候选时按原规则反查/结束；逃跑失败不继续校正；停止后不得逃跑、测种、重试 | runner: escape_error / falls_back_to_reverse / stop_during_escape |

### 时序例子（必须保持）

`raw=1800, delay=1400, _闪帧=60 → trigger=340`。当前 Adv=0 时过帧 340；当前 Adv=40 时剩余 300。过帧脚本已有内部预留时不重复扣减。`raw=11915,current=10309,delay=1442,_闪帧=70` 时剩余 94，软件应等 94，不能再扣 70 变为 24。

## 自动 TID

| 编号 | 原版行为与边界 | 测试 |
| --- | --- | --- |
| T01 | 测种脚本/捕获 Seed 两个入口；64 次小卡比兽眨眼；后续轮次恢复测种脚本 | auto_tid_rng: capture_start / retries / capture_fails |
| T02 | 搜索 0..frame_threshold，**含末端**；目标是 Display TID（0..999999），支持多个，选最早匹配 Adv | id_generator；auto_tid_rng: select_target_display_tid |
| T03 | `trigger=target Adv-delay`；未命中、delay 大于目标或已过启动帧进入下一轮/按循环结束 | auto_tid_rng: threshold / waits_until_display_tid |
| T04 | 每帧间隔由小卡比兽 RNG 的 `rangefloat(3,12)+0.285` 给出；不能按 60fps 或普通玩家 1.018s 换算 | auto_tid_rng: munchlax_counter / timing / estimate_target_at |
| T05 | 表格累计用时相对本轮测种起点，预计日期固定；生成时间预测不得改变 live RNG | auto_tid_rng: row_times / shares_fixed_row_times / without_mutating |
| T06 | 仅目标/全部切换、定位目标、复制选中；复制全部/导出全部始终导出全表原序，保留固定预计日期 | 新 React 交互契约 |
| T07 | 等待中刷新预计倒计时，重测、停止和取名后清除；等待期间不发送保活按键 | auto_tid_rng: wait_progress / wait_timing；适配器行为轨迹 |
| T08 | 取名后按原版正常路径完成；保留原有可选反查字段但不把未启用路径新增为默认行为 | 原 runner `_run_name_script` 与 UI `build_config` |
| T09 | 停止记录保留首次原因、轮次、阶段、Seed、目标、实际等待；进程/设备异常不能冒充用户停止 | auto_tid_rng: first_reason_and_state_snapshot；适配器断线测试 |

## OCR 设置、判闪与反查

现有“闪光反查区域”就是 OCR 设置页；不得新建重复设置页。十项：性格、个性、HP、攻击、防御、特攻、特防、速度、判闪对话、御三家战斗区域。配置保存和框选坐标以原始帧为基准，预览框不能污染识别画面。默认区域对应 1920×1080，预热、当前项测试、全部测试、导入默认区域均调用真实服务。

| 编号 | 契约 | 测试 |
| --- | --- | --- |
| O01 | 测试全部会自动翻页，覆盖前八项；两个计时区域单独测试；错误保留失败，不填演示文本 | OCR 适配器与 React 契约 |
| O02 | 普通目标严格按“出现了！”→“去吧/上吧”；简繁体和半/全角叹号兼容，顺序颠倒不得触发 | dialog_timing: keywords_in_order / before_first / traditional / exclamation |
| O03 | 御三家按“去吧/上吧”→战斗按钮；第二阶段切换 ROI | dialog_timing: starter_send_out / switches_callbacks |
| O04 | 游走先等脚本确认进入战斗，再开始计时；未确认/未知结果停止交给用户，不擅自逃跑 | 原 main_window `run_hit_script_with_shiny_check_service`；runner special_species |
| O05 | 首关键词在脚本运行中持续等，脚本结束后宽限 30s；第二关键词独立 30s；UI服务脚本硬超时 300s；采集/OCR耗时计入轮询周期 | dialog_timing: independent_window / hard_timeout / deducts_capture |
| O06 | 普通物种 OCR 关键词超时沿用原版“未闪继续”；御三家/游走未知则停止；采集、OCR执行错误和取消独立处理 | runner ordinary_species / special_species；dialog_timing error tests |
| O07 | 反查：反查脚本→训练家笔记性格/个性→RIGHT 翻到能力页读取六项数值→按能力值、性格及可用个性筛选附近状态；拉帝兄妹、雷公/炎帝/水君、三圣鸟、三神柱分别按组反查 | pokemon_info_ocr；新增反查适配器轨迹 |
| O08 | 个性 ROI 匹配失败后全图重试；仍无法匹配只跳过个性过滤并明确提示；性格和能力值失败不能造数值 | pokemon_info_ocr: characteristic / full_frame；适配器契约 |
| O09 | 判闪区域无效回退画面下半部；御三家区域按当前分辨率用默认位置；普通详情字段无有效区域则明确错误 | ocr_regions |
| O10 | OCR 模型沿用 PP-OCRv6/RapidOCR；文本/坐标适配保留原解析规则；不加载原 Paddle 模型 | 新 OCR provider 测试 |
| O11 | 判闪校准只监测手动遭遇，不发按键；御三家切换两个 ROI，每阶段窗口45秒；建议值为实测×1.2（3位小数），用户选择采用 | host calibration / integration O11 |

## Delay、配置、设备与停止

| 编号 | 契约 | 测试 |
| --- | --- | --- |
| D01 | 八策略：fixed/last/mode/median/mean/ema/trimmed_mean/dense_interval；无有效样本用基准值；非负 .5 向上取整 | delay_strategy 全套 |
| D02 | 一次反查是一个样本轮，去重排序非负候选；多候选忽略或每轮权重1，last 永远只读单候选；窗口按有效轮计数 | delay_strategy 全套 |
| D03 | 按物种持久保存配置、样本、稳定轮次号、时间；划除可恢复且保留记录，清空只作用当前物种 | delay_profiles；新持久化/React测试 |
| D04 | 每轮冻结物种和 delay；同轮重测、过场、逃跑不改变；样本/策略更新只影响下一轮；反查使用锁定目标的 used_delay | runner freezes_delay；适配器运行中改配置 |
| C01 | 任务参数和脚本分别保存，空脚本选择也保存；开始自动保存两部分；运行采用启动快照 | automation_save_scopes → 新组件/存储测试 |
| C02 | 开始前检查只检查，不连接设备、不发按键、不保存、不启动；脚本下拉重新扫描库 | start_readiness → 新适配器/组件测试 |
| C03 | 全部输入共享既有伊机控，采集共享既有视频；自动流程持有占用期间禁止另一流程/手动脚本/键盘插入 | 新资源占用测试 |
| C04 | 用户停止、关闭、worker EOF、设备断开和脚本错误释放动作/子进程；停止后任何迟到回调不得继续业务 | 新 JSONL/设备回归；runner stop tests |
| C05 | 捕获中每满10次且未结束可短按L保活；20/40/64次捕获以外、过帧和TID等待不保活；失败不打断捕获 | 新捕获适配器虚拟帧/控制器轨迹 |
| C06 | 后续轮次测种前全图 OCR 检测缩放/锁定，两次确认后双HOME，再两次确认已退出；未检测到不按键，停止立即打断 | zoom_recovery 全套 |

## 日志中心迁移

| 编号 | 契约 | 测试 |
| --- | --- | --- |
| L01 | 默认轮次记录：运行/轮次列表→该轮 Seed、锁定 Adv、delay、候选快照、结果、警告；区分无候选/未闪/未知/停止/失败 | 存储与 React 测试 |
| L02 | 候选保留 Adv、异色、性格、个性、六项IV、特性、性别、EC/PID、体型和同步来源；反查保留实际 delay | 事件映射/轮次序列化测试 |
| L03 | 查看相关日志切换详细日志并筛选该 runId/round；新运行不得沿用旧轮次过滤 | React 交互测试 |
| L04 | 详细日志按来源、级别、关键词筛选，跟随开关、复制/导出；来源包含自动定点、自动TID、眨眼、OCR、脚本、手柄、系统 | React 与 Electron 测试 |
| L05 | 内存最多10000条；按本地自然日追加磁盘日志，仅保留最近七个自然日；关闭自动保存只停写磁盘 | 临时目录+可注入时钟测试 |
| L06 | 清空显示仅清内存，不删除磁盘；日志浮窗/收回保持同步；磁盘失败明确呈现，不中断安全停止 | 存储/Electron 测试 |

## 测试执行与迁移进度

`npm run test:automation:reference` 运行固定原版作为基线；`npm run test:automation` 必须运行本项目实现，未迁移时应报缺少模块，不能偷偷回退原版。原版快照包含源码、原始测试、脚本与 SHA-256 清单，普通测试不依赖旁边仓库。实际迁移适配器测试另以 Node/Vitest/Electron 执行。

首次准备测试依赖：`.deps/script-python/Scripts/python.exe -m pip install -r tools/automation-test-requirements.txt`。

2026-09-25 基线：`npm run test:automation:reference` **407 passed**（虚拟时钟，不连接硬件）；`npm run test:automation` 已确认在新运行时缺失时失败，未回退参考源码。十份测试覆盖定点/TID状态机、脚本参数、八种delay策略、物种样本、OCR区域/解析/判闪、缩放恢复以及PokeFinder ID参考数据。

2026-09-25 迁移节点：原版业务包已迁入现有 Python 运行时；Electron 负责 IPC、启动快照、设备占用、取消与日志；React 已接入自动定点、自动 TID、OCR 设置、delay 策略和日志中心。运行测试仍校验冻结参考文件哈希，测试不会自动回退原版。

已补充 `tests/automation-services.cjs`、`automation-worker.cjs`、`automation-integration.cjs`、`automation-script-cancellation.cjs`，共22项，覆盖 JSONL、预检、快照、delay 持久化、日志保留、设备断线、全局停止、迟到脚本拒绝、全部 OCR 顺序、传说组反查、判闪校准及所有附带脚本的实际编译。`runtime/tests/test_automation_*.py` 共13项，覆盖 PP-OCR 输出适配、真实原版状态机接线、搜索窗口、过场 noisy 模式、预热期双眨眼、捕获保活、反查重试、TID 停止诊断与校准。发现的基准值退回100、过场模式错误、预热双眨眼、迟到脚本、旧 TID 表格及轮次状态问题，均已补充回归再修复。

`tests/automation-ui.test.jsx` 的7项交互契约覆盖独立保存、只读检查、轮次关联和新运行解除筛选、OCR 失败/全部测试、TID 全表复制及重测清理；`tests/automation-electron.cjs` 使用真实 Electron、模拟视频和手柄、真实 ID worker 验证页面草稿、IPC、占用和释放、日志弹出/收回同步及截图。Electron 中的长时间自动流程事件使用模拟 worker，不能据此声称实际游戏捕获已通过。

适配边界：TID 完整结果经 JSONL/IPC 保存在内存，当前范围上限250000，超限明确拒绝；原版界面允许输入十亿，迁移版不尝试分配十亿行或静默截断。设置、delay样本与每日详细日志持久化；轮次候选保留当前会话并支持导出 JSON。QQ通知仍属于独立功能，未自动发送。OCR设置支持显式保存，识别前会保存当前区域；默认坐标仍对应1920×1080，其他分辨率需重新框选。

实机验收待执行：分别用御三家、普通定点和游走画面确认眼睛模板/丢帧、两阶段判闪、脚本进入战斗信号、详情页翻页和反查；确认现场输入延迟与本机 delay。测试不能替代这些依赖游戏画面的检查。界面布局和交互已按当前技术栈接入，视觉样式可继续独立优化。

本次验证：`test:automation` 407通过；`test:automation:adapters` 22项Node与13项Python通过；`npm test -- --maxWorkers=1` 120通过；既有设备回归7通过；构建与自动流程Electron测试通过。全量Vitest并行运行曾触发旧用例的5秒超时，单worker复验保留了原断言与超时配置。截图位于 `node_modules/.tmp/automation-review/`；开发机验证未操作真实游戏设备。
