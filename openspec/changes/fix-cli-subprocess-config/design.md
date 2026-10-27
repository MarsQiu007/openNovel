# 设计

## 背景

Linux CI 上 4 个 cli 子进程测试（export/run × 2/stats）失败：子进程模型解析
回退 vivgrid 默认模型 401。本地（Windows + bun 1.4.3）全部通过，无法直接复现。

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

## CI 失败形态时间线（gh run 对照）

| 提交 | 调试 | 钉住 | export 会话内容 |
|---|---|---|---|
| `46b8de3ab4`（基线） | 无 | 无 | 助手行 `vivgrid/gpt-5.6-luna` + 401 |
| `9d8a32cbe2` | catalog-avail | 无 | 同上（401） |
| `5d71e2a2ab` | + global/provider | 无 | **无助手行**，`time.updated == created` |
| `c1b8de3ab4` | 同上 | 有 | 无助手行 |

两种表象同源：子进程内 test provider 未进入 catalog。
- 回退 401 行 = catalog 里有内置默认（vivgrid），解析失败走 fallback 后请求 401
- 无助手行 = catalog 全空 → `model.default` 为 undefined → runner 解析抛错 →
  drain 静默结束 → CLI 退出 0、零事件、零输出（run 测试的「空 stdout」贯穿始终）

## 修复

`c1b8de3ab4`：`isolatedEnv` 显式设 `OPENNOVEL_CONFIG_DIR=home/.config/opennovel`。
`Flag.OPENNOVEL_CONFIG_DIR` 是动态 env getter，`global.ts make()` 里
`Flag.OPENNOVEL_CONFIG_DIR ?? Path.config` 优先级高于 xdg-basedir 的
模块级缓存值 `Path.config`，绕开子进程模块加载时的解析差异。

`2c3028ff9c`：移除全部调试日志，保留钉住，单独验证。

## 验证

- 本地 `bun test test/cli/`：49 个测试全部通过（含钉住 + 移除调试后）
- CI：2c3028ff9c 的 run 待确认；若仍失败，export 会话内容可区分
  「回退 401」还是「catalog 全空」，再定后续方向
