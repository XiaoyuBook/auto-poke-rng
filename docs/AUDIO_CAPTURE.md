# 游戏音频采集

## 使用

启动重新构建后的桌面应用，打开侧栏的“视频源”，向下找到“游戏音频”，选择与 OBS 对应的采集卡音频输入，再点击“连接音频源”。设备列表只列出当前可用的 Windows 录音输入；不会默认选择第一个设备，也不会自动切换到默认麦克风。

连接成功后显示设备名、实际采样率、声道数和输入电平。电平为最近音频块的峰值 dBFS（显示范围 -60 至 0），不是扬声器音量。“已收到音频，当前静音”说明数据仍在连续到达。音频失败、设备移除或无新数据会显示失败状态；不会将断流显示为静音。

音频与视频独立连接、断开。关闭设置窗口不会停止采集，应用退出会释放资源。不提供扬声器监听或自动录音；火叶普通野生流程增加了仅输出日志的音频判闪实验，详见下节。

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

### 火叶普通野生音频判闪实验（2026-10-03）

重新启动应用、连接游戏音频源后，火叶自动流程会使用现有音频连接进行诊断。日志以 `【音频判闪·实验】` 开头，输出“检出闪光音效候选”“未检出闪光音效”或“无法判定”，并记录窗口编号、采样时长、峰值、原始参考匹配分数 `score` 和背景抑制参考分数 `enhanced_score`。不驱动抓捕、停止、录像、通知或 Seed 校准；原有图像判闪仍决定后续动作。未连接音频、静音、缺块、会话变化和时间戳不可靠均记为“无法判定”。

已核对的采样范围限定为 `lib/17_获取_野生目标.ecs` 的普通甜甜香气、碎岩和钓鱼。窗口分别从遭遇触发后原有的 `WAIT 10000`、`WAIT 8500`、`WAIT 5500` 开始，在调用 `识别抓捕对象名称优先OCR` **之前**关闭。普通流程随后才调用 `CheckCaptureShiny`，并按原有配置执行继续入场的 A 键。因此采样截止比图像判闪结束更早，排除后续我方闪光精灵入场的声音；即使分析日志稍后输出，也只分析截止时间内的样本。狩猎区、定点、御三家和孵蛋暂未接入音频窗口。

采样直接读取现有 WASAPI PCM，没有第二个音频设备所有者，也不保存遭遇录音。宿主使用每条语句的同步执行 trace 定位窗口，后台线程处理采集和比对，不根据界面约 100ms 的进度刷新推断边界。样本按 QPC 时间裁剪，包跨越截止时点时也舍弃截止后的部分；缓存/包缺失记为未知。硬件音视频延迟及游戏继续入场是否确实受该 A 键控制，仍需以实机画面和日志联合核对。

参考音效为用户提供的两份 0.772 秒、48kHz、双声道、16位 PCM WAV，保存在 `runtime/assets/frlg-audio/`。原始版保留背景音乐和原始音量，作为主要匹配依据；背景抑制版是试听/背景抑制试验，并非纯净闪光音效，仅记录对照分数，不单独触发候选判定。算法将音频线性重采样到 8kHz，比较短时频谱特征序列，原始参考得分 `>= 0.85` 输出候选。这是**尚未校准的实验阈值**，“未检出”不等于已证明非闪光，背景音乐、音量、音效混叠和采集延迟都需要实测；不会宣称已获得准确率。

上游同步时须重新核对普通野生函数的等待与名称识别位置。代码仅绑定唯一的已知等待、名称识别与后继判闪调用；结构变化时跳过该函数，不猜测位置。保持日志观察与 ECS 决策分离，后续如要让音频影响动作，必须另行验证检测效果和边界。

离线验证：`node --test tests/frlg-audio-diagnostic.cjs`，覆盖提供样本的匹配、音量/采样率变化、随机噪声、采样窗口跨包裁剪、我方闪光在截止后出现、缺块/静音/缺样本/会话失败，以及接入前后解释器按键和等待完全一致。上述属于算法与接入验证，未替代真实普通遭遇和真实闪光遭遇的验收。

### 音频采集回归

修改 C++ 后先执行 `npm run build:runtime`。

- `npm run test:runtime`：包含 C++ PCM8/16/24/32/float32 转换、静音缓冲、不可变块、多读者、缺块、停止唤醒和会话切换；Node 集成验证真实运行时协议及 Python 连续读取。
- `npm run test:audio`：音频原生/IPC 集成、启动和健康检查超时、旧会话回调隔离，以及设备选择、失败、静音和电平组件测试。
- `npm run test:audio:electron`：真实 Electron preload/IPC/渲染，验证独立连接、实时电平、窗口关闭继续采集、重开和断开；截图在 `node_modules/.tmp/audio-review/audio-connected.png`。

慢速读者曾在缓存过期块上持续得到 503，即使当前音频正常；已先用 3.2 秒暂停读取复现失败，再加入缓存时效淘汰修复，保留在 `tests/audio-integration.cjs`。修复后返回新块及 skipped，不静默忽略音频缺口。

自动化验证使用模拟音频，没有录制本机麦克风。本机未发现可确认的采集卡音频端点，因此实卡采集、拔插、与 OBS 并行使用、不同设备格式及长时间运行仍待硬件验收。
