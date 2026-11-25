# Tasks

## 1. 清洗升级为段落重组

- [ ] 1.1 在 `cleanText` 逐行处理时于 `trim()` 前记录段首缩进标记（≥2 半角空格或含全角空格），随行进合并决策；按 design D1 决策树实现六级合并规则（空行分段 / 缩进新段 / 右引号强分段 / 句内合并 / 段内句间聚合 / 保守新段），保留候选章节标题行不并入、不被并入的保护前提
- [ ] 1.2 实现 D1 护栏：缩进行占比与空行占比各自须落在 [0.15, 0.75] 才作有效段落信号（取占比大者为主信号），均不在区间时禁用「段内句间聚合」退回现状行为；合并连接按中英文规则（ASCII 相邻补空格、中文空串）；识别场景分隔线独立成段
- [ ] 1.3 扩充广告行特征：书源站名与网址模式（限短行命中），保持清除计数入摘要
- [ ] 1.4 新增/更新 `packages/server` 清洗测试：缩进分段、右引号对话段保护、段内句末碎行聚合、信号区间护栏回退（无信号与诗歌型过密两种）、中英文连接规则、场景分隔线独立成段、网址广告行清除、广告行不粘连正文、章题行保护用例保持通过

## 2. 兜底拆分升级为边界感知

- [ ] 2.1 在 `structure.ts` 实现边界感知拆分函数（输入清洗后文本与 `{min, max}`，按 design D2 切点优先级（场景分隔线/段落边界 > 引号闭合句末 > 受限兜底）选边界），替换 `splitFixedLength`，同步更新 orchestrate 调用与全部引用
- [ ] 2.2 实现受限切点回退（硬上限 `max + min / 2` 内就近句末）并向问题清单标注
- [ ] 2.3 新增/更新 `packages/server/test/novel-import-structure.test.ts`：场景分隔线与段落边界优先、引号闭合句末兜底、默认范围字数达标（除末章 2000–3000）、末章为剩余全部、受限切点标注、拆分不修改正文字符

## 3. 契约与参数透传

- [ ] 3.1 在 `packages/schema/src/novel.ts` 导入预览与确认请求结构新增 `splitRange`（min/max Int，校验 min>=500、max<=20000、min<max）
- [ ] 3.2 在 `orchestrate.ts` 透传范围参数至解析输入，`PreviewTokenPayload` 增加 `range` 字段并纳入漂移检测；未传时使用默认 `[2000, 3000]`
- [ ] 3.3 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，并同步 `packages/codemode` 的 OpenAPI 测试 fixture 与受影响测试期望
- [ ] 3.4 更新 `packages/schema` 与 `packages/server` 契约/应用测试：范围参数校验（非法 400）、token 漂移检测、默认范围生效

## 4. 导入预览 UI

- [ ] 4.1 在 `novel-queries.ts` 预览与确认请求组装处透传 `splitRange`，并在导入预览页按字数分章开关旁新增下限/上限数字输入（默认 2000/3000），变更触发重新分析链路
- [ ] 4.2 新增文案进入既有 locale 体系（zh/en/zht），禁止硬编码
- [ ] 4.3 更新 `packages/app` 导入输入测试：范围输入渲染、变更触发重新分析、非法范围拦截

## 5. 验证与收尾

- [ ] 5.1 检查未引入同类、冗余、无用代码（新导出均被引用、无只服务死代码的 import、无未消费查询通道），命中即在本 change 内清理
- [ ] 5.2 在 `packages/server`、`packages/schema`、`packages/app` 分别通过 `bun typecheck` 与 oxlint，受影响包 `bun test` 全量通过；在 `packages/opennovel` 运行 `bun run test:httpapi`（至少 coverage 模式）验证 HttpApi 行为
- [ ] 5.3 用实测书籍（2.8 万字无章题 GB18030 TXT）人工冒烟验收：段落重组正确、切点不切断句子与引号、各章字数落在范围内
- [ ] 5.4 人工验收通过后执行全量回归（turbo typecheck 全量 + 受影响包全量测试），按 Workflow follow-up 完成提交、同步 specs、归档与推送