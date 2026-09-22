# 复用来源

| 组件 | 固定版本 / 来源 | 使用范围 |
| --- | --- | --- |
| [OpenCV](https://github.com/opencv/opencv/tree/4.12.0) | 4.12.0，Apache-2.0 | 实际采集、像素转换、JPEG/PNG 编码；未自研视频驱动 |
| [cpp-httplib](https://github.com/yhirose/cpp-httplib/tree/v0.20.1) | 0.20.1，MIT | loopback HTTP、MJPEG 流与连接管理；未自研 HTTP 协议栈 |
| [nlohmann/json](https://github.com/nlohmann/json/tree/v3.12.0) | 3.12.0，MIT | JSON 编解码和参数检查 |
| [EasyCon](https://github.com/EasyConNS/EasyCon) | 用户提供的 auto-bdsp-rng/third_party/EasyCon 源码快照 | `SwitchReport.cs`、`NintendoSwitchPriv.cs`、`TTLSerialClient.cs` 对应的串口协议与 30ms 发送语义，GPL-3.0 |
| frlg-auto-rng | 提交 `4d2b7b50d64e83a3ae35456c29b6bf6f7fd6ee32`，`easycon/native` | 原有解释器、编译校验、图像标签匹配原样复用；逐文件 hash 见 vendor-manifest.json |
| auto-bdsp-rng / frlg-auto-rng Capture Broker | 用户提供的现有实现 | 单采集所有者、共享帧、MSMF transforms workaround、DirectShow 设置顺序、首帧/断流超时的行为参考 |
| Windows SDK | 系统依赖 | MF/DirectShow 设备枚举、COM、命名共享内存/互斥量、串口、父进程句柄 |

运行时新增适配代码及 EasyCon 派生部分按 GPL-3.0 提供，完整文本见 `LICENSE.GPL-3.0.txt`。第三方组件保留各自版权和许可证；发布二进制时需携带对应许可证与源代码信息。原有前端整体许可证由项目另行确定，不通过本文件改写。

源码快照无需旧项目在部署机器上存在。没有把本机另一个开发中的 SDK 当作已发布依赖。OpenCV 和头文件的下载 URL、校验值固定在构建脚本/CMake 中；Python 图像依赖固定在 requirements.txt。
