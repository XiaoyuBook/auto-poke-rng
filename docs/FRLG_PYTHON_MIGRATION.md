# 火叶 ECS 纯计算迁移记录

## 第一阶段：Seed 表查表链路

生成火叶运行项目时，`runtime/python/frlg_planner/automation/easycon118.py` 会在复制脚本包、应用 Seed 表下载覆盖和临时日版模式覆盖之后，读取以下四个原始文件：

- `lib/00_Seed表_入口.ecs`
- `lib/01_Seed表_HEX转换.ecs`
- `lib/02_Seed表_火红_NX.ecs`
- `lib/03_Seed表_叶绿_NX.ecs`

它把表数据写入运行目录的 `seed_tables.json`，并把原文件保存到 `lib/seed_backup/`。顶层 ECS 文件保留同名 `EXTERN` 函数声明和迁移注释；`runtime/python/script_host.py` 将这些声明绑定到 `runtime/python/frlg_planner/automation/seed_table_runtime.py`。

对应关系如下：

| 原 ECS 函数 | Python 函数 | 原行为保留项 |
| --- | --- | --- |
| `取Seed最大索引(游戏版本)` | `SeedTableRuntime.get_max_index` | 火红=1、叶绿=2；未知版本返回 `-1` |
| `取MS(游戏版本, idx)` | `SeedTableRuntime.get_ms` | 越界返回 `-1` |
| `取RawTime(游戏版本, idx)` | `SeedTableRuntime.get_raw_time` | 越界返回 `-1` |
| `取SeedHEX(游戏版本, idx, mode)` | `SeedTableRuntime.get_seed_hex` | 越界或未知模式返回空字符串 |
| `HEX转十进制(text)` | `hex_to_decimal` | 支持 `0x`、大小写十六进制；非法值或超过 `0xFFFF` 返回 `-1` |

运行时仍保留识图、OCR、按键、等待、菜单和流程状态机在 ECS 中。Seed 表迁移只替换纯查表和 HEX 转换，不改变 Seed 表来源：下载更新或日版覆盖先写入 ECS，再由生成器读取同一份数据生成快照。

`tests/frlg-seed-table-runtime.py` 使用未迁移的 ECS 工程和迁移后的工程执行相同 probe，覆盖两版本、首尾索引、多个模式、无效索引和 HEX 转换，要求逐行结果一致。

## 第二阶段：纯计算函数

同一阶段还迁移了生成数据查表库：

- `lib/04_数据_宝可梦名称.ecs`：目标名称、中文/英文名称和名称反查。
- `lib/05_数据_宝可梦种族值.ecs`：六项种族值（包含火红/叶绿代欧奇希斯形态）。
- `lib/06_数据_宝可梦性别阈值.ecs`：性别阈值查表。

这三份 ECS 数据会生成 `python_data.json`，由
`runtime/python/frlg_planner/automation/frlg_data_runtime.py` 提供同名函数；
快照在生成前从当前脚本包解析，因此脚本库更新后不会悄悄使用旧的内置表。

生成运行目录时，以下四个只包含整数运算的库也会被替换为 Python
`EXTERN` 声明：

- `lib/11_计算_RNG基础.ecs`：Gen3 LCRNG 前进、PID/IV 拆分、性格、性别和未知图腾形态。
- `lib/12_计算_IV范围.ecs`：性格倍率、能力值计算和六项 IV 的最小/最大反查。
- `lib/13_计算_自动校准.ecs`：带符号四舍五入、周期归一、EWA 中心、候选 MSE 和修正量累加。
- `lib/14_计算_等待参数.ecs`：帧到毫秒换算、TV/F2 预算和奇偶修正。

原始文件会保存到 `lib/python_backup/`，生成目录根部的
`python_compute.json` 记录每个文件的 SHA-256、大小和公开函数。运行时由
`runtime/python/frlg_planner/automation/frlg_compute_runtime.py` 按原函数名绑定，
因此在脚本源码里仍可直接看到原来的入口（例如 `RNG下一HI`、`计算HP_IV最大`）。
Python 还复刻了 EasyCon 对负数的“向零截断”除法和取余规则，避免语言差异改变边界结果。

识图、OCR、按键、等待动作以及流程状态机仍保留在 ECS；这些部分依赖设备或画面，
不属于本阶段迁移范围。`tests/frlg-compute-migration.py` 会把同一组调用分别交给
未迁移 ECS 和 Python 迁移工程，要求每一行输出完全一致。

