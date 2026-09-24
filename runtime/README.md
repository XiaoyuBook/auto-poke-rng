# 公共设备运行时

Windows x64 / C++20，供所有游戏模块共享。采集使用 OpenCV 4.12.0 的 Media Foundation / DirectShow 实现，HTTP 使用 cpp-httplib 0.20.1，JSON 使用 nlohmann/json 3.12.0。源码、许可证与复用边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 构建和启动

需要 VS 2022 C++ Build Tools、Windows SDK、CMake 3.24+ 和 Python 3.12+。构建脚本会自动查找 PATH、VS 2022 Build Tools 和常见安装目录中的 CMake；Python 3.14 使用 requirements.txt 中单独固定的兼容轮子。在项目根目录执行：

```powershell
npm run setup:runtime
npm run dev
```

`setup:runtime` 下载固定版本的官方 OpenCV Windows SDK，检查 SHA-256，并构建 C++ 程序；脚本引擎依赖安装到本项目 `.deps/script-python`，不改动系统 Python 环境。默认优先使用 `py -3.12`，也可通过 `tools/setup-script-host.ps1 -Python <path>` 指定解释器。脚本会查找 PATH 和默认安装目录中的 7-Zip，未找到时使用校验后的 OpenCV 官方包自带的解压器，无需额外安装 7-Zip。CMake 下载的两个单头文件库同样校验固定 SHA-256。已有 OpenCV SDK 可以通过 `tools/build-runtime.ps1 -OpenCVDir <path>` 指定；CMake 不在 PATH 时可通过 `-CMake <path>` 指定。

可单独执行 `npm run build:runtime`。输出为 `runtime/bin/Release/poke-runtime.exe` 及同目录 OpenCV DLL。`AUTO_POKE_RUNTIME` 可指定运行时路径，`AUTO_POKE_PYTHON` 可指定脚本解释器；默认使用本项目虚拟环境，缺失时尝试 PATH 中的 Python。构建产物和依赖不入库。

## 进程与所有权

- Electron 主进程负责设备生命周期、调用授权、状态广播和超时回收。窗口只调用 preload 暴露的方法。
- 同一个 C++ 可执行文件分别以 `--role video` 和 `--role controller` 运行。摄像头驱动挂死不会连带杀掉串口进程。控制消息使用继承的 stdin/stdout 管道，不额外暴露 TCP 控制接口。
- 采集线程是唯一 `VideoCapture` 所有者。Windows 命名互斥量阻止本软件两个实例同时采集；旧版软件和 OBS 等其他程序的占用由驱动打开结果报告。
- 串口以 Windows 独占方式打开，遵循原版 `A5 A5 81 → 80` 握手、115200/9600 波特率尝试、Switch 报告编码和最短 30ms 报告间隔。脚本完成和停止均释放按键，串口保持连接。只有显式断开/进程退出才关闭它。
- 脚本获取独占控制租约；手动按键、摇杆与另一个脚本不能插入当前脚本。停止会取消剩余动作，不会继续发送排队中的按键。
- 正常退出先停止脚本、发送中立报告并关闭设备。主进程异常死亡时，子进程观察已打开的父进程句柄；控制器尽力释放后退出。设备已拔出或驱动卡死时，不能保证固件收到释放报告。
- 打开采集卡最长等待 20 秒；无新帧会失败，独立的 Electron 健康检查也会回收卡在驱动读取里的进程。断开请求超时只回收本应用持有的子进程。不会自动重放脚本或重连后继续发送旧输入。

## 多消费者视频

每帧包含采集会话 UUID、递增序号、QPC 单调时间戳、宽高、stride 和 BGR24 像素。时间戳表示主机取得画面的时间，不是采集卡传感器时钟。驱动报告帧率与请求帧率分开，不承诺硬实时。

进程内 `FrameHub` 保存最多 8 帧，按分辨率限制为最多约 128 MiB 环形缓存。每次发布复制 OpenCV 的可复用缓冲；消费者持有不可变帧引用，读取不会消耗帧。每个消费者自行保存 cursor，支持 latest 和 next；落后超过容量会得到 `skipped`，需要连续观察的算法必须据此重测或报错。系统不承诺慢消费者永不丢帧，也不提供无限录像队列。

跨进程有两个读取出口：

1. **共享内存**：8 槽以内的原始 BGR24 帧；通过命名 mutex 保护完整复制。写者只尝试加锁、不等待慢读者；冲突可能跳过该次共享内存发布，序号缺口可见。每个消费者复制到自己的字节缓冲后立即释放 mutex。Python 标准库客户端见 `clients/frames.py`。这是一条有界复制通道，不声称零拷贝。
2. **本机 HTTP 二进制帧**：`/frame?after=N&mode=next&session=UUID`，或默认 latest。不使用 JSON/Base64 传连续帧。最多等 200ms；无更新返回 204、视频不可用/帧超过 1 秒返回 503、会话变化返回 409。序号、缺帧数和尺寸在 `X-Frame-*` 响应头。

