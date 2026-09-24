# 公共 OCR 模型选型

评测日期：2026-09-23。模型已接入脚本 OCR 和 `.IL` 的 `TESSER_DETECT` 标签；应用界面仍未提供 OCR 圈选、标签编辑或识别预览。

## 决定

选择 **PP-OCRv6 small 检测模型 + small 识别模型**，以 **ONNX Runtime CPU** 为默认推理后端，RapidOCR 3.9.2 作为适配器。RapidOCR 是调用与前后处理工具，实际选中的模型是 PP-OCRv6 small。

这一组合用同一识别器覆盖简中、繁中、英文、日文，检测与识别权重合计 31,163,977 字节，约 29.7 MiB。许可证为 Apache-2.0。确切下载地址、版本和 SHA-256 见 [ocr-model-selection.json](ocr-model-selection.json)。不用旧项目的模型配置作为选择依据。

PP-OCRv6 medium + OpenVINO 保留为后续精度备选，当前不默认安装第二套模型。实测 medium 的额外收益不足以抵消模型体积、加载和重复识别的成本；有新的真实游戏证据时可以重新选择。small 在本机切换 OpenVINO 后收益较小，因此不为默认方案增加一个推理后端。

## 接入边界

脚本内置函数 `OCR(x, y, w, h, lang)` 从当前共享视频帧复制指定 ROI，返回置信度至少为 0.5 的识别文本；`lang` 接受 `zh-Hans`、`zh-Hant`、`en`、`ja` 及常用别名。PP-OCRv6 small 是统一多语言权重，语言参数用于校验调用意图，不会按调用创建第二套模型。ROI 必须是正整数并完全位于当前帧内；RapidOCR/ONNX Runtime 初始化和首帧检查都在取得控制权前完成，没有模型或视频帧时不会发送脚本按键。输出保留通过过滤的原始行首尾空白，只过滤全空白行。

`.IL` 的 `TESSER_DETECT` 标签复用同一个识别器和置信度过滤。模型权重不入库，由 `npm run setup:runtime` 下载到 `.deps/ocr-models` 并按清单校验；脚本宿主提前导入 OCR 原生依赖，避免 Windows 下首次导入与 stdin 线程互锁。

## 选择目标与候选范围

按 Windows 桌面应用的公共能力评估：不要求独立显卡，安装完成后离线识别，适合重复读取小区域；优先兼顾中日文字、数字、稳定空输出、文字框、耗时和可再分发性。没有将文档解析排行榜直接当成游戏 OCR 准确率。

| 候选 | 本次处理 | 取舍 |
| --- | --- | --- |
| PP-OCRv6 small | ONNX Runtime / OpenVINO 实测，含多行检测 | 默认选择；统一多语言、速度与效果较均衡 |
| PP-OCRv6 medium | 两种 CPU 后端实测 | 精度备选；挑战集只比 small 多正确 1 条，OpenVINO 单行耗时约 4 倍 |
| PP-OCRv6 tiny | 实测并核对词表与官方说明 | 不合格：**tiny 不支持日文**；不能把整个 v6 系列的 50 语言宣传套在 tiny 上 |
| PP-OCRv5 mobile | 同条件实测 | 更小，但困难样本与无文字背景表现落后 |
| PP-OCRv5 server 识别器 | 两种 CPU 后端实测 | 基础样本未比 small 更好，CPU 开销明显更大 |
| PP-OCRv4 日文专用识别器 | 日文挑战样本实测 | 日文 14/32，未超过 small 的 22/32；不增加专用模型路由 |
| Tesseract LSTM best_int | Tesseract.js 7.0.0 实测，预先提供正确语言 | 中文、日文小字及描边条件表现落后；无单一中日统一模型 |
| EasyOCR 1.7.2 | 独立 PyTorch CPU 实测，预先提供正确语言 | 中简、中繁、日文分别需要识别器；本次效果与部署体积不适合默认基底 |
| Manga OCR | 官方资料与模型卡筛选，未跑性能测试 | 日文印刷字/漫画专用，不能单独承担中英公共基底；官方明确说明无文字图片也会尝试生成文字 |
| Surya | 官方部署及权重许可证筛选，未跑性能测试 | 当前方案需要 VLM 服务；权重使用带商业条件的修改版 OpenRAIL-M，适配成本不适合这次公共桌面基底 |
| PaddleOCR-VL / 通用 VLM | 官方适用场景筛选，未跑性能测试 | 面向文档、表格与结构化解析；没有本地证据支持用它们替代频繁的小 ROI 识别，不虚构速度或准确率 |

