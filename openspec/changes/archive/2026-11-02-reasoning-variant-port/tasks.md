# Tasks

## 1. 移植解析器与协议表

- [x] 1.1 新建 `core/src/plugin/reasoning-variant.ts`：移植上游 `supports()`/`resolve()` 与协议翻译表（按 design D2 过滤 fork 实际存在的包名条目，上游自有 `@opencode/ai/providers/*` 条目标注跳过）
  - 验证：`bun typecheck`（packages/core）通过；纯函数单测覆盖 supports/resolve 的 effort/toggle/budget 三分支
- [x] 1.2 对 fork provider 目录（`core/src/plugin/provider/`）逐个核对 aisdk 包名在协议表中的条目（D2 清单），缺失或包名不符的记录下来并在表内注释
  - 验证：核对结论以注释形式落在协议表文件内，review 可见

## 2. 元数据接入与通道接通

- [x] 2.1 `core/src/plugin/models-dev.ts` 模型填充处接入 reasoning 元数据解析（移植上游 modal/models.ts 的 variants(remote) 逻辑）：读 `reasoning`/`reasoning_options` → supports → resolve → 写入 `draft.variants`；删除 `draft.variants = []` 清空行
  - 验证：`bun test`（packages/core 的 models-dev 相关用例）通过；新增"元数据声明 effort 白名单 → variants 取值正确"用例
- [x] 2.2 接通 providerOptions 通道（design D3）：`session/runner/model.ts` 的 `withVariant` 扩展输出 providerOptions，`packages/llm` 的 LLMRequest 组装点消费；anthropic-messages 的 thinking 优先走协议 schema 字段
  - 验证：`bun typecheck`（core 与 llm）通过；withVariant 合并测试覆盖 settings/body 双通道

## 3. 硬编码移除与回归对拍

- [x] 3.1 删除 `core/src/plugin/variant.ts` 整文件及其在插件注册处的引用
  - 验证：`bun typecheck`（core）通过；全库 grep `VariantPlugin` 与 glm 硬编码规则零命中
- [x] 3.2 回归对拍：以 models.dev 元数据中 GLM-5.2 与 deepseek-v4 系列为样本，断言移植后生成的 variants 覆盖原硬编码语义（effort 档位存在、toggle 形态符合协议条目），请求组装含预期参数
  - 验证：对拍断言落在 core 测试；anthropic 与 openai-compatible 两条链路各有一个请求组装断言

## 4. 收尾验证与防冗余复查

- [x] 4.1 受影响包（core、llm）运行 `bun typecheck`、`bun test`，从仓库根按既定方式跑 oxlint 并与 main 基线同模式对比
  - 验证结论：core typecheck 通过、全量 1238 pass / 1 fail（location-layer「不可用模型」用例，main 基线同机同红——用户全局配置 ark-coding-plan 泄漏所致，与本改动无关）/ 7 skip；llm typecheck + 306 pass 全绿；oxlint 分支 5661 warnings vs main 5668，净减 7 无新增（唯一新增警报载体断言已改为 Schema 解码消除）
- [x] 4.2 按 config.yaml 防冗余规则自查：确认未引入无条目的协议死项、未消费的新导出、只服务死代码的 import
  - 验证结论：PROVIDER_OPTIONS_KEY/supports/resolve 均被消费；PROTOCOLS 仅三个可执行包名并附 D2 逐包核对注释；顺手删除旧硬编码插件及其测试（提交已注明）
- [x] 4.3 在实现提交 body 写入 `Ported-from:` 上游 SHA 清单（proposal 列出的 10 个 40 位 SHA）
  - 验证结论：`git log --grep` 核对——主移植提交 489528da11 含全部 10 个 SHA，接入提交 2 个，删除提交 1 个；适配类提交（Schema 解码修正）按规则不强制 Ported-from

## Implementation Commits

- 489528da11 feat(core): 移植推理档位解析器与协议方言表
- dbb3078de6 feat(core): models-dev 推理元数据接入并接通 providerOptions 通道
- c541721be9 refactor(core): 删除 GLM 硬编码 VariantPlugin
- 5fb01c8269 refactor(core): withVariant 载体拆包改用 Schema 解码

## Workflow follow-up

- 合并前同步 main、fast-forward 合并；归档用 `npx openspec archive --yes`
- 移植来源核对：`git -C D:\AI\Codes\opencode show <SHA>` 可复现每个 Ported-from 对应的上游改动
