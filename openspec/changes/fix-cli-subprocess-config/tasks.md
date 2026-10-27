# 任务

- [x] 1. 在 cli-process.ts 中加临时调试日志，打印子进程实际读到的 global.config 路径与配置文件存在性
- [x] 2. 推送调试 commit，查 CI 日志确认根因
- [x] 3. 根据根因实施修复（OPENNOVEL_CONFIG_DIR 钉住，见 design.md）
- [x] 4. 本地验证 cli 子进程测试通过
- [x] 5. 移除全部调试日志，单独提交验证
- [x] 6. 定位真正根因（启动竞态）并实施修复（692f2e8f71，见 design.md）
- [x] 7. 推送，确认 CI 中 export/run/stats × 4 全部通过
- [x] 8. CI 第三轮暴露 opennovel#test 挂 workspace-adapter（Unbound
       SessionExecution）：归因为 v1-removal 同期提交 12457855d1 的旧伤，
       测试图补绑定修复（4fed136487，记在该 change 名下收尾）
- [x] 9. 信号插件方案换成零依赖 PluginBoot 门（0d32bbc24，见 design.md）
- [x] 10. 修复批重组回归：httpapi-sdk 首跑暴露 skills 在 release 后才
        注册（692f 拆批引入），纯 transform 插件回归 catalog 批、仅
        defer config-external（fa24b12f4，见 design.md）
- [ ] 11. 收集实施提交，更新 tasks.md，归档提案

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

修复（692f2e8f71 信号插件，0d32bbc24 换 PluginBoot 门，见 design.md）：
零依赖 `PluginBoot` 门服务——`PluginInternal` 层构建期 arm 收窄放行门，
catalog 批结束时无论成败 release（批末 reload 全部执行完才放行），
网络型插件（config-skill/config-external）移到批后注册；
`SessionRunnerModel.resolve` 读 catalog 前等待门放行。最小层图（无
PluginInternal 引导）默认 latch 已 succeed，立即放行不挂死。

## 验证

- 本地以 1500ms 引导延迟复现 CI 两种失败形态（run json 只收到
  prompted / step.started 后 step.failed 401），修复后延迟与正常场景
  下 `bun test test/cli/` 49 用例全过
- core 全量（XDG 隔离）1194 通过；opennovel 全量 1679 通过；
  core/opennovel typecheck 通过

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
6. CI 失败归因先核对提交进 main 的时间线与各自 change 归属：并行
   change 的提交在 CI 上交叠时，按「最近改过相关文件」直觉归因会
   张冠李戴——workspace-adapter 的 Unbound 一度误归因给 692f2e8f71，
   实际是 10 分钟前进入 main 的 v1-removal 提交 12457855d1 引入。
   决定性证据是检出嫌疑提交及其父提交分别复跑：父绿子红即实锤。
7. 拆批前先核查全部消费方依赖的可见性集合：把插件移出 catalog 批
   等于推迟其数据对「放行即读」消费方的可见性——config-skill 移到
   deferred 批后 httpapi-sdk 首跑即挂（awaitTestModel 等 test-model
   放行时 skills 尚未注册）。纯 transform 一律留批内，只 defer 真
   网络型（config-external）。

## 实施提交

- `c1b8de3ab4` fix(opennovel): cli 子进程测试显式钉住 OPENNOVEL_CONFIG_DIR
- `2c3028ff9c` fix(core): 移除 cli 子进程测试的调试日志
- `692f2e8f71` fix(core): 模型解析等待内置插件 catalog 引导完成
- `0d32bbc24` fix(core): 模型解析等待插件引导门放行
- `fa24b12f4` fix(core): 纯 transform 插件回归 catalog 批，仅 defer config-external
