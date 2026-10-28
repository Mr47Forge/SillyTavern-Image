# 2026-10-28 退役接口与历史测试归档

这些文件为原样历史证据（后缀 .txt），不参与正式发布的自动测试，也不被打入运行的 JS 模块。不得因为未参与执行而宣称历史用例通过。

- chat-image-slots.legacy-20261028.js.txt：原大型集成文件约 117 KB，包含旧版 [img:...] 自动认领、手动触发与历史缓存行为。已有多个约定在当前产品被删除或改变，不应再用旧行为决定新代码正确性。有效的流式绘图隐藏、异步恢复、跨聊天删除、缓存失败、图位安全用例已迁入同名的现行测试文件，新增四图刷新与伪造图位测试。
- draw-run-coordinator.legacy-source.js.txt 和 draw-run-coordinator.legacy-tests.js.txt：退役的前端 Scene Planner 新任务提交链以及旧提交 API 测试。现行测试保留了历史标记清除、自动完成、超时判断的所有相关用例。
- draw-settings.legacy-source.js.txt 和 draw-settings.legacy-tests.js.txt：已无生产调用的旧 NovelDraw provider 设置合并入口与相应测试；现行测试验证仍在运行的共享设置保存，不复活旧 LLM 配置。

重要：这不是“原来 81 个大型历史测试全部通过”；旧测试已保留供追溯。正式套件现在自动发现所有 **当前接口** 的 .test.js/.test.mjs/.test.cjs。不要将旧文件改名放回默认套件，而不先校准其对当前运行链路的期望。

本次清理不得删除旧聊天中的任务标记、恢复数据、备份或服务器图片文件；没有触发后台任务或真实出图。