## 第三阶段：输入目录、显示文本和野生遇敌表

本阶段继续迁移没有设备依赖的查表逻辑：

- `lib/07_数据_目标组合.ecs`、`08_输入_游戏版本.ecs`、`09_输入_遭遇方法.ecs`、`10_输入_遭遇地点.ecs` → `frlg_catalog_runtime.py` 与 `python_catalog.json`。
- `lib/23_显示_文本.ecs` → `frlg_text_runtime.py` 与 `python_text.json`。
- `lib/26_数据_野生遇敌槽.ecs` → `frlg_wild_data_runtime.py` 与 `python_wild_data.json`。

每次生成项目都会先复制当前脚本包中的 ECS，解析到 JSON，再将原文件保存到
`lib/python_backup/` 并写入同名 `EXTERN` 声明。这样 `07` 的组合键仍按
`0..1999` 顺序查找，`26` 的表仍按 `0..629` 和 9 个分块访问；输入别名也保留
ECS 的大小写和首次匹配规则。`script_host.py` 只在项目带对应快照时绑定 Python
回调，普通 ECS 脚本不会误用这些回调。

## 第四阶段：跨函数状态计算

`25_校准_投票决策.ecs` 和 `28_反查_孵蛋.ecs` 现在也由 Python 执行。这里的迁移重点
不是把状态删掉，而是把 ECS 文件级全局数组改成“每次脚本运行一个 Python 会话对象”：

- `25` → `CalibrationVoteSession`（`frlg_vote_runtime.py`）。`$V_相位表`、`$V_Seed表`、
  `$V_圈数表`、滑动样本、停糖计数以及 `$C_本*`/历史共同区数组都属于该对象；
  `投票投候选`、`投票决策`、`投票设置帧窗`、`共同区收集/提交` 和所有 getter 继续使用
  原函数名和参数顺序。
- `24` → `BingoSession`（`frlg_bingo_runtime.py`）。9×9 命中计数、TV 帧计数、死区、
  稳定簇判断和 BINGO 文本渲染都由 Python 会话维护；原 ECS 的 `PRINT` 通过宿主日志回调
  输出，因此显示内容仍进入原来的脚本日志。
- `28` → `EggReverseSession`（`frlg_egg_reverse_runtime.py`）。双亲、观察条件、Held
  候选、Pickup 结果、RNG 工作区和遗传来源都属于该对象；`执行`/`执行HEX` 直接在 Python
  扫描，遗传顺序、方法 11–14 的 skip、相性判定和结果保存上限沿用原 ECS 顺序。

生成器会把这三个文件的原始字节保存到 `lib/python_backup/`，生成同名 `EXTERN` 声明，
并写入 `python_bingo.json`、`python_vote.json`、`python_egg_reverse.json`。宿主在一次运行开始时创建会话并绑定
回调，运行结束后对象随宿主释放；因此状态变化由 Python 主动维护，不会依赖 ECS 全局变量，
也不会跨任务串状态。`24`/`25`/`28` 的 ECS 副本只用于逐函数审计和差分，不参与计算。

仍保留在 ECS 的主要是 `16`、`18`–`22`、`26_识图_候选数字.ecs` 和 `27` 的设备流程：
它们直接包含按键、等待、图像标签或 OCR。`26_数据_野生遇敌槽.ecs` 已属于前一阶段的纯查表
迁移，和识图版 `26_识图_候选数字.ecs` 不同。

混合流程库也只保留必要的 ECS 部分：`15/17` 的目标支持与狩猎地带判断、`27` 的
`孵蛋测试_查找Seed等待MS` 已绑定 `frlg_flow_runtime.py`；同文件中的按键、等待、OCR、
识图和时间轴循环仍在 ECS。生成目录中的 `python_flow.json` 和 `lib/python_backup/`
记录了这几个函数的原始签名与来源。

## 第五阶段：主脚本通用反查（修补遗漏）

2026-10-07：普通目标生成流程另接入本应用原创的[自适应候选细分策略](FRLG_ADAPTIVE_REFINEMENT.md)。下述 Seed／ADV 计算迁移仍做差分验证，但新的喂糖停止条件、预算及证据提交方式属于有意的行为改变，不能表述为原版流程完全等价。