预览线程从同一个 FrameHub 读取最新帧，最长边 960 像素的 JPEG 每帧只编码一次，再分发给窗口。`/preview?token=…&session=…` 为 MJPEG，最多同时 6 个预览连接，慢窗口只跳过预览帧。原始识别帧不被缩放。`/snapshot.png` 返回原始分辨率 PNG；截图在 Electron 中保存一份，弹出/收回窗口不丢失，断开视频也不会篡改已经截取的帧。

HTTP 只监听 `127.0.0.1` 随机端口，要求当前运行时 token。程序通过受控管道获得端口/token，第三方算法进程不应自行扫描端口。公共状态中提供共享内存 descriptor，重新连接后必须重建读者。

## 协议与扩展

每行一个 UTF-8 JSON 对象，版本为 1；stdout 只用于协议，诊断写 stderr。

```json
{"version":1,"id":1,"method":"video.list","params":{"backend":"msmf"}}
{"id":1,"ok":true,"result":[{"id":"设备稳定路径","index":0,"name":"采集卡","backend":"msmf"}]}
{"event":"video.state","state":{"status":"connecting"}}
```

失败格式：`{"id":1,"ok":false,"error":{"code":"DEVICE_BUSY","message":"…"}}`。连接成功只在首帧/串口握手后发出，提交操作不等于成功。控制器序列返回 operation ID，完成由 `controller.action.done` 通知。

| 范围 | 方法 |
| --- | --- |
| 视频 | `video.list / start / stop / status` |
| 控制器 | `controller.list / connect / disconnect / status` |
| 手柄 | `controller.key / stick / reset / stop` |
| 脚本独占权 | `controller.acquire / release`，后续请求携带 owner |
| 本地定时动作 | `controller.sequence`，button、stick、wait 数组 |
| 进程 | `shutdown` |

以后 FRLG/BDSP 插件只获得控制客户端和 frame descriptor，不再打开串口或采集卡。当前只接入公共设备和脚本功能，没有迁移两个项目的游戏 RNG 流程。

## 脚本复用

`python/easycon/native` 直接保存 FRLG 项目现有解释器和图像标签实现的源码快照，未重写语法；来源提交与逐文件 SHA-256 在 `python/vendor-manifest.json`。`python/script_host.py` 是适配层：编译、校验资源后获取控制租约；将按键和等待交给 C++，通过共享内存读取 OCR 和 `.IL` 搜图所需帧。运行脚本不要求视频连接，只有搜图或 OCR 语句需要视频源。

支持原版循环、条件、变量、函数、`lib/*.ecs`、按键/摇杆语句和 `ImgLabel/*.IL` 图像匹配。新页面已有 `.rng` 文件中 `press A` 是按键别名，转换成原版 `A 50` 后执行，行号保持不变。不根据左上角游戏环境修改脚本行为。

脚本宿主提供仅编译的 `validate` 模式，返回首个错误的文件、行列和原因；不会申请手柄控制权、读取视频或执行代码。编辑器检查支持取消过期请求，同一时间仅保留最新检查。执行时复用解释器的 `ExecutionTrace`，独立采样线程每 100ms 发布最新 `script.progress`，携带执行源码行、动作、调用点和循环次数；快速循环不会逐行堆积 IPC，终止前会刷新最后位置并关闭采样线程。

脚本支持 `OCR(x, y, w, h, lang)`，使用 PP-OCRv6 small + RapidOCR 3.9.2 + ONNX Runtime CPU；`lang` 支持 `zh-Hans`、`zh-Hant`、`en` 和 `ja`，调用会读取当前共享视频帧并返回文本。`.IL` 的 `TESSER_DETECT` 标签复用同一模型。`setup:runtime` 会下载并校验固定 SHA-256 的模型文件。Amiibo 命令仍会在发按键前明确拒绝；UI 的录制、圈选、标签保存和识别测试仍属于后续功能。没有增加另一套完整脚本语言，也没有引用两个旧项目的绝对路径。

## 验证

```powershell
npm run test:runtime
npm run test:devices:regression
npm test
npm run test:devices
npm run test:electron
```

`test:runtime` 包含公共设备审查回归，`test:devices:regression` 可单独运行这些用例。编号、前提、正确行为和覆盖边界见 [公共设备回归资产](../docs/DEVICE_REGRESSIONS.md)，运行环境见 [测试说明](../tests/README.md)。当前 DEV-001 至 DEV-005 尚未修复，因此包含它们的测试会明确失败；视频断连后的任务策略单独保留为 TODO。

`--test-mode` 才允许 synthetic/mock；普通构建运行不会把模拟设备当作真设备。测试覆盖多消费者、跨 Python/C++ 共享内存、原版 `.IL` 搜图端到端、缺帧、会话切换、设备占用、包编码、函数导入、连续脚本、运行错误后的按键释放、取消、独占控制、设备进程退出、Electron 实际接线与旧布局回归。界面验证截图保存在 `node_modules/.tmp/device-review`。

测试通过不等于实机验收。仍需用目标采集卡/固件验证协商分辨率和实际帧率、不同后端、拔插、长时间运行、输入时序与释放行为。当前未制作安装包。
