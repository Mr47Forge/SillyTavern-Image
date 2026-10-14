# SillyTavern-Image

此仓库备份 H28K 上 SillyTavern + LittleWhiteBox（小白 X）与 Windows ComfyUI 的本地自定义代码、修改补丁、测试文件以及可公开的工作流配置模板。

**不包含**上游第三方完整项目、真实运行配置、聊天记录、角色照片、API 密钥、SSH 私钥或模型文件。本仓库为公开仓库。

## 目录

| 路径 | 用途 |
| --- | --- |
| custom-files/LittleWhiteBox/ | 自己新增的角色卡、中文外貌、剧情提示词及角色测试模块和回归测试 |
| custom-files/littlewhitebox-server/ | 服务器端自己新增的照片上传模块和集成测试 |
| patches/LittleWhiteBox-customizations.patch | 当前客户端相对原版 LittleWhiteBox 的修改 |
| patches/littlewhitebox-server-live-customizations.patch | 服务器插件当前运行代码相对插件内置版的修改 |
| workflows/ | Krea2 角色参考工作流及保留的旧工作流 |
| config/role-photo-workflow-preset.example.json | 新工作流的小白 X 预设模板，非个人配置 |
| metadata/ | 原版基线提交号和导出校验摘要 |

## 当前功能

酒馆剧情自动生图；角色中文外貌保存和转换；角色图片识别及测试；角色照片保存在 H28K 后在出图时自动传输给 ComfyUI；Krea2 参考生图，不做后期换脸；缺少角色照片时自动使用纯文字生成。现有版本仅支持为单个匹配角色引用身份照片，多位固定角色同框尚未完成身份一致性验证。

注意：自动裁脸插件实际运行报错，因此未启用。建议上传清楚的头肩照作为参考。手动按钮入口已部署，但浏览器端完整端到端测试尚未完成；照片参考和纯文字回退路径均已完成真实出图测试。

## 恢复方法

1. **先备份现有酒馆完整数据与代码。** 此仓库不是独立可运行的酒馆安装包。
2. 安装匹配版本的 LittleWhiteBox，原版提交号见 metadata/upstream-commit.txt。
3. 把 custom-files/LittleWhiteBox/ 中的文件按同名相对路径放进扩展目录。
4. 检查 patches/LittleWhiteBox-customizations.patch，先执行 git apply --check，确认版本匹配后再应用。
5. 服务器插件则先核对内置基线，再审查 patches/littlewhitebox-server-live-customizations.patch 和 custom-files/littlewhitebox-server/；切勿盲目覆盖新版本。
6. 使用 workflows/Krea2_角色照片自动匹配_API.json 和 config/role-photo-workflow-preset.example.json，在小白 X 新增可切换的工作流预设。占位符 __LWB_ROLE_PHOTO__ 由运行时动态替换，不能当作图片路径手填。
7. 测试保存角色照片、参考生图及无照片的回退路径后，再选择新预设投入使用。

## 已验证（2026-10-14）

- H28K 和 Windows ComfyUI 8188 API 连接成功。
- 正确匹配角色照片、上传照片到 ComfyUI、返回生图结果成功。
- 没有照片时普通文生图实际运行成功。
- 原来的三份工作流与当前选中预设未被替换。
- SillyTavern 服务正常。
- 自动裁脸暂未启用。

## 声明与隐私

本仓库保存的是第三方 LittleWhiteBox 的本地修改，不是该项目官方版本。上游代码与模型许可仍分别适用。禁止把个人角色照片、真实配置 LittleWhiteBox_ComfyDraw.json、访问密钥、聊天记录、私人地址等提交到公开仓库。