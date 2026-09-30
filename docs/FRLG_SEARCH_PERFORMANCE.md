# 火叶计算性能与优化

2026-09-30：第一轮优化已进入火叶共用计算层，覆盖目标反查、定点/野生个体搜索、初始 Seed 索引、指定 Seed 模式查询和 IV 档位计算。仍为 Python 实现；原版选优规则、结果和输出顺序保持一致，尚未加入 C++ 内核。

## 已实施的优化

- **IV → PID/目标 Seed 反查及个体筛选**：性格、闪光和特性在 PID 确定后提前筛选，避免对不匹配 PID 继续执行野生遭遇反向循环。性别仍按实际槽位的物种性别比计算，避免混合物种时误筛。
- **隐藏力量计算**：每组 IV 只算一次并提早应用属性筛选；直接提取六项低位，减少循环和生成器开销。定点、野生和游走共用的计算均受益。
- **初始 Seed 索引**：遍历完整低 16 位周期，通过模逆求高位周期数，代替 65536 次单独的 32 位距离计算。对所有 65536 项以原来的距离算法穷举核对，不通过抽样验证数学变换。
- **指定 Seed 的模式/启动时间查询**：利用 Seed 表已有反向索引，不再为每个模式构造并遍历整张连续表。保留出现顺序、重复时刻、按键偏移及模式平手规则；不额外缓存 Seed 表结果，更新表后不会读到旧时刻。
- **IV 档位计数与枚举**：滑动窗口一次得到所有档位的组合数，以不可变边界键缓存（最多 64 组）；递归枚举预先计算后缀上下界。工作量计数、取消检查和同档完整搜索语义不变。

下面是同一机器、同一解释器下，固定输入串行执行的无分析器基准。每项比较完整结果摘要，包含列表顺序，全部一致。毫秒为单次耗时；初始路线/指定 Seed 重复 100 次、档位计数/枚举重复 3 次取均值，其他反查为一次完整调用。数值有机器负载波动，微秒级差异不视为性能变化。

| 计算入口 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 野生目标反查，全部方法、闪光、六项 IV 27–31 | 3396 ms | 374 ms |
| 定点目标反查，Static 1、闪光、六项 IV 27–31 | 325 ms | 146 ms |
| 野生目标反查，不限闪光、六项 IV 29–31 | 175 ms | 159 ms |
| 定点目标反查，不限闪光、六项 IV 29–31 | 49 ms | 41 ms |
| 初始 Seed 索引首次构建 | 512 ms | 141 ms |
| 指定 Seed 自动选择模式 | 5.23 ms | 0.034 ms |
| 六项 IV 0–31 的全部 187 档组合计数 | 233 ms | 0.188 ms |
| IV 合计 178 的完整枚举 | 1.99 ms | 1.55 ms |
| 索引已构建后的初始 Seed 路线查询 | 0.20 ms | 0.21 ms |
| 从能力值计算 IV 范围（1000 次均值） | 0.058 ms | 0.061 ms |

最后两项原本已经很快；本轮没有改写能力值反推公式或已缓存的路线查询。不会为了“所有计算都改”引入没有收益的改动。

同一大嘴蝠方案请求，纯搜索首次从 0.797 秒降至 0.170 秒，同进程重复从 0.166–0.182 秒降至 0.016–0.017 秒；Advance 0–10000 的慢案例从 67.294 秒降至 8.353 秒。默认野生、定点以及慢案例都与参考项目完整 JSON 对照通过，慢案例仍为 BFBD / 212 / IV 合计 165。以上不包含模块导入、进程启动、IPC 和 UI；实际 Electron 链路本轮验收约 0.83 秒。

范围边界：这里的“目标反查”是 `search_targets` / `search_static` / `search_wild` 按 IV 与个体条件恢复目标 PID/Seed 的计算。应用当前只向页面开放参数校验和方案搜索；实机捕获后校准/反查尚未接入。内置的 `calibration_static/wild` 原版包装仍需要尚未交付的 `calibration_bind` 扩展，本次没有声称该流程可以运行或已经完成性能验收。后续接入时，应把其窗口枚举和观测匹配纳入同一性能/正确性矩阵。

## 优化前的实测基线

环境：Windows x64、Intel i7-11800H、项目内 Python 3.12.10。请求使用 `tests/fixtures/frlg-golbat-plan.json`：火红 Switch 1、TID 0 / SID 38448、华蓝洞窟 1F、大嘴蝠、全部野生方法、星形/方形闪光，其余条件不限。

以下时间不启用 cProfile，计量 `search_best_plan(...).to_dict()`，不含解释器启动、模块导入、IPC 和 UI。每组在独立进程中开始，重复搜索共享进程内缓存；不是跨机器性能承诺。

| Advance 范围 | 冷/热状态 | 搜索耗时 | 初始 Seed / Advance / IV 合计 |
| --- | --- | ---: | --- |
| 3000–100000 | 首次 | 0.797 秒 | 7422 / 25296 / 181 |
| 3000–100000 | 同进程第二次 | 0.182 秒 | 同上 |
| 3000–100000 | 同进程第三次 | 0.166 秒 | 同上 |
| 0–10000 | 首次 | 67.294 秒 | BFBD / 212 / 165 |

