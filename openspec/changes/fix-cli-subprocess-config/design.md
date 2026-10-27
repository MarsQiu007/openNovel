# 设计

## 背景

Linux CI 上 4 个 cli 子进程测试（export/run × 2/stats）失败：子进程模型解析
回退 vivgrid 默认模型 401，或直接零输出退出 0。本地（Windows + bun 1.4.3）
全部通过，无法直接复现。

## 配置链路

1. `cli-process.ts` 的 `isolatedEnv` 设 `XDG_CONFIG_HOME=home/.config`，
   并把 test provider 配置写盘到 `home/.config/opennovel/opennovel.json`
   （`OPENNOVEL_CONFIG_CONTENT` 同内容兜底）
2. core `global.ts` 在模块加载时经 `xdg-basedir` 解析并**缓存** config 目录
3. V1 `provider` 配置经 `config/v1/migrate.ts` 迁移为 V2 `providers`，
   由 config-provider 插件注册进 CatalogV2
4. `provider.available` 过滤：`disabled` / `request.body.apiKey` /
   integration connections / 无 integration

## 调试历程（含教训）

1. 首轮探针用 `console.log`（写 stdout）→ 污染 `--format json` 的逐行 JSON
   输出，`parseJsonEvents` 报 SyntaxError。
   **教训：子进程测试的探针只能写 stderr 或文件，绝不能写 stdout。**
2. 换 `console.error`（写 stderr）后探明：config 加载正常（providers=test），
   但 `catalog.model.available()` 为空。
3. `global.ts` 模块顶层的 `console.error` 反过来打爆了断言子进程 stderr
   为空的测试（effect-flock、help-text snapshots，确定性失败）。
   **教训：模块顶层探针连 stderr 也不能写，core 里任何探针都要走文件。**
4. 三个 debug 提交收官后已全部移除。

## 根因（最终）

启动竞态，与配置目录无关：

- `PluginInternal.boot`（`plugin/internal.ts`）用
  `Effect.forkScoped({ startImmediately: true })` 异步注册内置插件，
  server 即刻服务
- `State.batch`（`state.ts`）的语义是「批内 transform 只攒 reload，
  批末统一 materialize」——插件 active ≠ catalog 数据可见

CI 慢机上 drain 的模型解析落在提交之前，两种形态同源：

- 批末 reload 中途读取 → models-dev 已提交（vivgrid 在）、
  config-provider 未提交（test provider 不在）→ 回退默认 → 401 行
- 更早读取 → catalog 全空 → `ModelUnavailableError` → drain 静默结束 →
  退出 0、零输出（「无助手行」）

本地 500ms/1500ms 引导延迟（`Effect.sleep` 插在 fork 批前）完整复现两种
形态，证实根因。钉住 `OPENNOVEL_CONFIG_DIR`（`c1b8de3ab4`）经
`cross-spawn-spawner.ts` 的 extendEnv 验证是 no-op，无害保留。

## 修复（`692f2e8f71`）

三层就绪信号，复用既有 `PluginV2.wait(id)` waiter/Deferred 模式：

1. `PluginV2.layer` 构建时默认注册 `catalog-boot` 信号插件——最小层图
   （无 PluginInternal 引导的测试/嵌入场景）里等待方立即放行，不挂死
2. `PluginInternal` 层构建期先 `remove` 默认信号，再 fork 引导：
   - catalog 批（models-dev、provider 系列、config-provider、variant，
     均为纯 transform）先行，`Effect.onExit` 里无论批处理成败都重注册
     信号（失败的插件不会再生效，等待方走正常解析错误路径而非挂起）
   - 网络型插件（config-skill 下载、config-external 安装）移到信号
     之后注册，不阻塞模型解析
3. `SessionRunnerModel.resolve` 读 catalog 前 `plugin.wait(bootReadyID)`
   （`Effect.ignoreCause` 容忍失败落定）；`node` deps 增加 `PluginV2.node`

时序保证：remove 与 fork 都在层构建期完成，窗口早于任何可调用 resolve
的 drain；批末 re-add 在批末 reload 全部执行之后，等待放行时数据必然
已提交。

## 验证

- 本地延迟复现：1500ms 延迟下 `bun test test/cli/` 49 用例全过
  （修复前同条件复现 CI 两种形态）；移除延迟后同样全过
- core 全量（XDG 隔离）、core/opennovel typecheck 通过
- `location-layer.test.ts` 的「rejects unavailable」用例原本依赖竞态
  （boot 提交前 catalog 为空才有 ModelUnavailableError）；修复后等待
  提交再解析，测试在隔离环境下确定性通过
