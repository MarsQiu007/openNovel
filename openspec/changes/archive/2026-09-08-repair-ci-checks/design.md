## Context

推送 `65090b2258` 后，`main` 的三条 workflow 同时失败：

- `typecheck`：多个包并发检查后以 `137` 退出，说明 runner 进程被 OOM 杀死。
- `generate`：生成物在本地无差异，但 workflow 仍停在 `Commit and push`；自动提交 `main` 的方案依赖写权限且长期不稳定。
- `test`：`unit` 因引用已删除 API 的旧 browser 测试失败；e2e 因旧标签体系测试、mock 空对象、旧布局/标题/i18n/执行状态断言失败，并在 GitHub runner 上超过 30 分钟。
- 本分支已有一组排查期间产生的未提交修改，必须按提案复核，不能默认全部保留。

产品行为约束来自现有规格：`titlebar-tabs` 明确只允许书籍标签，会话与草稿退出标签体系；批注执行轮次在发送后保持 `running`，等待 AI 工具回填；应用当前正式 i18n 支持范围为 `en`、`zh`、`zht`。

## Goals / Non-Goals

**Goals:**

- 让 `generate`、`typecheck`、`unit`、`e2e` 四类检查在本地和 GitHub Actions 中表达同一契约。
- 区分真实产品缺陷与过期测试；本提案范围内的失败只通过 CI 配置、测试夹具或过期测试修复。
- 复核并收敛本提案前产生的本地修改，保证没有夹带产品运行时代码变更。
- 为后续提交提供可验证的任务与检查清单。

**Non-Goals:**

- 不改变产品运行时代码、API schema、数据库结构或用户可见行为。
- 不为通过 CI 放宽核心质量要求。
- 不处理与本轮 workflow 失败无关的慢测试性能优化。
- 不新增 i18n locale；只让测试覆盖当前正式支持的 locale。

## Decisions

1. **typecheck 串行执行**
   - 将根检查改为 `bun turbo typecheck --concurrency=1`。
   - 理由：本地串行检查稳定通过，而 CI 并发触发 OOM；短期正确性优先于少量时间成本。
   - 备选：提高 runner 规格、拆分 matrix。当前收益不足以引入额外费用与配置复杂度。

2. **generate 只做校验，不写 `main`**
   - workflow 执行生成命令后运行 `git diff --exit-code`；若生成物不同步则失败。
   - 生成物必须由提案实现流程生成、提交并合并；CI 不再代替开发者提交。
   - 备选：使用 PAT/PR bot。会引入凭据治理和额外分支流程，不适合当前单人主导仓库。

3. **测试 mock 返回集合契约**
   - `/api/novel`、session bindings、annotations、technique 集合默认返回数组；`/api/sync/run` 返回 `{ results: [] }`。
   - 理由：这些端点的 HTTP API success 类型本来就是集合；返回 `{}` 会让共享组件把对象当数组迭代。
   - 只在测试 mock 中兜底，不在产品端隐藏契约错误。

4. **删除已废弃标签行为的 e2e，不重写**
   - 会话/草稿标签相关测试与 `titlebar-tabs` 规格冲突，且其被测产品路径已移除。
   - 保留仍有独立价值的 remote server、工作台布局、批注执行测试，只修正 mock 和断言。
   - 备选：改写成书籍标签测试。那属于新测试设计，应另建提案，不混入 CI 修复。

5. **先审查本地现场，再提交**
   - 执行阶段先逐文件 diff 分类：CI 配置、过期测试、测试契约、误改/无依据修改。
   - 与提案无关的修改回退；确认后的实现按逻辑拆分 scoped commit，全部绑定 `OpenSpec-Change: repair-ci-checks`。

## Risks / Trade-offs

- [串行 typecheck 增加 CI 时间] → 先接受稳定优先；后续若时间成为瓶颈，另建提案拆分缓存或 runner matrix。
- [generate 不自动提交可能让生成物暂时不同步] → CI 会明确失败并提示本地生成；不会静默覆盖 `main`。
- [删除 e2e 可能降低历史行为回归覆盖] → 只删除与当前规格冲突的测试；书籍标签切换等现有能力继续由单测和未被删除的 e2e 覆盖。
- [GitHub runner 资源和时间与本地不同] → 除本地全量检查外，合并后观察一次 Actions；若 e2e 只因 runner 慢超时，另建 CI 资源提案，不在本提案中放宽超时。

## Migration Plan

1. 在当前分支完成实现与本地验证。
2. 提交时绑定 `OpenSpec-Change: repair-ci-checks`。
3. 完成审查、归档流程后合并到 `main` 并删除提案分支。
4. 观察 GitHub Actions；若失败，先区分本提案回归与新问题。
5. 回滚策略：还原本提案的 workflow 和测试提交即可，不涉及数据迁移。