模块导入另计约 0.21–0.24 秒。默认案例此前实测包含进程启动约 1.1 秒，详见 [行为对齐记录](FRLG_PLANNER_PARITY.md)。不同 Advance 范围会淘汰不同的初始 Seed 路线，迫使搜索继续遍历更低 IV 档位；不能把扩大范围带来的耗时减少计为算法加速。

## 优化前的耗时热点

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

## 后续原生优化

局部优化已完成，下一步如需继续加速，应根据新的热点迁移批量计算：IV 恢复、定点/野生反向 PID/遭遇搜索，而不只迁移推荐方案选择函数。保留 Python 的分档、路线选择和序列化，先替换计算内核，降低行为偏差的排查成本。一次传入一批 IV 范围/条件、批量返回结果，避免每次 RNG 推进跨语言调用。首次索引已经缩短到约 0.14 秒，进一步预生成或原生化的优先级低于慢查询内核。

优化后对同一慢案例重新分析：反向 RNG 调用从约 1.93 亿次降至 831 万次，IV 恢复仍执行约 88.8 万次；分析总时间约 18.9 秒，`recover_pokerng_iv` 含子调用约 4.5 秒、IV 组合枚举约 2.7 秒。后续原生迁移应覆盖枚举与恢复整个批次。上述分析时间包含 cProfile 开销，不能与无分析器的 8.35 秒相加。

目前工程已有 CMake/MSVC 构建、原生运行时和发布资源组织，可复用工具链。建议新增独立 FRLG 计算库；例如通过 C ABI + `ctypes` 在现有 FRLG Python 子进程内批量调用 DLL，无需另起服务，也无需依赖其他项目的源码。计算库不应链接伊机控、OCR、视频等硬件逻辑，FRLG 与 BDSP 的业务依然隔离。

当前 `third_party/PokeFinder` 和 CMake 的搜索目标主要是 Gen8/BDSP 子集，没有现成可直接切换的 Gen3 野生搜索器；仍需移植、构建和验证。DLL 接入还涉及数据布局、内存所有权、分批取消和打包，不能等同于给现有 Python 加一个编译开关。原版的校准扩展也不等于当前 planner 的反向搜索内核。

暂不优先多线程：同档必须完成后才能选优，返回顺序及平手规则也要稳定；先消除 Python 热循环，再测量是否需要并行。没有原生原型数据之前，不承诺具体加速倍数或“所有查询秒出”。

## 对齐验收条件

原版锚点继续使用 `5a5383ff226059cbf85f0b531c9de283f7b76c45`。当前已经沉淀 467 组原版结果，后续优化仍需遵循：

- 对照 Static/Wild 1、2、4 及全部野生方法、各类遭遇、闪光/性格/特性/性别/隐藏力量筛选；涉及游走搜索时保留其 IV 缺陷语义。
- 核对 32 位无符号回绕、IV 顺序、PID、目标 Seed、槽位/等级、去重、Seed 模式、可达范围，以及完整方案 JSON 和搜索统计。
- 保留“IV 合计优先、同档取最小可达 Advance”及原版平手排序，不能找到第一个可行个体就提前结束同档。
- 验证无匹配、无可达路线、工作量上限、停止搜索；分批调用不能跳项、重复或把未完成误报成无结果。仍需独立目录运行，确认发布产物不依赖参考仓库。
- 以固定请求记录优化前后首次/重复耗时与完整结果，包含默认快案例、受限范围慢案例和定点案例。新增计算路径时扩展现有对照矩阵。

`tests/frlg-compute-regressions.py` 除结果对照外，还验证穷举计数、重复项/偏移/Seed 表替换、无匹配与无可达路线、工作量上限和取消。两项计算工作量回归测试在优化前失败：不匹配闪光的 PID 仍进行约 1.5 万次反向推进；64 组 IV 的隐藏力量被重复计算 260 次。优化后通过，不使用易受机器负载影响的 CI 秒数门槛。

## 复现方法

在项目根目录执行（PowerShell）：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONDONTWRITEBYTECODE='1'
# 实际搜索计时，第一次冷、后两次热
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --timing-only --repeat 3
# 慢案例实际计时
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --timing-only --min-advances 0 --max-advances 10000 --repeat 1
# 热点分析，可用同样的范围参数；优化后的慢案例带分析开销约 19 秒
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --stats-dir node_modules/.tmp/frlg-profile/default
# 也可分析其他 fixture 或纯请求 JSON
.deps/script-python/Scripts/python.exe tools/profile-frlg-planner.py --request tests/fixtures/frlg-starter-plan.json
# 主要共用计算入口的基准（不启用分析器）
.deps/script-python/Scripts/python.exe tests/frlg-compute-cases.py --benchmark
# 对原版使用相同基准；仅开发时需要参考项目
.deps/script-python/Scripts/python.exe tests/frlg-compute-cases.py --source-root D:/project/frlg-auto-rng --benchmark
# 无外部项目依赖的回归检查，包含 467 组原版结果
npm run test:rng
```

测量工具直接调用内置计算，仅输出报告及可选本地产物；原版 fixture 来源和重建方式见 `tests/fixtures/frlg-compute-reference.md`。`node tools/compare-frlg-planner.cjs D:/project/frlg-auto-rng --legacy-range` 还会逐字段比较三类完整方案，原版慢案例需要约一分钟。
