# 游戏音频采集

## 使用

启动重新构建后的桌面应用，打开侧栏的“视频源”，向下找到“游戏音频”，选择与 OBS 对应的采集卡音频输入，再点击“连接音频源”。设备列表只列出当前可用的 Windows 录音输入；不会默认选择第一个设备，也不会自动切换到默认麦克风。

连接成功后显示设备名、实际采样率、声道数和输入电平。电平为最近音频块的峰值 dBFS（显示范围 -60 至 0），不是扬声器音量。“已收到音频，当前静音”说明数据仍在连续到达。音频失败、设备移除或无新数据会显示失败状态；不会将断流显示为静音。

音频与视频独立连接、断开。关闭设置窗口不会停止采集，应用退出会释放资源。当前功能采集输入及显示电平，不提供扬声器监听、自动录音或闪光识别。

后端使用 Windows WASAPI 共享模式，读取所选录音端点，不捕获桌面混音。OBS 虚拟摄像头只提供画面，仍需单独选择采集卡的音频输入。若设备只通过特殊 DirectShow 采集图提供声音、未暴露 Windows 录音端点，本版本不会列出它；需要针对实卡增加兼容后端。Windows 的桌面应用麦克风访问权限也可能影响 USB 采集卡的录音端点。

## 数据接口

音频使用独立 `poke-runtime --role audio` 子进程，不受视频重连影响。`audio.list` 返回稳定端点 ID、名称和 `backend: "wasapi"`；`audio.start({deviceId})` 异步启动，只有收到第一块 PCM 后才发布 connected。`audio.stop` 释放设备并清空缓存，`audio.status` 获取当前状态。模拟音频 `synthetic` 仅在运行时 `--test-mode` 下可用，界面明确标注“模拟”。

Electron 的 `window.desktop.devices.audio` 提供 `list()`、`connect({deviceId})`、`disconnect()`、`onLevel(listener)`。`devices.getState().audio` 提供连接状态和读取描述符。设备控制 IPC 沿用主窗口/子窗口与主 frame 的来源校验。电平通知限约 10 次/秒，通过独立事件发送，不持续广播完整设备状态。

连接描述符包括：`status`、`deviceId`、`name`、`backend`、`session`、`sampleRate`、`channels`、`format: "f32le"`、`baseUrl`、`token`。采集保留端点原生采样率和声道数，将 PCM8/16/24/32 或 float32 转为交错 float32 小端 PCM。整数幅度按位深归一化；非有限浮点数置零，幅度限于 [-1,1]。不做重采样、降噪、自动增益或回声消除。

连续音频不经过 JSON/Base64 或界面 IPC。消费者通过描述符访问仅监听 `127.0.0.1` 的鉴权 HTTP 服务：

```text
GET {baseUrl}/audio?session={session}&after={sequence}&mode=next
Authorization: Bearer {token}
```

session 必填。`mode=next` 返回游标之后最早可用的块，`mode=latest` 或省略 mode 返回最新块；每个消费者保存自己的游标，读取不会移除其他消费者的数据。缓存按接收时间保留约 2 秒，同时限制最多 512 块、16 MiB；慢消费者继续读取时能通过 skipped 得知被淘汰的数据量。首次游标 0 的 skipped 为 0（没有先前读取基线），需要对准流程时间窗口的消费者应先读 latest，再按 next 连续读取。

响应是 `application/octet-stream`，每帧包含 channels 个 float32 样本，长度为 `frames × channels × 4`。元数据在响应头：

| Header（共同前缀 `X-Audio-`） | 含义 |
| --- | --- |
| `Session` / `Sequence` | 当前连接 UUID / 连续块序号；重连更换 session，序号从 1 开始 |
| `Timestamp-Ns` | 块首样本的 WASAPI QPC 时间，转换为纳秒；若设备报告时间戳无效，使用取得数据的主机时间 |
| `Received-Ns` | 主机发布该块的 QPC 时间，供缓存时效检查使用 |
| `Sample-Rate` / `Channels` / `Frames` / `Format` | 原生采样率 / 声道数 / 帧数 / `f32le` |
| `Skipped` | 相对本消费者上次游标跳过的块数；不等于丢失样本数 |
| `Discontinuity` | WASAPI 数据不连续标记；与消费者缓存落后是两种独立情况 |
| `Timestamp-Error` | 设备未提供可信的块时间戳 |
| `Silent` | WASAPI 标记的静音包；返回同长度的零样本，不能用它判断是否断流 |

等新数据最多 200 ms，期间无新块返回 204；停止/过期数据返回 503；session 不符返回 409；无效参数返回 400；无效鉴权返回 401。HEAD 用于 Electron 健康检查。采集线程 3 秒没有新包会失败；Electron 另外监视序号和读取超时，回收卡死的本应用音频子进程。连接总等待上限 15 秒，停止调用超时会回收该子进程。失败后不自动恢复录音或重放数据，需要重新连接。

Python 消费者使用标准库客户端 [audio.py](../runtime/clients/audio.py)：

```python
from audio import Audio

reader = Audio(audio_descriptor)  # 使用可信宿主传入的 state.audio
block = reader.read(next_block=False)  # 从当前时刻开始
while True:
    block = reader.read()
    if block is None:
        continue
    if block.skipped or block.discontinuity or block.timestamp_error:
        # 当前识别窗口不完整/时间不可靠，清空检测窗口或上报 unknown。
        continue
    # block.pcm 为独立 bytes；按 block.sample_rate、channels 和 frames 解读。
```

描述符由应用宿主传给消费者，不扫描端口或自行查找 token。后续音频识别与视频帧共享 QPC 时间基准，但硬件音视频延迟仍需实测校准。

## 验证

修改 C++ 后先执行 `npm run build:runtime`。

- `npm run test:runtime`：包含 C++ PCM8/16/24/32/float32 转换、静音缓冲、不可变块、多读者、缺块、停止唤醒和会话切换；Node 集成验证真实运行时协议及 Python 连续读取。
- `npm run test:audio`：音频原生/IPC 集成、启动和健康检查超时、旧会话回调隔离，以及设备选择、失败、静音和电平组件测试。
- `npm run test:audio:electron`：真实 Electron preload/IPC/渲染，验证独立连接、实时电平、窗口关闭继续采集、重开和断开；截图在 `node_modules/.tmp/audio-review/audio-connected.png`。

慢速读者曾在缓存过期块上持续得到 503，即使当前音频正常；已先用 3.2 秒暂停读取复现失败，再加入缓存时效淘汰修复，保留在 `tests/audio-integration.cjs`。修复后返回新块及 skipped，不静默忽略音频缺口。

自动化验证使用模拟音频，没有录制本机麦克风。本机未发现可确认的采集卡音频端点，因此实卡采集、拔插、与 OBS 并行使用、不同设备格式及长时间运行仍待硬件验收。
