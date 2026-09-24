# QQ 通知

左上角铃铛打开通知设置。当前实现独立的 QQ 通知能力及手动图文测试，尚未接入脚本异常、`ALERT`、设备事件或任何自动流程，也没有自动通知开关。运行脚本不会因本功能产生 QQ 消息。

## 配置与验证

1. 在 [QQ 开放平台](https://q.qq.com/#/apps) 注册并创建机器人，或选择已有机器人。开发设置中取得 AppID、AppSecret，确认事件接收方式为 WebSocket；服务范围／开发体验号码需要允许目标用户或群使用机器人。
2. 在“接入设置”填写凭据，点击“保存设置”，再“验证凭据”。已有密钥不会回传到界面，留空表示保留；输入新值可替换，使用“清除密钥”可移除保存和内存中的凭据。
3. 点击“绑定私聊”，向机器人发送当前六位绑定码。群聊需先将机器人加入目标群，再点击“绑定群聊”，在群内 @机器人并发送当前码。每 60 秒自动换码，旧码立即失效。仅匹配当前验证码和对应消息类型的事件会被绑定。
4. 可同时勾选一个私聊和一个群聊。保存的是 QQ 平台 OpenID，不是 QQ 号或群号；更换 AppID 会清除旧接收方，没有输入新密钥时也会清除原密钥。
5. 点击“发送图文测试”，软件发送测试文字和内置精灵球测试图。请在 QQ 中确认两者均收到，再点击“我已收到文字和图片”。发送文字成功、图片失败时不算图文测试通过。

“注册与绑定说明”包含从注册账号到复制密钥的 12 步原始截图、点击区域标记和逐步操作提示，图片随软件打包，可离线阅读。点击图片可查看完整原图，支持放大、缩小、适应窗口和原始尺寸；按 Esc 只关闭原图，保留教程窗口与接入草稿。已有机器人可直接跳到第 9 步开发设置。

关闭通知窗口或离开接入页时取消正在进行的绑定并关闭 WebSocket；日常发送只使用 HTTP，不维持网关连接。退出软件会取消尚在进行的网络操作。

## 保存与发送记录

配置位于 Electron 的 `app.getPath('userData')/qq-notifications.json`，Windows 默认通常为 `%APPDATA%\auto-poke-rng\qq-notifications.json`。

AppSecret 默认仅保留在当前主进程内存中。勾选“记住密钥”后，使用 Electron `safeStorage`（Windows DPAPI）加密保存；系统无法加密时拒绝保存，不降级为明文。取消记住后删除文件内的密钥密文，当前会话仍可使用；清除密钥则同时清空当前会话值。访问令牌不写入文件，也不经状态 IPC 回传。保存失败不会替换原有配置。

发送记录保留本次打开期间最近 100 条，按私聊／群聊分别记录文字、图片的提交状态。失败、超时、取消都不自动重发；部分已提交的消息不能撤回。记录中的“已提交”指 QQ 接口返回成功，不代表接收方已经读到消息。“失败／未确认”需要结合错误详情和 QQ 实际收件情况判断。

铃铛状态点：验证且接收方完整时绿色，操作中黄色，需要检查错误时红色，尚未配置／待验证／待绑定时无圆点。重新启动后需要重新验证凭据才能显示可发送状态，绑定信息会保留。

## 后续自动流程接入

- `electron/qq-client.cjs`：访问令牌、HTTP 请求、网关绑定、图片分片上传和图文发送。
- `electron/qq-notifications.cjs`：配置持久化、独立通知服务、发送记录和受限 IPC。
- `src/components/QQNotifications.tsx`：接入设置、图文测试、记录及离线说明。
- `src/components/QQGuide.tsx`、`src/qqGuide.ts`、`src/assets/qq-guide/`：分步图文教程、原图缩放和本地图片资源。

后续在 Electron 主进程中调用 `QQNotificationService.send({ event, text, image })`；`event` 为记录名称，`text` 最多 2000 字，`image` 为可选的 JPEG Buffer（不超过 10 MB）。方法返回最新服务状态，发送结果在 `records` 和 `error` 中。当前同一时间只执行一个操作，忙碌时调用会被拒绝；未来业务需要在接入时定义事件、截图取得时机、排队、去重和频率限制。任意业务发送未暴露给渲染层，现阶段只开放显式图文测试 IPC。

## 验证与来源

运行 `npm run test:qq` 和 `npm run test:qq:electron`。测试使用本地 HTTP／WebSocket 模拟 QQ 接口，覆盖实际网络协议、图文分片、错误与取消、密钥保存以及桌面交互，不替代真实机器人账号的收件验证。

QQ 客户端与通知服务参考 [auto-bdsp-rng](https://github.com/XiaoyuBook/auto-bdsp-rng) 的 `src/auto_bdsp_rng/notifications/qq_client.py`、`qq_service.py`，由 Python／Qt 适配为 Electron／Node。其协议实现参考 BetterGI 的 `QqNotifier`、`QqWebSocketHelper`，提交 `f29966868c6e2d5b8798bb6a4f3df201ec4a5f95`。相关适配文件按 GPL-3.0-or-later 提供，许可证正文见 [GPL-3.0](../runtime/LICENSE.GPL-3.0.txt)。WebSocket 依赖 `ws` 使用 MIT 许可证。

教程原图及步骤信息来自 auto-bdsp-rng 的 `docs/assets/guide-qq/`，保留原图，不要求运行时访问参考项目目录；文字中与旧软件头像相关的说明已适配当前软件。
