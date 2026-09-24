# 测试入口

在项目根目录运行。设备测试支持 Windows x64，使用 Node.js 22.12+、CMake/CTest 3.24+ 和 Python 3.12+。首次运行先执行 `npm install`、`npm run setup:runtime`；修改 C++ 后先执行 `npm run build:runtime`，避免测试旧二进制。

| 命令 | 内容 |
| --- | --- |
| `npm test` | Vitest 单元和组件测试 |
| `npm run test:devices:regression` | 公共伊机控、视频源、Python 帧读取及测试启动器的审查回归 |
| `npm run test:runtime` | CTest 核心测试、原有 Node 集成测试，以及全部设备审查回归 |
| `npm run test:devices` | 构建界面后，在真实 Electron 中验证模拟设备接线 |
| `npm run test:electron` | 桌面窗口、面板、脚本文件等集成验证 |

设备问题与用例编号、已知失败、视频依赖策略和硬件覆盖边界见 [公共设备回归资产](../docs/DEVICE_REGRESSIONS.md)。当前 DEV-001 至 DEV-005 尚未修复，两个包含它们的命令会返回失败；这不代表回归资产已全部通过。

设备 Node 用例使用 `.cjs` 文件名和 `node:test`，由以上命令显式执行，不由 Vitest 的 `*.test.*` 发现规则收集。增加回归文件时，同时更新 `package.json` 中的独立回归命令和 `tools/test-runtime.ps1` 的文件清单。

视频测试必须保留 `--test-concurrency=1`，合成源也受采集所有权互斥量约束。运行前断开开发应用的视频源；不要同时启动另一套设备测试。新增回归本身不捕获真实键盘，完整 `test:runtime` 中已有的键盘钩子退出测试会启动实际钩子，仅映射 F24。

Python 默认使用 `.deps/script-python`；可通过 `AUTO_POKE_PYTHON` 指定解释器。独立调试帧读取契约不需要采集卡或 C++ 进程，也不依赖第三方 Python 包：

```powershell
python -X utf8 runtime/tests/test_frames.py
```

只调试某个 Node 回归时，可按编号筛选：

```powershell
node --test --test-name-pattern=DEV-003 tests/device-regressions.cjs
```

测试输入夹具位于 `tests/helpers`、`tests/fixtures` 和 `runtime/tests/test_frames.py`。它们可由版本控制复现，执行不依赖审查期间的 `.deps/module-review` 临时文件。设备用例退出时释放自身资源；测试结果、截图和构建目录仍按项目现有忽略规则处理。
