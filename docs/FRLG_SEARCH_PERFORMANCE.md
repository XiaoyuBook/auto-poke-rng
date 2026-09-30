# 火叶搜索性能评估

2026-09-30：C++ 加速可行，值得优先针对慢查询的野生反向搜索内核评估。当前提交只调整推荐卡布局、增加测量工具，没有替换搜索实现或改变原版的选优规则，也没有声称已获得原生加速。

## 实测基线

环境：Windows x64、Intel i7-11800H、项目内 Python 3.12.10。请求使用 `tests/fixtures/frlg-golbat-plan.json`：火红 Switch 1、TID 0 / SID 38448、华蓝洞窟 1F、大嘴蝠、全部野生方法、星形/方形闪光，其余条件不限。

以下时间不启用 cProfile，计量 `search_best_plan(...).to_dict()`，不含解释器启动、模块导入、IPC 和 UI。每组在独立进程中开始，重复搜索共享进程内缓存；不是跨机器性能承诺。

| Advance 范围 | 冷/热状态 | 搜索耗时 | 初始 Seed / Advance / IV 合计 |
| --- | --- | ---: | --- |
| 3000–100000 | 首次 | 0.797 秒 | 7422 / 25296 / 181 |
| 3000–100000 | 同进程第二次 | 0.182 秒 | 同上 |
| 3000–100000 | 同进程第三次 | 0.166 秒 | 同上 |
| 0–10000 | 首次 | 67.294 秒 | BFBD / 212 / 165 |

模块导入另计约 0.21–0.24 秒。默认案例此前实测包含进程启动约 1.1 秒，详见 [行为对齐记录](FRLG_PLANNER_PARITY.md)。不同 Advance 范围会淘汰不同的初始 Seed 路线，迫使搜索继续遍历更低 IV 档位；不能把扩大范围带来的耗时减少计为算法加速。

## 耗时在哪里

独立启用 cProfile 定位热点，分析工具会显著增加循环耗时，以下数字不能当作用户等待时间：

| 案例 | 分析总时间 | 主要热点 |
| --- | ---: | --- |
| 默认范围首次 | 0.939 秒 | 初始 Seed 索引构建约 0.631 秒，计算 65536 个 Seed 的 RNG 距离 |
| 默认范围重复 | 0.246 秒 | `search_wild` 含子调用约 0.211 秒 |
| 0–10000 | 128.900 秒 | `search_wild` 含子调用约 128.149 秒，占约 99.4%；`pokerngr_next` 调用 192987378 次 |

对应代码：

- `runtime/python/frlg_planner/rng/tenlines.py`：`search_wild`、`recover_pokerng_iv`、`pokerngr_next`、`build_sorted_initial_seeds`。
- `runtime/python/frlg_planner/rng/tenlines_utils.py`：按 IV 合计分档枚举、筛选及 Seed 路线查询。
- `runtime/python/frlg_planner/automation/planner.py`：完整扫描同档目标后选取最优路线。

`electron/frlg-rng-client.cjs` 已复用常驻 Python 子进程，索引也已有内存缓存。正常连续搜索不会重复构建索引；停止搜索会结束子进程，下一次会重新构建。因此“把 Python 改为常驻”并不是尚未实施的新优化。

## 建议实施顺序

1. **先做保持语义的局部优化实验。** 野生搜索在确定 PID 后，闪光/特性已经确定，隐藏力量由 IV 确定；现在这些条件要等到反向循环内部才检查。可尝试提前排除不匹配项、避免重复计算，再用原版逐字段对照。性别依赖遭遇槽位物种，不能不加区分地提前筛掉。此项在闪光查询中可能有较大收益，但尚未实现、尚无加速数据。
2. **将野生搜索批量内核迁到 C++。** 32 位 RNG 推进、IV 恢复、反向 PID/遭遇槽位循环适合原生代码。保留 Python 的分档、路线选择和序列化，先替换最耗时的一段，降低行为偏差的排查成本。一次传入一批 IV 范围/条件、批量返回结果，避免每次 RNG 推进跨语言调用。
3. **单独处理首次搜索延迟。** 可评估随包附带经过校验的初始 Seed 索引，或原生计算。它只改善首次构建的数百毫秒，对一分钟级野生搜索帮助有限。

目前工程已有 CMake/MSVC 构建、原生运行时和发布资源组织，可复用工具链。建议新增独立 FRLG 计算库；例如通过 C ABI + `ctypes` 在现有 FRLG Python 子进程内批量调用 DLL，无需另起服务，也无需依赖其他项目的源码。计算库不应链接伊机控、OCR、视频等硬件逻辑，FRLG 与 BDSP 的业务依然隔离。

当前 `third_party/PokeFinder` 和 CMake 的搜索目标主要是 Gen8/BDSP 子集，没有现成可直接切换的 Gen3 野生搜索器；仍需移植、构建和验证。DLL 接入还涉及数据布局、内存所有权、分批取消和打包，不能等同于给现有 Python 加一个编译开关。原版的校准扩展也不等于当前 planner 的反向搜索内核。

暂不优先多线程：同档必须完成后才能选优，返回顺序及平手规则也要稳定；先消除 Python 热循环，再测量是否需要并行。没有原生原型数据之前，不承诺具体加速倍数或“所有查询秒出”。

## 对齐验收条件

原版锚点继续使用 `5a5383ff226059cbf85f0b531c9de283f7b76c45`。任何优化进入默认路径前，需要：

- 对照 Static/Wild 1、2、4 及全部野生方法、各类遭遇、闪光/性格/特性/性别/隐藏力量筛选；涉及游走搜索时保留其 IV 缺陷语义。
- 核对 32 位无符号回绕、IV 顺序、PID、目标 Seed、槽位/等级、去重、Seed 模式、可达范围，以及完整方案 JSON 和搜索统计。
- 保留“IV 合计优先、同档取最小可达 Advance”及原版平手排序，不能找到第一个可行个体就提前结束同档。
- 验证无匹配、无可达路线、工作量上限、停止搜索；分批调用不能跳项、重复或把未完成误报成无结果。仍需独立目录运行，确认发布产物不依赖参考仓库。
- 以固定请求记录优化前后首次/重复耗时与完整结果，包含默认快案例、受限范围慢案例和定点案例。已有两份真实方案 fixture 是起点，不足以替代完整方法矩阵。

## 复现方法

在项目根目录执行（PowerShell）：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONDONTWRITEBYTECODE='1'
# 实际搜索计时，第一次冷、后两次热
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --timing-only --repeat 3
# 慢案例实际计时
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --timing-only --min-advances 0 --max-advances 10000 --repeat 1
# 热点分析，可用同样的范围参数；慢案例带分析开销约两分钟
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --stats-dir node_modules/.tmp/frlg-profile/default
# 也可分析其他 fixture 或纯请求 JSON
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --request tests/fixtures/frlg-starter-plan.json
```

测量工具直接调用内置 planner，仅输出报告及可选本地产物，不改变运行时。通过默认冷/热、受限范围和 cProfile 实跑验证；不设置易受机器负载影响的 CI 秒数门槛。
