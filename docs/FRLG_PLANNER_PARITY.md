# 火叶搜索与推荐结果对齐

锚点：`frlg-auto-rng` 提交 `5a5383ff226059cbf85f0b531c9de283f7b76c45`。本应用的 planner、Seed 表、遭遇表、个人数据均内置在 `runtime/python/frlg_planner`；不需要旁边存在原版项目。

## 修复的偏差

- Python 对象 `PlanSearchResult` 有 `.plan`，但 `to_dict()` 把方案平铺到顶层。原界面按 `result.plan` 读取，导致目标等级、PID、IV、Seed、Advance 等全部为空。IPC 现在使用明确的扁平 TypeScript 类型，界面依据返回目标展示信息。
- 原版 GUI 搜索范围是 `3000–100000`，本应用原先误设为 `0–10000`。按 IV 合计从高到低搜索时，过小的可达范围会排除高 IV 方案，造成更长搜索时间和不同结果。现在默认值一致；用户仍可显式调整范围。
- 特性筛选应发送物种的第三世代英文特性名，不能发送槽位字符串 `0/1`。选项与中文名称从内置个人数据和原版译表生成。
- 推荐卡展示实际普通/闪光精灵、物种、地点、等级（原版返回时）、Seed、Advance、IV 合计和六项 IV、性格、特性、性别。详情补充 PID、目标 Seed、训练家/ROM、隐藏力量、Seed 模式、启动等待、游戏按键设置和原版警告。
- 推荐方案直接占用目标卡右侧的位置；待命/搜索状态原位切换为具体方案，不再在基础设置下方重复展示。窄窗口自动纵向排列。
- 指定 Seed/Advance 模式不计算个体属性；不将筛选条件伪装为结果。定点 planner 的 `level=0` 表示未提供等级，界面显示“定点目标”，不会显示 LV 0。
- 切换存档会丢弃旧方案和迟到的旧搜索响应；同类方法之间切换不重置物种和地点。
- 共用计算层已优化定点/野生 IV 反查、筛选、初始 Seed 索引及精确模式查询、IV 档位枚举。内置代码以原版为行为锚点，不再要求逐字节相同；返回内容、顺序、选优和工作量边界由对照与回归测试约束。

## 实测与边界

2026-09-30，在同一 Windows 机器和同一 Python 解释器下，对火红 Switch 1、TID 0、SID 38448、华蓝洞窟 1F、大嘴蝠、全部野生方法、闪光、其他属性不限进行对照：

| 范围与实现 | 耗时（包含进程启动） | 初始 Seed | Advance | IV 合计 |
| --- | ---: | --- | ---: | ---: |
| 原来的默认范围 0–10000，内置版 | 65.43 秒 | BFBD | 212 | 165 |
| 原版默认范围 3000–100000，内置版 | 1.11 秒 | 7422 | 25296 | 181 |
| 原版默认范围 3000–100000，原版 | 1.08 秒 | 7422 | 25296 | 181 |

相同请求下整个序列化结果逐字段一致。另对 Static 1 妙蛙种子筛选搜索作了相同对照，结果也一致（7422 / 25359，IV 合计 181）。耗时不是跨机器性能承诺；收紧搜索范围或筛选条件仍可能变慢。截图本身没有包含原版所有输入，因此不将不同输入下的 Seed 值强行改成截图中的 A62C。

搜索对照验证的是搜索、选优、参数映射和结果展示。当前已另行接通生成、预检、公共执行器、捕获、反查校准与重试；验证范围和实机边界见 [完整执行接入](FRLG_EXECUTION_PARITY.md)。设备模拟和离线契约测试不能代替实际游戏画面的 OCR、捕获与时序验收。

2026-10-03 增加 Switch 2 Blackout R 的本地启动时序覆盖：R 提前 1000ms，并补回保持时间以维持总 Seed 等待；模式 8 非 TV 案例已有用户实机成功反馈。此项不属于搜索算法或 Seed 表差异，上游同步时需单独保留或验证等效替代，详见 [本地修复与同步维护要求](FRLG_EXECUTION_PARITY.md#switch-2-blackout-r-本地时序修复2026-10-03)。

## 回归与复核

- `tests/fixtures/frlg-{golbat,starter}-plan.json`：从锚点原版的真实非指定搜索得到的扁平 JSON，同时供 Python 和前端测试使用。
- `tests/frlg-rng-host.cjs`：独立临时工作目录中使用内置运行时，验证指定模式、普通野生筛选、带具体 IV/特性条件的筛选和静态筛选。
- `src/components/FrlgAutomationWorkspace.test.tsx`：断言具体显示内容、默认 payload、真实特性名、指定模式、存档切换。将旧版组件代回时，扁平结果用例稳定失败并复现空字段；恢复修复后通过。
- `npm run test:frlg:electron`：真实 Electron preload → IPC → Python → 推荐卡/详情；检查精灵资源加载和窄窗口布局，截图存入 `node_modules/.tmp/frlg-review/`。设置 `FRLG_SCRIPT_PACKAGE` 后还会安装真实脚本包、生成并启动公共执行器，使用模拟伊机控和视频验证停止及输入释放，不操作真实设备。
- `node tools/compare-frlg-planner.cjs <原版目录> [--legacy-range]`：可选、只读的原版对照工具。原版目录只用于开发验证，不是运行时依赖。
- `tools/generate-frlg-wild-data.py`：从内置快照重新生成遭遇与显示元数据；精灵资源单独附 SHA-256 来源清单。
- `tests/frlg-compute-cases.py` / `tests/frlg-compute-regressions.py`：467 组原版计算对照、完整初始 Seed 索引与工作量回归，已纳入 `npm run test:rng`；来源说明见 `tests/fixtures/frlg-compute-reference.md`。
- [计算性能与优化](FRLG_SEARCH_PERFORMANCE.md)：已落地的共用计算优化、实测前后对照、C++ 后续方向和 ECS 反查性能边界。
