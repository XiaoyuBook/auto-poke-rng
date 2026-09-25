# BDSP 定点原生计算

本项目直接编译 [Admiral-Fish/PokeFinder](https://github.com/Admiral-Fish/PokeFinder) 的 BDSP `StaticGenerator8`，未改写或移植其算法。采用原 auto-bdsp-rng 使用的 v4.3.2 提交 `2d5c6afed9240f2bdb98634b5b8b1fab352aefa5`，便于与现有流程核对，不自动跟随上游最新版本。

## 来源与构建

- `third_party/PokeFinder/`：49 个上游原文件，包含生成器、IVChecker、Xorshift、Xoroshiro、State、Nature、筛选器、BDSP personal 数据、中文资源和官方测试样例。清单、提交号及逐文件 SHA-256 见 `manifest.json`。
- 定点模板来自上游锁定的 EncounterTableGenerator 子模块提交 `7769c1df80be93761fe6479d51cbf2fe7a7dc4f9`，共 47 个目标、9 个实际类别。
- `tools/generate-bdsp-data.mjs` 校验原文件哈希，从同一份资源生成前端列表和 C++ 内嵌数据。personal 字段偏移与上游 `Core/Resources/Embed/embed_personal.py` 一致。
- `runtime/src/bdsp_personal_loader.cpp` 仅替换资源装载入口；`runtime/src/pokefinder_static.cpp` 处理参数校验、模板查找和 JSON 转换。生成算法保持上游原样。
- PokeFinder 编译目标使用 C++23（上游使用 `std::byteswap`）；现有设备代码仍用 C++20。无需 Qt，也无需运行原版 GUI。

```powershell
npm run build:runtime
npm run build
npm run test:rng
npm run test:rng:electron
```

仓库已包含所需源码，正常构建不需要旁边的 auto-bdsp-rng 项目。重新导入时，准备对应版本的 PokeFinder checkout 及其 EncounterTables 子模块，再执行 `node tools/vendor-pokefinder.mjs <checkout>`。脚本读取 Git 提交中的原始字节；`.gitattributes` 禁止换行转换，避免 Windows 检出破坏哈希。

## 接线与参数含义

界面 → preload → 主进程 `rng-client.cjs` → 独立 `poke-runtime --role rng` → 上游生成器。计算进程不创建视频或控制器服务；取消搜索只结束 RNG 子进程。只接受主窗口主 frame 的请求。

首页存档信息保存在本地并供定点页面使用，包括 BD/SP、16 位 TID/SID 和存档标记；目标列表按版本过滤。上游 BDSP 定点生成器不使用闪耀护符提升异色概率。TID/SID 用于最终 PID 修正，异色类别遵循 BDSP 的生成规则。

“管理”沿用 auto-bdsp-rng 的当前存档编辑对话框：编辑名称、版本、TID/SID、图鉴与护符标记，保存后统一应用，取消不修改原值。它不是多存档库。

两个 Seed 均为 1–16 位十六进制字符串，完整保留 64 位精度；全零状态无效。初始帧范围 0–10,000,000，最大帧数 0–1,000,000,000，Offset 0–1,000,000。最大帧数是追加距离且包含首尾：初始帧 100、最大帧数 0 只生成第 100 帧；最大帧数 9 生成 100–109。Offset 推进 RNG 状态，不改变显示帧号。

主进程按 4,096 帧分批计算，原始 Seed、Offset、存档和筛选条件保持一致，以每批的初始帧续算。结果超过 250,000 条时明确报错并清空本次结果，要求缩小范围或增加筛选，不返回截断的成功结果。表格每页显示 200 条，复制和 CSV 导出涵盖本次全部结果。浏览器预览和引擎错误不会产生模拟数据。

队首菜单保留原应用的“无”“同步 → 25 种性格”“迷人之躯 ♀ / ♂”，对应数值 255、0–24、25/26。种族、性格、个性和特性中文来自上游资源；分类名称沿用原应用。

表格设置仅控制属性列显示，帧数列始终保留，可以恢复全部列，选择保存在本地。复制与 CSV 导出仍包含全部属性。“筛选方案”按产品要求移除。

定点页面按“目标选择与只读摘要 → 两行乱数参数 → 六列个体值矩阵和其他筛选 → 结果表”排列；结果数量和状态合并显示，能力值切换位于表格上方。按左侧实际宽度调整控件排列，小窗口仅滚动参数区，生成与表格操作保持可见；右侧视频与日志布局保持独立。Electron 回归检查覆盖常用宽度下参数完整展示、窄窗口控件对齐、16 位 Seed 显示和末尾筛选项可达性，并保存布局截图。

## 个体值计算器

计算器从当前定点目标带入种族、形态和等级，可以改选 BDSP 支持的宝可梦。按努力值为 0 计算，输入一组或多组“等级 + 六项实际能力值”，可补充性格、个性、觉醒力量类型。种族值、形态名称、个性和类型文本均来自同一份上游资源。

`rng:iv-calculate` 调用单独的 RNG 子进程，通过 `runtime/src/pokefinder_iv.cpp` 适配上游未修改的 `IVChecker::calculateIVRange` 和 `nextLevel`。因此取消定点搜索不会中断正在进行的个体值计算。结果保留不连续候选值，不将缺失值伪装成连续范围；建议复测等级从已录入的最高等级开始，无解时清空所有候选和建议。结果不会自动改写定点筛选条件。

脱壳忍者的固定 1 HP 在适配层单独处理：HP 能力值不能约束 HP 个体值，仍可由个性和觉醒力量限制候选；不建议用升级复测 HP。其他种族直接沿用上游 IVChecker 的行为，包括未知性格时的范围估算。

## 已修正的差异

- 删除旧前端 LCG 演示算法、32 位 Seed 截断、最多 200 行/300 帧的隐性限制和猜测的能力值。
- 玫瑰公园的隐藏特性按上游模板显示、计算；梦幻/基拉祈的等级采用上游的 1/5，修正 auto-bdsp-rng 旧等级默认值 70。
- 能力值、个性、性别、异色、EC、PID 和体型全部读取原生 State；前端仅负责显示。
- “非异色”在适配边界过滤 `shiny == 0`，因为上游 StateFilter 的异色位掩码不表达此选项。“取消筛选”同时放开身高/体重，补齐上游 skip 仍检查体型的行为；均有回归测试。
- 最大帧数 0、身高/体重上限 0 不再被当成空值替换。

## 验证与边界

`tests/pokefinder-native.cjs` 直接读取未修改的上游 `Test/Gen8/static8.json`，对 7 组、70 条结果逐字段比较 EC、PID、帧、IV、真实能力值、特性编号与槽位、性别、等级、性格、异色、身高、体重、个性，并覆盖全部同步性格、两种迷人之躯、Offset、完整 Seed 和错误参数。

`tests/pokefinder-iv.cjs` 比对上游 BDSP 胡地样例，以及种族值在 HGSS/BDSP 间一致的谢米两形态样例；覆盖多组观测、输入顺序、未知选项、无解、非法参数与脱壳忍者固定 HP。

`tests/rng-client-regressions.cjs` 覆盖跨批次真实结果、默认搜索范围、取消/重试、窗口销毁、来源限制、结果上限及计算器与搜索取消的隔离。前端测试覆盖菜单、存档编辑与持久化、存档传参、版本限制、真实结果展示、零上限、错误、分页复制、列隐藏与对齐、计算器输入与过期响应。`tests/pokefinder-electron.cjs` 验证真实 Electron preload/IPC/原生进程链路，并生成定点页面、菜单、存档管理、表格设置和个体值计算器截图至 `node_modules/.tmp/pokefinder-review/`。

本次接入的是 BDSP 定点/游走生成器和个体值计算器，没有接入 TID、孵蛋或其他世代引擎。存档管理和表格属性列设置已接通；筛选方案不提供。OCR 与自动化流程尚未消费搜索结果。

## 许可

上游源码保留原版权头和 `third_party/PokeFinder/LICENSE`（GPL-3.0-or-later）。编译并分发包含该核心的程序时需遵守其 GPL 许可、保留声明并提供对应源码与构建材料；本次不替项目其他部分选择许可证。
