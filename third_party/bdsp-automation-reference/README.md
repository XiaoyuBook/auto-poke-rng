# 自动流程行为基准

固定源版本与每个文件 SHA-256 见 `manifest.json`。原始文件不得改动。

本目录仅用于比对和测试，应用运行不得从这里导入业务模块。生成工具：`tools/snapshot-bdsp-automation.mjs`，仅从指定 Git commit 读取，不包含原仓库未提交修改。

`tests/automation` 保留原测试断言，只把脚本、PokeFinder ID 数据和 Project_Xs fixture 路径适配到当前仓库。`--reference` 用本目录建立旧版基线，默认测试必须指向 `runtime/python`。测试设备使用 fake services 和虚拟时钟。

`src` 中五个空包入口为测试 harness，用于防止包初始化连带导入 GUI；其余源码和脚本保持原文。参考代码按附带的 GPL-3.0-or-later 许可证使用，来源为 XiaoyuBook/auto-bdsp-rng；ID 夹具来自原仓库锁定的 PokeFinder 子模块（GPL-3.0）。
