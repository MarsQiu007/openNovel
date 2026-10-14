# Tasks

## 1. novel-store：归属继承解析

- [ ] 1.1 实现带继承语义的会话归属解析（自身绑定 → 既有单书懒绑定 → 沿父链逐级查最近绑定祖先并幂等写回 → 无归属；含 visited 环防护；父链访问器缺失或查询失败时降级为无归属）；原 `resolveNovelForSession` 行为保持不变；`packages/novel-store` 目录 `bun typecheck` 通过
- [ ] 1.2 补充 novel-store 单测覆盖继承语义：父链命中后绑定被持久化且重复调用不重复插入、多书目录不误绑、单书懒绑定先于链查询命中、链断返回无归属、parentID 环不死循环、父链访问器抛错时降级；`packages/novel-store` 目录 `bun test` 通过

## 2. plugin：写侧接通与调用点统一

- [ ] 2.1 增加 novel-writer 的 `clientV2` 父链访问器，并将 12 处 `resolveNovelForSession` 调用点（灵魂注入、系统上下文注入、压缩注入与各工具书籍解析）统一改走继承解析；`packages/plugin` 目录 `bun typecheck` 与 `bun test` 既有套件通过
- [ ] 2.2 审计确认 plugin 内不存在绕过继承的会话书籍解析直调（`git grep` 全量核对调用点清单与 design D2 一致），并在 novel-writer 测试环境以桩化父链访问器补充一条「未绑定子代理获得归属后工具解析成功」的用例；`packages/plugin` 目录 `bun test` 通过

## 3. app：路由兜底（读侧）

- [ ] 3.1 扩展 `resolveSessionRoute`：接受可选祖先链数据，沿链查找最近绑定行（自身优先），链缺失或未命中才返回 orphan；`packages/app` 目录 `bun test` 中 `session-route.test.ts` 新增用例（自身绑定优先、一级祖先命中、孙级命中、无绑定链降级、lineage 缺失降级）通过
- [ ] 3.2 改造 `SessionRedirect` 等待目录与 lineage 落定后执行决策：未绑定但祖先命中的子代理会话不再降级书架、不再弹「未绑定」提示；`packages/app` 目录 `bun typecheck` 通过，行为由 3.4 e2e 断言
- [ ] 3.3 改造 `openSessionRouted` 经 server sync lineage 解析祖先链并接入同一决策（命令面板、首页会话卡片、通知等入口共享兜底）；`packages/app` 目录 `bun typecheck` 通过，行为由 3.4 e2e 断言
- [ ] 3.4 扩展 `e2e/regression/subagent-child-navigation.spec.ts`：新增「未绑定子代理经时间线卡片按祖先归属进入书内（无降级提示）」与「孙级子代理沿链回溯」两个用例，mock 仅父会话持有绑定行；既有已绑定用例保持通过；playwright 该 spec 全绿

## 4. app：切换器多级与消费侧

- [ ] 4.1 重写 `boundNovelSessions` 为「绑定主会话 + parentID 树挂接全部未归档后代」：任意层级挂接、后代不要求自身绑定行、孤儿（链断）不展示、主会话按绑定顺序；`packages/app` 目录 `bun test` 中 `novel-queries.test.ts` 新增用例（孙级挂接、未绑定后代收录、孤儿三态保持、归档剔除、排序稳定）通过
- [ ] 4.2 递归化切换器渲染与拍平：条目组件递归支持任意层级（缩进递增、逐级展开、当前会话祖先链自动展开）、触发器标签与归档/导出拍平改递归；`session-switcher.test.ts` 扩展相应纯逻辑用例，`packages/app` 目录 `bun test` 通过
- [ ] 4.3 `resolveAutoAdoptTarget` 拆分双集合语义（记忆查找覆盖含后代全集合、回落保持最近活跃未归档主会话）；单测覆盖「记忆指向子代理恢复」「记忆失效回落主会话」「零会话返回 null」并通过
- [ ] 4.4 活动与批注占用判定的输入递归拍平为完整会话集合，抽共享拍平辅助供触发器、回跳与活动共用；`novel-queries.test.ts` 覆盖拍平辅助，`packages/app` 目录 `bun typecheck` 通过
- [ ] 4.5 扩展 `e2e/novel/session-switcher-subagent.spec.ts` 或新增 spec：孙级子代理嵌套收纳可见可打开、未绑定子代理子项照常收录；playwright 相关 spec 全绿

## 5. 集成验证

- [ ] 5.1 `packages/novel-store`、`packages/plugin`、`packages/app` 各自目录 `bun test` 与 `bun typecheck` 全部通过；根目录 `bun run lint` 通过
- [ ] 5.2 app e2e 相关套件（subagent、session-switcher、session-book-routing、regression 导航类）全绿
- [ ] 5.3 确认未触碰 Protocol / Server HttpApi（无需再生成 SDK）且 `openspec validate subagent-session-binding --strict` 通过
- [ ] 5.4 手工验收真实数据：XianXia 项目未绑定子代理从时间线卡片进入并可继续对话（工具正常解析归属书籍）；多书项目新建子代理在切换器可见且绑定行出现；孙级子代理嵌套可见

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: subagent-session-binding` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 同步主 specs → 归档 → 合并 `main` → 清理本地与远端分支