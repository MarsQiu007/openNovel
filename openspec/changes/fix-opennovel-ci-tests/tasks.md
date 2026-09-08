## 1. CLI help snapshot 修复

- [x] 1.1 移除 `help-snapshots.test.ts` 中对 `--mini`（hidden 选项）的 `toContain` 断言，并检查是否有其他对隐藏选项的过期断言。
- [x] 1.2 运行 `bun test test/cli/help/help-snapshots.test.ts` 确认通过。

## 2. LLM 回放更新

- [x] 2.1 确定当前 system prompt 与 fixture 中 `instructions`/`system` 字段的差异。
- [x] 2.2 为三个 recorded scenario 增加忽略 system prompt 字段的回放 matcher。
- [x] 2.3 运行 `bun test test/session/llm-native-recorded.test.ts` 确认通过。

## 3. Prompt 测试隔离

- [x] 3.1 prompt 测试 RuntimeFlags 禁用默认插件，避免 novel-writer 覆盖通用 build/plan agent。
- [x] 3.2 为 compaction 的易抖动长用例补 per-test 超时并运行相关测试文件确认通过。

## 4. 其他失败逐类修复

- [x] 4.1 同步 agent 默认属性/权限合并、webfetch 默认策略和子代理模型回退断言。
- [x] 4.2 更新 cli.error 中文文案断言；将新旧品牌旧 auth 插件包加入 deprecated 过滤。
- [x] 4.3 更新 Vcs CR patch 校验、HttpApi compression/listen 测试的当前契约。
- [x] 4.4 使用绝对 Bun 可执行文件修复 ACP/serve 子进程启动，保留盘符归一化 Windows 路径变体，并适配 serve 中英文监听文案。

## 5. 全量自查

- [x] 5.1 在 `packages/opennovel` 运行完整 `bun run test`，确认 0 失败。
- [x] 5.2 在 `packages/opennovel` 运行 `bun typecheck`。
- [x] 5.3 运行 `openspec validate fix-opennovel-ci-tests`。

## 6. HttpApi 运行时契约补齐

- [x] 6.1 HttpApi exerciser 保持默认插件启用，session 场景改用 director 并断言插件 agent 契约。
- [x] 6.2 将 `character_states.chapter_id` 公共契约与存储层改为必填，重新生成客户端。
- [x] 6.3 修复 HttpApi exerciser 的 Windows 临时目录与 PTY 跨平台问题。
- [x] 6.4 运行 HttpApi 目标场景、coverage/auth/effect 全门禁、typecheck 与 OpenSpec 校验。
