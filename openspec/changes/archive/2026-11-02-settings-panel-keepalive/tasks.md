# Tasks: settings-panel-keepalive

## 1. keep-alive 渲染结构（packages/app）

- [x] 1.1 在 `settings-main.tsx` 实现 keep-alive 基础：`KeepAlive` 容器（`Show when={visited}` + `style display` 双态）、`visited` 累积集合与 `activeKey` 派生（D2/D3）。验证：`packages/app` 下 `bun typecheck` 通过
- [x] 1.2 把 16 个条件渲染单元迁移到候选表驱动结构（D1 的 key 空间），未选中空态保持非 keep-alive；gallery 的 keyed 条目语义维持。验证：`packages/app` 下 `bun typecheck` 通过，手动切换全部面板无异常

## 2. 验证

- [x] 2.1 e2e 三套件回归：`setting-gallery` / `book-open-transition` / `isolated-character-graph` 全量通过（观测槽与可见性断言不受 hidden 面板影响）。验证：`bun run test:e2e` 三套件绿
- [x] 2.2 对照 delta spec「中央区面板 keep-alive」四条 scenario 逐条核对实现。验证：scenario 与实现一致，`openspec validate settings-panel-keepalive --strict` 通过

## 3. 验收

- [x] 3.1 用户实测切换体感：跨类别来回切换无重建闪烁、已填表单保持、首次打开仍有正常加载。验收为交互体感，交用户执行

## Implementation Commits

- a850040bde feat(app): 中央区面板 keep-alive 首次激活后保持挂载
- 987a983aff fix(app): 面板级 Suspense 边界截断迟到资源挂起

## Workflow follow-up

- 实现完成后：勾选任务、收集实现提交写入 `## Implementation Commits`、`openspec validate --strict`、归档并合并
- 纯渲染机制变更（无协议/生成物），无需 `bun run generate` 与旧 SDK 再生
- spec 归档时会同步进主 specs（`openspec/specs/novel-workspace-layout/spec.md`）
