# Tasks

## 1. 共享归一化（novel-store）

- [ ] 1.1 新增规则归一化函数并导出（嵌套 `父.子` 展平、数组索引展平、JSON/行文本解析、显式清空与无法归一化语义）；验证：新增 `packages/novel-store/test/style-rules.test.ts` 覆盖全部形态与失败路径，包目录 `bun test` 通过
- [ ] 1.2 风格指南写入边界（upsertStyleGuide、书籍元数据联合保存 saveBookMeta）接入归一化，saveBookMeta 不再对 rules 双重编码；验证：新增用例断言嵌套输入落库为扁平映射、读取回为对象形态，`bun test` 通过
- [ ] 1.3 在 packages/novel-store 运行 `bun typecheck`；验证：退出码 0

## 2. 插件写入路径

- [ ] 2.1 设定保存工具的 style_guide 分支改用共享归一化：非空无法归一化时按条报错并跳过全部字段写入（不产生部分成功）；验证：扩展 `packages/plugin/test/novel-writer/save-settings.test.ts`（嵌套展平、数组展平、行文本、拒绝且不部分写入、显式清空）通过
- [ ] 2.2 状态提交管线的 style 分支改用共享归一化，失败时明确抛错、不再静默写入 `{}`；验证：相关 state-commit 测试新增展平与失败用例通过
- [ ] 2.3 更新设定保存工具描述与 architect / observer 提示词中的 rules 格式说明（扁平映射契约、展平规则、失败语义）；验证：工具描述与提示词文本包含展平语义断言
- [ ] 2.4 设定检查工具（check_novel_settings）的规则读取改用共享归一化，按 `- 键: 值` 逐条输出展平规则（历史嵌套/数组/JSON 字符串形态不再输出原始嵌套 JSON）；验证：扩展插件测试断言历史形态数据以展平规则行输出
- [ ] 2.5 在 packages/plugin 运行 `bun typecheck`；验证：退出码 0

## 3. 服务端与内嵌阅读器读取路径

- [ ] 3.1 服务端 style_guide 读取归一化改用共享函数（含历史嵌套、数组、JSON 字符串容错）；验证：server 测试断言历史形态读取为扁平映射且 HTTP 响应形状不变
- [ ] 3.2 内嵌阅读器（packages/opennovel 的 `/reader` 风格页）读取路径使用共享归一化：风格接口返回前将 rules 归一化为扁平映射，历史嵌套/数组/JSON 字符串形态展平展示（不再出现 [object Object]）；验证：新增 packages/opennovel 测试断言接口返回规则为扁平映射
- [ ] 3.3 在 packages/server 与 packages/opennovel 运行 `bun typecheck` 与相关测试；验证：退出码 0 且测试通过

## 4. 快照渲染与预算

- [ ] 4.1 快照工具输出与会话级系统注入渲染风格规则行（空规则不渲染规则段）；验证：`packages/plugin/test/novel-writer/context-snapshot.test.ts` 新增断言通过
- [ ] 4.2 风格指南预算策略改造：基调、视角、时态优先保留，规则逐条截断并带截断提示；验证：预算相关测试覆盖超限截断与“规则超长不减基调、视角、时态”场景，`bun test` 通过
- [ ] 4.3 在 packages/plugin 运行 `bun typecheck` 与 novel-writer 相关测试套件；验证：退出码 0 且全部通过

## 5. 集成验证

- [ ] 5.1 端到端回归：嵌套 rules 经保存、读取到快照渲染的全链路测试通过（覆盖拒绝与截断两类边界）
- [ ] 5.2 在仓库根运行 `bunx oxlint`，并在 packages/plugin、packages/novel-store、packages/server、packages/opennovel 分别运行 `bun typecheck`；验证：0 错误、退出码 0
- [ ] 5.3 运行 `openspec validate style-rules-pipeline --strict`；验证：通过