“未跑性能测试”表示按能力边界和部署要求筛选，并不代表其识别效果更差。EasyOCR、Tesseract 得到了正确的简繁/日文语言提示；PP-OCR 则始终使用同一多语言识别器，没有按答案切换模型。

## 实测方法

机器：Windows、i7-11800H（8 核 / 16 线程）、16 GiB 内存。PP-OCR 与 EasyOCR 均使用 CPU，推理线程设为 2；Tesseract.js 使用单个 WASM worker。没有使用本机 NVIDIA GPU。Python 3.12.10、RapidOCR 3.9.2、ONNX Runtime 1.30.0、OpenVINO 2026.2.1。

数据由 Windows 字体生成，包含宝可梦名称、性格/特性、确认提示、等级、HP、数字等。**这些是合成裁剪，不是真实游戏截图，也不是独立公开测试集。** 同一句话的多个字体/条件相关，不能把样本数当作独立游戏场景数。没有用这些结果训练模型或调整某一个模型的答案。

- `screen`：16 条文本 × 4 条件 = 64 条，加 2 张纯色空白；24px 浅底、18px 深底、12px 小字、轻模糊/JPEG。
- `challenge`：另外 32 条文本 × 4 条件 = 128 条，加 2 张纯色空白；替代字体、描边、12px 最近邻像素放大、低对比度。不是主机游戏原生像素字体。
- `layout`：12 张 640×220 的三行文字图片，加 6 张无字图片（纯色、形状背景、模糊形状背景），检验检测、行排序与误报。

字体、生成图片 SHA-256、全部期望值、逐项识别文本、置信度、耗时和模型哈希保存在 [ocr-benchmark-results.json](ocr-benchmark-results.json)。模型文件和生成图片留在忽略的 `.deps/ocr-eval/`；不把模型权重或 Windows 字体提交进仓库。

对照约定：

1. 所有候选使用同一批图片；高不足 64px 的单行图统一先按 cubic 放大 2 倍。已知单行模式跳过检测器，不将单行速度冒充整帧 OCR 速度。
2. PP-OCR / EasyOCR 从预加载图像计时；Tesseract.js 计时包含其文件读取/解码和 worker 通信，所以其耗时不能解读为原生 Tesseract 引擎纯推理速度。
3. 每个模型先预热一次，每张图执行两次，保存两次耗时的中位数。表中 p50/p95 是这些样本值的分位数，**不是长时间生产负载的延迟 SLA**。PP-OCR 冷加载只计模型适配器构造，不含 Python 启动、导入和下载；EasyOCR 的初始化字段注明包含下载，不与它混比。EasyOCR 使用默认 greedy 解码及动态量化。
4. 正确条数以 NFKC + 去空白后整条一致计算，字符错误率 CER 同样规范化；不删除其他标点、不纠正读错的汉字。原始逐字一致数量另保存在 JSON。应用接口未来应保留原文，不能默认抹掉空格。
5. 展示结果的置信度门槛统一为 0.5（Tesseract 为 50）。不同模型的分数未校准，不能比较分数高低来认定谁更可靠；单行模式的原始低分输出保留在新格式记录中，汇总器也计算未按置信度过滤的指标。检测模式保存的是 SDK 过滤后的结果。
6. 检测评测显式使用官方 `inference.yml` 的 mean/std 与各代 DB 阈值。使用 `limit_type=max` 避免小 ROI 被默认的短边 736 放大成数千像素宽；接入运行时将输入最长边限制为 960px。
7. 方向分类关闭；RapidOCR 3.9.2 构造时仍加载一个 0.56 MiB 的 v4 分类权重，此依赖单独记在选型清单，未作为检测或识别模型运行。

记录中的文字框对应 `inputSha256` 标识的预处理图片。后续应用若放大 ROI，需要把文字框坐标映射回原始画面。

## 结果

基础集，64 条有字图片；空白不混入正确率分母：

