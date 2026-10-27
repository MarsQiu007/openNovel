# 修复 app 包测试 V2 session mock 缺失

## 背景

10-23/24 的 V2 接线提交（`ab514f6ce0`、`cee29869e2` 等）在 `bootstrap.ts` 和 `workspace-data.ts` 中引入了 `v2.session.active` / `v2.session.create` / `v2.session.prompt` 调用，但对应测试文件的 mock 对象未同步补上 `v2.session` 字段，导致 CI 上 `app#test` 持续失败。

## 失败用例

### CI 失败（unit linux / unit windows）

**bootstrap.test.ts**（2 个用例）：
- `marks a loading directory partial during bootstrap and complete after success`
- `seeds session status even while warming session info stalls`

错误：`TypeError: undefined is not an object (evaluating 'input.sdk.v2.session.active')`

**workspace-data.test.ts**（5 个用例）：
- `成功路径按 create → bind → prompt 顺序执行`
- `创建失败：不绑定、不发送 prompt，异常向上抛出`
- `绑定失败：不发送 prompt，异常向上抛出`
- `优先发送到最近绑定会话并返回该会话 ID`
- `无绑定会话时创建并绑定会话`

错误：`TypeError: undefined is not an object (evaluating 'input.sdk().client.v2.session')`

### 本地额外失败

本地跑 `bun run test:unit` 还有 27 个失败，主要是 `jsxDEV` 相关（`SyntaxError: Export named 'jsxDEV' not found`），影响 21 个测试文件。这是 Bun 版本差异导致的（本地 bun 1.4.3 vs CI bun 1.3.14），不影响 CI，本次不修。

## 修复方案

在测试 mock 中补上 `v2.session` 字段：

1. **`bootstrap.test.ts`**：两处 `v2` mock 对象各加 `session: { active: async () => ({ data: { data: {} } }) }`
2. **`workspace-data.test.ts`**：`client` mock 对象改为 `v2: { session: { create / prompt / list } }` 结构（原来放在 `client.session` 下，需迁移到 `client.v2.session`）

## 不做的事

- 不修本地 `jsxDEV` 问题（Bun 版本差异，CI 无此问题）
- 不改任何源码逻辑（这是纯测试 mock 修复）
