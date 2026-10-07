# main 与 agent 分支分工

2026-10-07，暂停 AI 助手开发，将已提交的助手实现和验证记录保留在独立的 `agent` 分支。`main` 继续维护乱数工具、脚本执行、设备连接、OCR、音频、通知及图鉴功能。

## 整理方式

- `agent` 保留整理前的完整提交历史，整理时分支顶端为 `16322a0`。
- `main` 从首次 Agent 提交之前的 `1b1a7a7` 继续开发，不包含 AI 助手入口、本地语言模型管理、Agent 服务、MCP/Pi 依赖、助手测试或模型验证记录。
- 从之后的 64 个提交中分离 62 个 Agent 相关提交；其中两项普通功能改动重新应用到 `main`，不随 Agent 开发移走。

| 普通功能 | 原提交 | main 提交 |
| --- | --- | --- |
| 音频批量读取，采集与比对分离 | `0ae54a6` | `86d07ff` |
| 乱数成功后自动完成图鉴 | `13ed928` | `3b5b60b` |

图鉴提交重新应用时，仅保留普通乱数的目标确认、完成标记和测试，去掉混入的 Agent 交接及原生续跑条件。

另修正 `79ec1ce` 中三个已有 ECS 资源的指纹。旧指纹与 Git 保存的 LF 文件字节不符；已用固定上游版本及 `menu-navigation.patch` 生成的对应文件逐字节核对，更新为实际提交字节的 SHA-256，没有修改 ECS 行为。

## 后续开发

日常乱数功能在 `main` 开发。需要恢复助手研究时，先保存工作区修改，再执行 `git switch agent`；返回普通功能开发执行 `git switch main`。不要将整个 `agent` 分支合并到 `main`，否则会重新引入 AI 功能；共用的修复应单独审查并应用。

本次仅整理本地分支，没有推送或改写远端。整理前的四份未提交文档另行暂存并恢复，不纳入本次提交。本地模型数据与历史任务数据保留。

## 验证

- `npm run build`：通过。
- `npm run test:frlg:execution`：资源指纹通过，23 项通过；两个需要未提供脚本包的测试跳过。
- `node --test tests/frlg-audio-diagnostic.cjs`：3 项通过。
- `npx vitest run src/App.test.tsx --maxWorkers=1`：23 项通过。
- 火叶自动流程与首页两组界面测试：20 项通过。
- `node tests/run-electron.cjs frlg-pokedex-electron.cjs`：模拟设备联调通过，隐藏测试窗口，不操作实际游戏。