前四阶段只迁移了库函数。主脚本内仍有 Seed/ADV 双重扫描和 PID 重试循环，
因此即使 `RNG下一HI/LO` 已是 Python，界面依然会长时间显示
`设置变量 $临RAND`。库函数的差分通过不能证明整条反查已经迁出 ECS。

现在普通及孵蛋项目生成器都会在应用 GUI 覆盖后，调用
`frlg_main_reverse_migration.materialize_python_main_reverse`。正式版和时间轴版
共用的计算入口对应如下：

| 原 main.ecs 函数 | `frlg_main_reverse_runtime.py` 中的实现 |
| --- | --- |
| `执行反查扫描` | `MainReverseSession.scan`：Seed/ADV 遍历、预消耗、三方法合并扫描 |
| `临时RNG前进一次` | `step`；扫描内部直接计算 LCG，无逐步 EXTERN 调用 |
| `按算法生成个体` | `generate`：Static/Wild 1/2/4、PID 性格锁定、游走 IV Bug |
| `IV是否在范围`、`检查是否匹配` | Python 范围比较、`match`：物种/等级/性格/性别/IV |
| `重置本轮候选状态` | `reset`：重置本轮结果，保留跨轮投票历史 |
| `处理匹配候选` | `collect`：共同区、同 Seed/帧判断、离群优先、MSE 排序 |
| `记录当前候选为最佳候选` | `record_best`：写入全部命中和候选评分字段 |

原主脚本保存在生成目录的 `python_backup/main.ecs`（不会作为库自动加载）。
`python_main_reverse.json` 记录原文件、逐函数 SHA-256、输入类型和写回字段。
生成后的同名函数有迁移注释，只有状态传入、一次 Python 调用和结果写回；
不会在 ECS 内循环扫描。预消耗用 LCG 复合跳步，保持与逐步推进相同的结果。
函数内部的中文状态键对应原 ECS 变量，便于对照调试。

每次进入都读取流程当下的 Seed、有效帧窗、当前野生槽表、观察结果和累计修正；
因此扩窗或吃糖改变 IV 条件后不需要重新生成项目。返回前写回候选计数、命中结果、
允许更新标志和所有原全局输出。投票与共同区复用宿主的同一个 `CalibrationVoteSession`。
扫描每 128 帧、每个 Seed、每 64 次 PID 重试检查停止请求；停止后不继续写回结果。
识图、喂糖、按键、等待和外层流程调度仍按原路径执行。

验证：`npm run test:frlg:execution` 已接入差分测试，也可单独运行
`python -X utf8 tests/frlg-main-reverse-migration.py`。需要同级
`auto-poke-rng-scripts/bundles/frlg-automation/files` 审计语料，或用环境变量
`FRLG_SCRIPT_CORPUS` 指定语料目录；npm 入口在缺少语料时会明确标记该项跳过。
测试先在未修复版本中
复现两个入口仍有 ECS 扫描循环，再比较新旧计算的全部全局输出，覆盖 7 种算法选项、
扩窗/观察变化、两版本表边界、无候选、PID 耗尽、野生槽位和等级、游走 IV、
TV 与共同区跨轮投票、停止请求，并实际调用 `script_host.run` 验证宿主绑定。
扫描日志逐行比较；共同区提交时原库的诊断文字不在计算结果对比范围内（此前的
`25` 迁移已省略该诊断打印）。测试不以耗时阈值判定通过，以免机器性能造成波动。

旧 `.frlg-runs` 是不可自动更新的运行快照。更新应用运行时代码后，应重新启动应用、
重新开始自动流程生成项目，才会使用这次补迁移；仅更新下载的 ECS 脚本包不够。
本次完成的是上述通用反查计算链，不代表主脚本中所有其他计算入口也已迁移。

## 原创识别优化：按遇敌环境限定名称候选

2026-10-07：生成流程另安装 `GUI_OCR_ENCOUNTER_SCOPE_V1`，在加载遇敌表时显式同步实际游戏版本、地点和遭遇方式。OCR 与单字回退都使用该环境的完整物种名单，并保留 Sprite 图像确认；原名称得分公式继续做差分验证。候选范围、替代候选保留和回退确认属于原创行为变化，详见[地点识别约束说明](FRLG_OCR_ENCOUNTER_SCOPE.md)。
