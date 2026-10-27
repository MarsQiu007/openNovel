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
5. CI 失败归因先核对提交进 main 的时间线与各自 change 归属：并行
   change 的提交在 CI 上交叠时，按「最近改过相关文件」直觉归因会
   张冠李戴——workspace-adapter 的 Unbound 一度误归因给 `692f2e8f71`，
   实际是 10 分钟前进入 main 的 v1-removal 提交 `12457855d1` 引入。
   决定性证据是检出嫌疑提交及其父提交分别复跑：父绿子红即实锤。

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

## 修复

### 初版（`692f2e8f71`，信号插件，已被替换）

复用既有 `PluginV2.wait(id)` waiter/Deferred 模式：`PluginV2.layer`
默认注册 `catalog-boot` 信号插件（最小层图立即放行），
`PluginInternal` 引导批末重注册，`SessionRunnerModel.resolve` 等待
信号。本地验证全绿后推送，CI 却暴露 `workspace-adapter.test.ts` 抛
`Unbound layer node`——归因确认是同期进入 main 的 v1-removal 提交
`12457855d1` 引入的旧伤（见教训 6），与信号方案无关；但该方案让
`SessionRunnerModel.node` 依赖 `PluginV2.node`（14 节点插件图依赖
链）本身也是不必要的耦合，顺势替换。

### 终版（`0d32bbc24`，PluginBoot 门）

零依赖门服务 `plugin/boot.ts`（ready/arm/release），默认 latch 已
succeed——无引导方（最小测试/嵌入层图）立即放行，不挂死：

1. `PluginInternal` 层构建期 `arm` 收窄放行门（早于任何可调用
   resolve 的 drain），随后 fork 引导：catalog 批（models-dev、
   provider 系列、config-provider、variant，均为纯 transform）先行，
   `Effect.onExit` 无论批处理成败都 `release`——失败的插件不会再
   生效，等待方走正常解析错误路径而非挂起
2. 网络型插件（config-skill 下载、config-external 安装）移到
   catalog 批之后注册，不阻塞模型解析
3. `SessionRunnerModel.resolve` 读 catalog 前 await `ready`，node
   deps 换成零依赖的 `PluginBoot.node`

时序保证：arm 与 fork 都在层构建期完成，窗口早于任何 drain；release
挂在 `State.batch` 的 onExit 上，批末 reload 全部执行完后才放行，
等待方读到的 catalog 数据必然已提交。

### 批重组回归（attempt 3 暴露，`fa24b12f4` 修复）

初版把 config-skill 等与网络型插件一起移到 release 之后的 deferred
批，CI 首跑 httpapi-sdk 即挂：REST prompt context 断言
`project-rest-skill` 缺席——`awaitTestModel` 轮询 test-model 可见
（= catalog 批提交 = 门 release），skills 却在 release 后才注册。
原版单批注册全部插件，skill 与 model 同一次批末提交，不存在此窗口。

核查注册成本后重组：config-skill/config-agent/config-command/
config-reference 均为纯本地 transform（config-skill 只声明 skill
source，URL 下载发生在消费侧 materialize），全部回归 catalog 批
（保持原版相对顺序）；唯一网络型是 config-external（npm registry
安装），保持 defer。门放行时 models/providers/agents/commands/
skills 同批可见，恢复原版语义。

## 验证

- 本地延迟复现：1500ms 延迟下 `bun test test/cli/` 49 用例全过
  （修复前同条件复现 CI 两种形态）；移除延迟后同样全过
- core 全量（XDG 隔离）1201 通过；opennovel 全量 1710 通过
  （含 workspace-adapter 补绑定修复后）；core/opennovel typecheck 干净
- 批重组后：httpapi-sdk 本地 3 轮全绿；1500ms 批内延迟下 cli 全量
  49 + httpapi-sdk 13 全过（skills 与 models 同批可见）
- `location-layer.test.ts` 的「rejects unavailable」用例原本依赖竞态
  （boot 提交前 catalog 为空才有 ModelUnavailableError）；修复后等待
  提交再解析，测试在隔离环境下确定性通过
