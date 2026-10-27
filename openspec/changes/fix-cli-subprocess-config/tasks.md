# 任务

- [x] 1. 在 cli-process.ts 中加临时调试日志，打印子进程实际读到的 global.config 路径与配置文件存在性
- [x] 2. 推送调试 commit，查 CI 日志确认根因
- [x] 3. 根据根因实施修复（OPENNOVEL_CONFIG_DIR 钉住，见 design.md）
- [x] 4. 本地验证 cli 子进程测试通过
- [x] 5. 移除全部调试日志，单独提交验证
- [ ] 6. 推送，确认 CI 中 export/run/stats × 4 全部通过
- [ ] 7. 收集实施提交，更新 tasks.md，归档提案

## 根因

Linux CI 上 cli 子进程读不到 test provider 配置（未进入 CatalogV2），
模型解析失败。两种表象同源：

- 回退到内置默认 vivgrid/gpt-5.6-luna → 请求 401，助手行带 error
- catalog 全空 → runner 解析抛错 → drain 静默结束 → 退出 0、零输出

修复：`isolatedEnv` 显式设 `OPENNOVEL_CONFIG_DIR`（动态 env getter，
优先级高于 xdg-basedir 模块级缓存），待 CI 验证。

## 排查教训（沉淀）

1. 子进程测试的调试探针**不能写 stdout**（`--format json` 逐行解析会炸），
   也**不能在 core 模块顶层写 stderr**（effect-flock、help-text snapshots
   断言子进程 stderr 为空）。探针一律写文件。
2. 「本地通过 + CI 失败」时，先用无调试的基线 run 确认失败形态，再对比
   调试 run 的形态变化——调试探针自身会改变失败形态，容易误判根因。

## 实施提交

（待 CI 通过后补充）
