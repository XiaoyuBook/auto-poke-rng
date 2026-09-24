# 公共设备模块回归测试资产

来源：2026-09-23 伊机控与视频源模块审查；2026-09-24 转为仓库内自动化测试。这里记录问题、正确行为、复现入口和覆盖边界。用例直接调用生产实现，修复后继续保留，防止后续公共模块改动重新引入问题。

## 执行入口

在 Windows 项目根目录执行，环境准备见 [测试说明](../tests/README.md)：

```powershell
# 只运行本次审查形成的回归资产
npm run test:devices:regression

# C++ 核心测试、既有集成测试和本次回归测试
npm run test:runtime
```

DEV-001 至 DEV-006 已修复，用例继续断言正确行为并作为公共设备回归保留。没有使用 skip、expected-failure 或反向断言隐藏缺陷。DEV-007 的视频依赖策略已确定，并由运行时集成测试覆盖。

修复后验证（2026-09-24，Windows、本地已构建运行时）：

| 执行范围 | 结果 |
| --- | --- |
| `npm test` | 9 个文件、47 项通过 |
| `npm run test:runtime` 中的 CTest | 1/1 通过 |
| `npm run test:runtime` 中的 Node 测试 | 15 项通过（含设备回归） |
| `npm run test:devices:regression` | 7 项通过 |
| DEV-004 内部 Python 用例 | 4 项通过 |

以上结果覆盖生产实现、mock 控制器、synthetic 视频和确定性共享内存夹具；真实采集卡、手柄和长时间运行仍由硬件验收确认。

## 用例与契约

| 编号 / 优先级 | 前提与触发步骤 | 必须保证的行为 | 审查时的失败证据 | 自动化入口 |
| --- | --- | --- | --- | --- |
| DEV-001 / P1 | 激活键盘输入，按住 A，经公共 `controller:press` 短按 B，再发送 A 松开 | 输入交接完成且物理键松开后，控制器回到中立，不能遗留 A | 输入管理器已停用、held 集合清空，但原生报告仍为 `buttons=4` | [device-regressions.cjs](../tests/device-regressions.cjs)，`DEV-001` |
| DEV-002 / P1 | 激活键盘并按住 A，调用界面崩溃使用的 `stopInputs()`，再从旧输入源送入 B | 清理关闭键盘捕获，保持输入停用；旧输入不得再次驱动设备，报告应中立 | 清理后仍 `active=true`，B 使报告变为 `buttons=2` | [device-regressions.cjs](../tests/device-regressions.cjs)，`DEV-002` |
| DEV-003 / P2 | 合成视频连接成功后，再次连接同一配置 | 可幂等成功或拒绝 BUSY；原会话仍 connected，截图可用，健康检查继续，仍可断开 | Electron 状态 failed，但原生仍 connected；健康检查已清除 | [device-regressions.cjs](../tests/device-regressions.cjs)，`DEV-003` |
| DEV-004 / P2 | 游标为 1，缓存有序号 2（300 ms）和 3（1 ms）；请求 next 且 `max_age_ms=50` | 不得返回超过 50 ms 的帧；若跳过旧帧，`skipped` 必须可见；拒绝读取不能悄悄推进游标 | 最新帧合格，但 next 返回 300 ms 的旧帧 | [test_frames.py](../runtime/tests/test_frames.py)，`test_dev004_selected_frame_must_meet_max_age` |
| DEV-005 / P2 | UP 按下、UP_RIGHT 按下、UP_RIGHT 松开，最后 UP 松开 | 释放斜向后保留独立按住的 UP（hat=0），最终全部松开才中立（hat=8） | 释放 UP_RIGHT 后直接变为 hat=8 | [device-regressions.cjs](../tests/device-regressions.cjs)，`DEV-005` |
| DEV-006 / P2 | `Get-Command node.exe` 返回两个安装路径，调用真实测试启动脚本 | 选择一个 Node 执行测试，不能将多个路径拼成命令 | CTest 通过后，调用运算符把两条路径作为一个命令，Node 测试未启动 | [runtime-launcher-regressions.cjs](../tests/runtime-launcher-regressions.cjs)，`DEV-006` |

与缺陷测试一起保留的保护用例：

- `DEV-001-GUARD`：拥有控制租约的脚本按住 A 后执行一个纯等待序列，A 仍按住；释放租约才中立。防止用“每个 sequence 结束都 reset”修复交接，却破坏脚本跨 WAIT 保持按键。
- Python 帧读取的正常路径：latest 返回新帧；放宽时效到 1000 ms 后 next 仍按顺序返回序号 2；视频停止时明确报错并释放 mutex。防止用“一律返回 latest”绕过过期帧缺陷。

## DEV-007：视频断连后的任务策略

策略已确定为“按依赖停止”：不使用视频的纯按键脚本继续执行；使用搜图/视频帧的脚本在视频断开、进入连接中或切换到新 session 时停止，释放控制权并报告失败。脚本启动事件携带 `requiresVideo` 和绑定的 `videoSession`，主进程据此监听视频状态，不允许旧脚本跨视频 session 继续运行。

运行时集成测试覆盖纯按键脚本继续、视频依赖脚本在断开时停止，以及旧视频 session 变化时停止。一次性读取图像后仍属于视频依赖脚本，后续动作也会随视频断开终止，避免任务在失去反馈后继续盲操作。

## 夹具与覆盖边界

- [device-fixture.cjs](../tests/helpers/device-fixture.cjs) 加载真实 `devices`、`controller-overlay`、`ControllerInputManager`、`ScriptRunner` 和 `RuntimeClient`。原生控制器使用 mock，视频使用 synthetic，保留真实 C++ 状态机和协议；替换 Electron 窗口/IPC 外壳和 OS 键盘输入源。每个用例关闭自己启动的进程，输入错误会使测试失败。
- DEV-002 调用 `main.cjs` 的 `render-process-gone` 处理器使用的同一清理入口，没有启动 Electron 或真正触发 renderer 崩溃；完整的崩溃事件接线仍需桌面集成验证。
- DEV-004 使用符合共享内存 ABI 的固定字节缓冲和单调时钟，调用真实 `Frames.read`。不依赖机器调度恰好产生 50 ms 边界。既有 `runtime-integration.cjs` 继续验证实际 Python/C++ 共享内存互通。
- DEV-006 只替换命令发现结果和外部可执行工具，调用真实 [test-runtime.ps1](../tools/test-runtime.ps1)，不会递归启动一套测试。
- 视频测试文件串行执行，因为合成视频也使用跨进程采集互斥量。不要同时运行多套设备测试或让开发应用占用视频源。

自动化模拟不能证明实机验收完成。以下场景保留为硬件验收待办，执行时记录采集卡/固件型号、版本、后端、步骤、日志及实际结果：串口或采集卡拔插、驱动读取卡死、睡眠恢复、真实帧率与延迟、长时间运行、报告时序，以及中立报告是否实际到达主机。尚未执行的场景不能标成通过。

## 维护规则

每个确认缺陷先保留能失败的最小复现，修复时使同一用例通过，并运行相关保护用例及 `test:runtime`。不要删除失败断言、把已确认缺陷改成 TODO，或仅修改期望值去适配错误输出。契约确需改变时，同时更新此表与测试，说明原因。

测试代码、确定性夹具和本说明作为版本控制资产保留；临时日志、截图、编译产物和 `.deps` 探针不承担唯一复现入口。
