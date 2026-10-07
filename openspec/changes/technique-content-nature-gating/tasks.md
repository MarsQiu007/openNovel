# Tasks

依据：proposal.md、design.md（D1–D5）。

## 1. 配置契约（novel-store + protocol + client）

- [x] 1.1 novel-store 新增书级内容性质读写：`contentNatureOverride` 单键读写函数（缺省=自动模式），并新增"书库是否含 adult 技法"查询 helper；包目录 `bun typecheck` 与 oxlint 通过
- [x] 1.2 协议扩展：`technique.config` 响应增量返回 effective 书级内容性质（override ?? 被动信号 ?? general，含来源标识），`set-config` 请求增量接受可选 `contentNatureOverride`（传 null 清除覆盖）；packages/protocol 通过 `bun typecheck` 后，在 packages/client 运行 `bun run generate` 并确认生成物含新字段（验证：generate 后 client typecheck 通过）

## 2. 召回闸门（plugin store 层）

- [x] 2.1 `queryTechniques` 增加可选 adult 闸门入参：闸门不通过时过滤本书池中 `scope=adult` 条目，置信度路径与曝光位路径同一过滤点生效；全局池不受参数影响（验证：新增单测覆盖"闸门关闭时 adult 不进候选且不占曝光位""闸门开启行为与现状一致""全局池无关闸门"三态，technique-store 测试全绿）
- [x] 2.2 单池场景回归：本书库无 adult 技法的查询不传闸门时结果与现状逐条一致（验证：既有单源等价用例不修改且通过）
- [x] 2.3 packages/plugin 通过 `bun typecheck` 与仓库根 oxlint（0 errors）

## 3. 判定接入（plugin 流水线侧）

- [x] 3.1 书级性质确定性解析模块：override → 被动信号（书库存在 adult 技法）→ general 缺省，计算结果携带来源标识（验证：单测覆盖三分支）
- [x] 3.2 `assemble_context_snapshot` 新增可选 `content_nature` 参数（`adult`/`general`，未传/非法按 general）；pipeline/writer/outliner 的 system prompt 增加章节内容性质判断指引（何时判 adult、何时判 general、与书级闸门的关系）（验证：单测覆盖参数解析与缺省从紧）
- [x] 3.3 上下文组装接入：组装处先解析书级性质、读入工具参数作为章节性质，将闸门结果传入 `queryTechniques`；判定链路整体包在静默降级 try/catch 内——任何失败不影响写作主流程（验证：组装层测试 + 既有流水线回归通过）
- [x] 3.4 packages/plugin 通过 `bun typecheck` 与仓库根 oxlint（0 errors）

## 4. 界面（app）

- [ ] 4.1 技法表单 `scope=成人内容` 选项旁内联真实语义说明文案（"仅成人书的成人章节召回，其他书与其他章节不可见"）（验证：界面可见该说明；面板文案为硬编码中文，不涉及 i18n locale 文件）
- [ ] 4.2 技法面板头部展示书级内容性质（含来源标识：自动/人工覆盖）与切换控件（自动/成人/通用），覆盖操作走扩展后的 `set-config`，成功即刷新展示（验证：切换后重开面板值保持；展示与协议返回值一致）
- [ ] 4.3 packages/app 通过 `bun typecheck` 与 oxlint

## 5. 端到端验证

- [ ] 5.1 真实库冒烟（复制临时目录）：通用书（书库无 adult 技法）面板列出技法且召回（带闸门参数）不含 adult 条目；adult 书（被动信号）在 `content_nature=adult` 时候选含 adult 技法、参数缺省或 `=general` 时不含（验证：冒烟输出记录于本文件）
- [ ] 5.2 technique-agent-e2e 回归（OPENNOVEL_TECHNIQUE_E2E=1）：3 pass / 0 fail（验证：测试输出）
- [ ] 5.3 全仓门禁：根目录 `bun run lint`（0 errors，warnings 不新增）+ 受影响包 `bun typecheck`（验证：命令输出）

## 6. 提交

- [ ] 6.1 提交推送，commit 说明双闸门设计与工具参数机制，footer 带 `OpenSpec-Change: technique-content-nature-gating`（验证：git push 成功，CI 全绿）