| 识别器 / CPU 后端 | 正确条数 | CER | 单行 p50 / p95 |
| --- | ---: | ---: | ---: |
| v6 small / ONNX Runtime | 63/64 | 0.14% | 21.5 / 31.6 ms |
| v6 small / OpenVINO | 63/64 | 0.14% | 18.0 / 32.1 ms |
| v6 medium / ONNX Runtime | 63/64 | 0.14% | 606.5 / 925.6 ms |
| v6 medium / OpenVINO | 63/64 | 0.14% | 77.9 / 118.6 ms |
| v5 mobile / ONNX Runtime | 62/64 | 0.27% | 22.3 / 36.4 ms |
| v5 server / ONNX Runtime | 63/64 | 0.14% | 1315.5 / 1789.5 ms |
| v5 server / OpenVINO | 63/64 | 0.14% | 344.0 / 499.9 ms |
| v6 tiny / ONNX Runtime | 47/64 | 20.90% | 5.4 / 7.7 ms |
| Tesseract.js 7 / LSTM best_int | 54/64 | 1.91% | 44.9 / 92.1 ms |
| EasyOCR 1.7.2 / PyTorch CPU | 42/64 | 12.43% | 42.4 / 470.8 ms |

tiny 日文 0/16；核对词表可见其缺少样本中的假名，官方算法文档也明确写出 tiny 的 49 语言不含日文。v5 mobile 单行模式在 2 张纯色空白中有 1 张误报，其他上表模型在这 2 张中没有误报。

挑战集，128 条有字图片：

| 识别器 / CPU 后端 | 正确条数 | CER | 单行 p50 / p95 |
| --- | ---: | ---: | ---: |
| **v6 small / ONNX Runtime** | **117/128** | **1.03%** | **21.9 / 28.4 ms** |
| v6 small / OpenVINO | 117/128 | 1.03% | 21.1 / 33.0 ms |
| v6 medium / OpenVINO | 118/128 | 0.75% | 85.1 / 111.5 ms |
| v5 mobile / ONNX Runtime | 106/128 | 1.85% | 22.8 / 32.7 ms |
| Tesseract.js 7 / LSTM best_int | 79/128 | 19.73% | 47.0 / 93.7 ms |
| EasyOCR 1.7.2 / PyTorch CPU | 59/128 | 27.88% | 44.3 / 533.9 ms |

small 的分项为中文（含繁体）31/32、日文 22/32、英文 32/32、数字 32/32。medium 对应 30/32、24/32、32/32、32/32。medium 并不是所有输入都更好。本机测试不能推导出其他硬件上同样的延迟倍数。

置信度过滤对 EasyOCR 的 CER 影响很大：完全不做置信度过滤时，挑战集为 66/128、CER 7.47%，仍低于 small；不能把表中的 27.88% 全解释为逐字认错。Tesseract 不过滤时是 79/128、CER 12.26%。EasyOCR 中文 p95 还受繁体旧识别器影响，不能把整体 p95 套在日文识别器上。此次四个 EasyOCR 识别权重合计约 267.5 MiB，其中繁体模型约 215.6 MiB，均不含 PyTorch 和检测器。

加入检测后，small 在挑战集为 114/128，p50 45.7ms、p95 91.1ms；v5 mobile 为 103/128，49.8/83.8ms。已知文字行优先直接识别，避免检测裁剪引入额外错误。

三行布局测试中，两者都是 12/12 张规范化文本正确。small 在有字图片上的 p50 为 172.7ms、p95 为 214.6ms，在 6 张无字图片中误报 0 张；v5 mobile 为 152.8/193.9ms，误报 3 张。这支持选 small，但 6 张负例远不足以证明不会误报。

## 日文与游戏场景的实际限制

small 确实具备日文能力，但不能把“支持日文”理解为“日文完全正确”。挑战集中出现：

- `プレッシャー` 的小字被识别成 `ブレッシャー`，浊音/半浊音需要真实游戏字体验证。
- `おくびょう／のんき` 的斜杠多次被识别成片假名 `ノ`。
- `♂`、`♀` 丢失或被当成其他字符。性别、闪光等游戏图标优先单独做模板/图标识别，不依靠通用文字 OCR 猜测。
- 字词间空格可能变化。当前表的规范化正确率高于原文逐字一致率，应按业务字段明确是否允许规范化。

竖排日文、旋转、动画过渡、采集卡压缩、宝可梦实际像素字体及大范围整帧 OCR 尚未验收。接入自动流程前，应采集简中/繁中/日文真实帧，按游戏/分辨率标注固定 ROI，并单独统计数字误读、假名混淆、无字误报和低置信度拒绝。置信度不是正确概率，不能仅凭高分自动接受。

