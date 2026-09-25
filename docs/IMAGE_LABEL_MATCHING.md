# 图像标签匹配契约

标签编辑器的非 OCR 搜索测试通过 `video:match-label` 调用 Python 的
`ImageLabel.search`，与脚本读取 `.IL` 的实现相同。测试帧由
`video:capture-frame` 获取，不更新用户的静态参考截图。

- 新建模板匹配使用方法 5（CCOEFF_NORMED），颜色匹配使用方法 3（CCORR_NORMED）。
- 旧标签保持原方法。方法 0、2、4 使用 EasyCon 原有数值分数，不标记为百分比，阈值允许超出 0–100；其余方法沿用运行时百分比分数。
- 原始分数与脚本值分开展示：脚本使用 `ceil(score)`。预览“通过”表示脚本值大于等于编辑器阈值。`.IL` 阈值为编辑器元数据，脚本仍由自身比较表达式决定是否执行按键。
- 加载标签后，修改阈值、范围或参考截图保留模板；重新选择目标区域才替换模板。

回归测试：`tests/video-labels.test.jsx`、`tests/script-files.test.js`、
`tests/device-regressions.cjs`、`runtime/tests/test_image_label_preview.py`。
Python 测试将相同样本写为 `.IL`，比较编辑器 worker 与脚本外部变量的分数、位置和向上取整结果，覆盖亮度偏移及旧版非归一化算法。
