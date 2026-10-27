# 任务

- [x] 1. 在 cli-process.ts 中加临时调试日志，打印子进程实际读到的 global.config 路径与配置文件存在性
- [x] 2. 推送调试 commit，查 CI 日志确认根因
- [x] 3. 根据根因实施修复（OPENNOVEL_CONFIG_DIR 钉住，见 design.md）
- [x] 4. 本地验证 cli 子进程测试通过
- [x] 5. 移除全部调试日志，单独提交验证
- [x] 6. 定位真正根因（启动竞态）并实施修复（692f2e8f71，见 design.md）
- [x] 7. 推送，确认 CI 中 export/run/stats × 4 全部通过
- [ ] 8. 收集实施提交，更新 tasks.md，归档提案

## 根因

两层叠加的启动竞态，与配置目录无关（`OPENNOVEL_CONFIG_DIR` 钉住是
无害的 no-op——cross-spawn 的 extendEnv 显式 env 胜出，保留）：

1. `PluginInternal.boot` 用 `Effect.forkScoped({ startImmediately: true })`
   异步注册内置插件，server 即刻开始服务；
2. `State.batch` 的语义是「批内 transform 只攒 reload，批末统一
   materialize 提交」。即使等待所有插件 active，catalog 数据也要等
   外层批处理结束才可见。

慢启动机（Linux CI）上 drain 的模型解析跑在提交之前：

- 批末 reload 中途读取：models-dev 的 reload 已跑（vivgrid 在）而
  config-provider 的未跑（test provider 不在）→ 回退默认模型 → 401
- 更早读取：catalog 全空 → `ModelUnavailableError` → drain 静默结束
  → CLI 退出 0、零输出

本地快机永远赢得竞态，故该测试层（2026-10-27 引入）在 CI 从未绿过。

修复（692f2e8f71）：三层信号——`PluginV2.layer` 默认注册
`catalog-boot` 就绪信号（最小层图立即放行）；`PluginInternal` 层构建期
先移除默认信号，fork 引导时 catalog 相关插件（纯 transform）先行一批、
批末重注册信号，网络型插件（config-skill/config-external）移到信号
之后；`SessionRunnerModel.resolve` 读 catalog 前等待信号。

## 验证

- 本地以 1500ms 引导延迟复现 CI 两种失败形态（run json 只收到
  prompted / step.started 后 step.failed 401），修复后延迟与正常场景
  下 `bun test test/cli/` 49 用例全过
- core 全量（XDG 隔离）、core/opennovel typecheck 通过

## 排查教训（沉淀）

1. 子进程测试的调试探针**不能写 stdout**（`--format json` 逐行解析会炸），
   也**不能在 core 模块顶层写 stderr**（effect-flock、help-text snapshots
   断言子进程 stderr 为空）。探针一律写文件。
2. 「本地通过 + CI 失败」时，先用无调试的基线 run 确认失败形态，再对比
   调试 run 的形态变化——调试探针自身会改变失败形态，容易误判根因。
3. 竞态复现用「人为延迟 + 本地验证」比读 CI 日志更快收敛：在可疑 fork
   前加 `Effect.sleep` 让快机也能输掉竞态，形态与 CI 一致即证实根因。
4. 等待异步填充要等「提交完成」而非「生产者就绪」：`State.batch` 的
   reload 在批末执行，等待插件 active 时数据尚不可见。
5. core 全量测试本地须用 `XDG_CONFIG_HOME` 等临时目录隔离：真实全局
   配置会让外部插件发现注册一堆工具、config-provider 把用户 provider
   注册进测试 location，两类断言全歪（与 httpapi 练习的 CWD 污染同源）。

## 实施提交

- `c1b8de3ab4` fix(opennovel): cli 子进程测试显式钉住 OPENNOVEL_CONFIG_DIR
- `2c3028ff9c` fix(core): 移除 cli 子进程测试的调试日志
- `692f2e8f71` fix(core): 模型解析等待内置插件 catalog 引导完成