这次确定了工程基底；真实游戏准确率尚无证据，不用合成数据冒充。

## 复现

在仓库根目录用 PowerShell 创建隔离环境，应用的 `runtime/python/requirements.txt` 不变：

```powershell
python -m venv .deps/ocr-eval/python
.deps/ocr-eval/python/Scripts/python.exe -m pip install -r tools/ocr-eval-requirements.txt
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v5-mobile v6-tiny v6-small v5-server v6-medium
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v6-small v6-medium v5-server --backend openvino
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v5-mobile v6-small v4-japan --suite challenge
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v6-small v6-medium --suite challenge --backend openvino
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v5-mobile v6-small --suite challenge --auto
.deps/ocr-eval/python/Scripts/python.exe tools/benchmark-ocr.py --models v5-mobile v6-small --suite layout --auto
npm install --prefix .deps/ocr-eval tesseract.js@7.0.0
node tools/benchmark-tesseract.cjs screen
node tools/benchmark-tesseract.cjs challenge
.deps/ocr-eval/python/Scripts/python.exe tools/summarize-ocr.py --export
```

评测按顺序运行，不同时跑多个模型争抢 CPU。首次会下载并校验 PP-OCR 权重；Tesseract 的 best_int 语言数据由其官方 JS 分发方式下载，结果中记录了实际 SHA-256。第一次测试的 v5 server / v6 medium ONNX 单行数据保留在旧格式结果路径，汇总工具可以读取；这些单行输入、解码和线程配置与当前脚本相同。

本机字体版本会影响图片；汇总器检查同一套比较中的期望值和输入哈希。在别的机器复现时应核对字体哈希，不要求耗时和结果逐项完全相同。这里没有把 Windows 字体重新分发。

EasyOCR 的独立环境与复现脚本为 `tools/benchmark-easyocr.py`。它和 RapidOCR 对 OpenCV 包的依赖名称不同，因此使用另一环境，避免两个 `cv2` 分发覆盖同一目录：

```powershell
python -m venv .deps/ocr-eval/easy-python
.deps/ocr-eval/easy-python/Scripts/python.exe -m pip install --upgrade pip
.deps/ocr-eval/easy-python/Scripts/python.exe -m pip install torch==2.8.0 torchvision==0.23.0 easyocr==1.7.2 numpy==2.2.6 opencv-python-headless==4.12.0.88 Pillow==12.3.0
.deps/ocr-eval/easy-python/Scripts/python.exe tools/benchmark-easyocr.py --suite screen
.deps/ocr-eval/easy-python/Scripts/python.exe tools/benchmark-easyocr.py --suite challenge
.deps/ocr-eval/python/Scripts/python.exe tools/summarize-ocr.py --export
```

## 官方来源

- [PP-OCRv6 算法与各档语言范围](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.en.md)：tiny 明确不含日文；官方性能数字与本机数据分开使用。
- [small 识别模型卡](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx)、[small 检测模型卡](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx)：模型及 Apache-2.0 元信息。
- [RapidOCR 3.9.2 固定模型目录](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml)：ONNX 权重来源与 SHA-256；[RapidOCR](https://github.com/RapidAI/RapidOCR)、[ONNX Runtime](https://github.com/microsoft/onnxruntime)、[OpenVINO](https://github.com/openvinotoolkit/openvino) 分别使用 Apache-2.0、MIT、Apache-2.0。
- [EasyOCR](https://github.com/JaidedAI/EasyOCR)：Apache-2.0，Windows 依赖 PyTorch，语言组合有限制。
- [Tesseract.js](https://github.com/naptha/tesseract.js) 与 [Tesseract](https://github.com/tesseract-ocr/tesseract)：Apache-2.0；比较的是标明版本的 LSTM 语言数据与 JS 部署方式。
- [Manga OCR](https://github.com/kha-white/manga-ocr)、[模型卡](https://huggingface.co/kha-white/manga-ocr-base)：日文专用，Apache-2.0，官方列明无字图仍输出文字的限制。
- [Surya](https://github.com/datalab-to/surya)：代码 Apache-2.0 不等于权重同许可证，权重商业条件单独核对。
- [PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL)：文档解析候选，仅作能力与部署筛选。
