# Tasks

## 1. 移植解析器与协议表

- [x] 1.1 新建 `core/src/plugin/reasoning-variant.ts`：移植上游 `supports()`/`resolve()` 与协议翻译表（按 design D2 过滤 fork 实际存在的包名条目，上游自有 `@opencode/ai/providers/*` 条目标注跳过）
  - 验证：`bun typecheck`（packages/core）通过；纯函数单测覆盖 supports/resolve 的 effort/toggle/budget 三分支
- [x] 1.2 对 fork provider 目录（`core/src/plugin/provider/`）逐个核对 aisdk 包名在协议表中的条目（D2 清单），缺失或包名不符的记录下来并在表内注释
  - 验证：核对结论以注释形式落在协议表文件内，review 可见

## 2. 元数据接入与通道接通

- [ ] 2.1 `core/src/plugin/models-dev.ts` 模型填充处接入 reasoning 元数据解析（移植上游 modal/models.ts 的 variants(remote) 逻辑）：读 `reasoning`/`reasoning_options` → supports → resolve → 写入 `draft.variants`；删除 `draft.variants = []` 清空行
  - 验证：`bun test`（packages/core 的 models-dev 相关用例）通过；新增"元数据声明 effort 白名单 → variants 取值正确"用例
- [ ] 2.2 接通 providerOptions 通道（design D3）：`session/runner/model.ts` 的 `withVariant` 扩展输出 providerOptions，`packages/llm` 的 LLMRequest 组装点消费；anthropic-messages 的 thinking 优先走协议 schema 字段
  - 验证：`bun typecheck`（core 与 llm）通过；withVariant 合并测试覆盖 settings/body 双通道

## 3. 硬编码移除与回归对拍

- [ ] 3.1 删除 `core/src/plugin/variant.ts` 整文件及其在插件注册处的引用
  - 验证：`bun typecheck`（core）通过；全库 grep `VariantPlugin` 与 glm 硬编码规则零命中
- [ ] 3.2 回归对拍：以 models.dev 元数据中 GLM-5.2 与 deepseek-v4 系列为样本，断言移植后生成的 variants 覆盖原硬编码语义（effort 档位存在、toggle 形态符合协议条目），请求组装含预期参数
  - 验证：对拍断言落在 core 测试；anthropic 与 openai-compatible 两条链路各有一个请求组装断言

## 4. 收尾验证与防冗余复查

- [ ] 4.1 受影响包（core、llm）运行 `bun typecheck`、`bun test`，从仓库根按既定方式跑 oxlint 并与 main 基线同模式对比
- [ ] 4.2 按 config.yaml 防冗余规则自查：确认未引入无条目的协议死项、未消费的新导出、只服务死代码的 import
- [ ] 4.3 在实现提交 body 写入 `Ported-from:` 上游 SHA 清单（proposal 列出的 10 个 40 位 SHA）

## Implementation Commits

（实现阶段填写；提交 body 须含 Ported-from 清单）

## Workflow follow-up

- 合并前同步 main、fast-forward 合并；归档用 `npx openspec archive --yes`
- 移植来源核对：`git -C D:\AI\Codes\opencode show <SHA>` 可复现每个 Ported-from 对应的上游改动
