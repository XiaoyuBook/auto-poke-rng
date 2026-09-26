# 测试入口

在项目根目录运行。设备测试支持 Windows x64，使用 Node.js 22.12+、CMake/CTest 3.24+ 和 Python 3.12+。首次运行先执行 `npm install`、`npm run setup:runtime`；修改 C++ 后先执行 `npm run build:runtime`，避免测试旧二进制。

| 命令 | 内容 |
| --- | --- |
| `npm test` | Vitest 单元和组件测试 |
| `npm run test:scripts:repository` | 空脚本库、旧文件迁移、脚本仓库下载与安装、文件保存和界面确认流程 |
| `npm run test:scripts:package -- <ZIP 路径>` | 校验独立仓库的脚本包，在临时目录安装并逐个编译；不执行脚本，不写用户目录 |
| `npm run test:automation:reference` | 固定旧版自动流程行为基线（不代表本项目已接入） |
| `npm run test:automation` | 对本项目运行时执行同一批自动流程契约测试；未迁移时必须失败 |
| `npm run test:automation:adapters` | JSONL worker、设备占用/停止竞态、配置与日志、冻结原版脚本编译、捕获与 OCR 适配器 |
| `npm run test:automation:electron` | 真实 Electron IPC、模拟视频/手柄、自动流程页面、参数保存、相关日志/浮窗同步、ID worker、OCR 设置；截图保存于 `node_modules/.tmp/automation-review/` |
| `npm run test:devices:regression` | 公共伊机控、视频源、Python 帧读取及测试启动器的审查回归 |
| `npm run test:runtime` | OCR 适配器单测、CTest 核心测试、脚本/设备 Node 集成测试，以及全部设备审查回归 |
| `npm run test:devices` | 构建界面后，在真实 Electron 中验证模拟设备接线 |
| `npm run test:electron` | 桌面窗口、面板、脚本文件等集成验证 |
| `npm run test:qq` | QQ 本地 HTTP／WebSocket 协议、密钥持久化、发送服务与配置组件测试 |
| `npm run test:qq:electron` | 真实 Electron 下的 QQ 配置、系统加密、绑定、图文发送、窗口关闭与布局验证 |

设备问题与用例编号、视频依赖策略和硬件覆盖边界见 [公共设备回归资产](../docs/DEVICE_REGRESSIONS.md)。DEV-001 至 DEV-006 已修复并纳入两个设备回归命令。

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

自动流程先运行固定版本原版基线，再运行当前实现、适配器与Electron测试；完整行为编号与实机验收边界见 [迁移契约](../docs/AUTOMATION_PARITY.md)。全量前端可使用 `npm test -- --maxWorkers=1`，避免多组jsdom与Python编译用例并发争抢CPU而触发既有5秒超时。自动流程测试不需要向QQ发送消息，不连接真实串口；长流程状态由模拟worker驱动，真实捕获/OCR/按键时序另做实机验收。

QQ 测试只访问本地模拟服务，不使用真实 QQ 凭据或向外部接收方发消息。Electron 测试使用隔离配置目录，验证实际系统加密和有效 JPEG 图片，截图保存在 `node_modules/.tmp/qq-notifications-review/`。回归包含旧码／错误事件拒绝、部分失败不重发、取消清理、保存失败保留旧配置、清除密钥同时清除客户端缓存，以及绑定码自动滚动到可见区域。真实 QQ 开放平台权限和实际收件情况需要使用自己的机器人手动验证。

教程回归逐一检查 12 步图片在构建后的 Electron 应用中可离线加载，验证关键区域预览、完整原图、原始尺寸和缩放，并确认 Esc 仅关闭图片查看器、不会关闭教程或丢失接入草稿；包含 1100 × 680 窗口截图。
