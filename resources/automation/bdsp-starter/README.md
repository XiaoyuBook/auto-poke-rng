# 御三家内置脚本

`seed.ecs` 原样复制自固定版本的
`third_party/bdsp-automation-reference/script/御三家测种.txt`。
来源、固定提交和 GPL-3.0 许可证见该参考目录的 manifest、README 和 LICENSE.txt。

`reverse.ecs` 同步自官方脚本仓库的 `bdsp-starter-reverse` **0.0.5** 包，
对应 `bundles/bdsp-starter-reverse/files/御三家反查.txt`。该版采用用户于
2026-10-08 在本机脚本库保存的修订：摘要阶段使用方向键与默认 50ms 点击，
保留前段剧情时序，最后按 RIGHT。内置脚本与发布包逐字节一致，SHA-256 为
`0ffc05b35a37fdf8dcae749e8c81332b847ed6a79ead8b8772c35320af26c442`。
原版来源及 GPL-3.0-or-later 许可继续由脚本仓库包信息和 LICENSE.md 记录；
冻结参考目录保留原版内容，后续反查修订以脚本仓库发布包为准。

脚本由软件内置身份绑定，不依赖用户脚本库和文件名选择。对话、Timeline
及最终选择由软件运行时托管，不使用旧的御三家撞帧脚本。
