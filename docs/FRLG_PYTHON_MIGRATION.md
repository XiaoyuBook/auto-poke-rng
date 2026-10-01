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
