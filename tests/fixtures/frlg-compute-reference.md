# FRLG 计算对照数据

`frlg-compute-reference.json` 来自原版 `frlg-auto-rng` 提交 `5a5383ff226059cbf85f0b531c9de283f7b76c45`，在本项目优化前生成。它保存 467 组计算的结果数量及完整结果的 SHA-256；字典键排序后序列化，但保留列表顺序，因此同一批结果重新排序也会失败。错误类型与消息一并记录。

覆盖 Static/Wild 1、2、4、六种野生遭遇、混合物种/性别比、闪光通配与三类闪光筛选、性格/特性/隐藏力量/槽位、游走缺陷、所有初始 Seed、IV 档位枚举，以及八个版本/平台组合的 Seed 路线和模式选择。

在核实参考仓库为上述提交且工作区干净后生成：

```powershell
.deps/script-python/Scripts/python.exe tests/frlg-compute-cases.py --source-root D:/project/frlg-auto-rng --output tests/fixtures/frlg-compute-reference.json
```

参考路径仅用于开发对照。`npm run test:rng` 使用本文件和内置运行时，不读取参考项目；不要为了让优化后的测试通过而用优化实现重新生成期望数据。`frlg-compute-regressions.py` 另有全部 65536 个索引的独立距离校验、穷举 IV 计数、取消/工作量边界、精确 Seed 重复项/偏移/数据替换测试，以及计算工作量回归断言。
