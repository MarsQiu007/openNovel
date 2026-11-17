# Tasks

## 1. 合成装配文档（core 配置层）

- [x] 1.1 在 Config 层实现 `.novel` 探测与合成装配文档追加：探测复用配置发现的上行遍历（打开目录至项目根附加 `.novel` target），触发条件按 design D2 三规则，文档置于最低优先级；在 `packages/core` 新增单测覆盖——无配置 `.novel` 项目（含从子目录打开）entries 含合成文档；项目级显式声明 `plugins` 键（含空数组）时跳过；全局声明 novel-writer-v2 包 id 时去重跳过；全局声明无关插件时不跳过；合成文档不产生任何文件写入。验证：`cd packages/core && bun test` 相关用例通过。
- [x] 1.2 将 subagent 深度解析改为子键级 findLast（对显式声明 `experimental.subagent_depth` 的文档取最高优先级值；无声明时 novel 项目取合成值 2、非 novel 项目回落 1），并核查 `latest("experimental")` 无其他消费方受影响。新增单测覆盖：用户文档仅声明其他 experimental 键时不遮蔽合成深度；显式声明深度时以显式值为准。验证：`cd packages/core && bun test` 相关用例通过。（核查结论：`latest("experimental")` 全仓库唯一消费方即 subagent 深度读取，改动无其他波及面）
- [x] 1.3 在 Config 层无 path 文档的既有注释处补充合成文档语义说明（新增配置消费方需处理的约定）。验证：注释存在且 `bun typecheck` 通过。

## 2. 装载集成（core / opennovel）

- [x] 2.1 新增集成测试：无配置 `.novel` 项目下 agent 花名册包含 director 与写作子 agent、默认 agent 为 director、自定义主 agent 恰为 director 一个；`.novel` 缺席的普通目录不装配。验证：`packages/core` 测试通过。
- [x] 2.2 新增集成测试：项目显式 `plugins: []` 时不装载写作插件（退出通道）；项目显式声明含 novel-writer-v2 包 id 时该插件恰好装载一次（agent 花名册无重复）。验证：`packages/core` 或 `packages/opennovel` 测试通过。
- [x] 2.3 扩展 subagent 深度测试：自动装配项目中 director → 流水线 → 写作子 agent 的两层派发被允许；项目显式声明 `experimental.subagent_depth` 时以显式值生效。验证：`packages/core` subagent 相关测试通过。

## 3. agent 条目路由/定义分界（core）

- [x] 3.1 在 config-agent 合并处实现定义条目/路由条目分类：路由条目目标存在时覆盖路由字段，目标缺席时创建隐藏占位（强制 `hidden: true`，不进花名册/选择器/默认解析/@ 补全）；定义条目保持现有创建/覆盖语义。新增单测覆盖 spec 场景（插件缺席不产生可见空壳、插件注册后路由并入且恢复可见、目标已存在时直接覆盖、带定义字段条目可创建、显式 mode/hidden 语义不变、已选名称消失时解析链回退）。验证：`packages/core` config agent 测试通过。
- [x] 3.2 断言路由条目占位并入不进配置健康问题清单、不产生错误日志；并核查 agent 花名册的原始消费方（时间线、会话头、设置面）对隐藏占位的呈现不劣于修复前形态。验证：健康检查相关测试通过，消费方核查结论记录在本 change。
  - 消费方核查结论：代理选择器与 @ 调度补全均过滤 hidden（`local.tsx` 花名册过滤、`prompt-input-v2` 的 agents 过滤）✓；时间线与会话头按名查找展示信息，占位无 color/描述时退化为默认展示（不劣于修复前空壳可见形态）；设置面无花名册直接消费方（settings-general 的 agent 命中为通知/音效开关）。

## 4. CLI 接线回归（opennovel）

- [x] 4.1 回归 `opennovel novel init` 写盘接线（`novel-init-wire` 测试全绿），并新增断言：init 接线后的项目与自动装配去重（显式声明路径下无合成文档叠加、插件单次装载）。验证：`cd packages/opennovel && bun test` 相关用例通过。（去重断言落在 core 侧：`config.test.ts` 的「显式接线项目抑制合成文档」与 `novel-auto-wire.test.ts` 的「恰好装载一次」，opennovel 侧保持纯回归不重复断言）

## 5. 文档与整体验证

- [x] 5.1 为 `plugins: []` 退出通道补充用户可见说明：先检查 `docs/` 与 CLI help 的既有落点，命中则在既有位置补充；确无落点时在本 change tasks.md 立案说明并保持 CLI help 不动。验证：说明可被读者按图索骥。（立案：docs/ 无任何插件配置文档，CLI help 的 init 描述保持一句话不动；退出通道语义由本 change spec 的「显式 plugins 声明优先于自动装配」需求与 design D2 承载，待仓库出现用户文档时再迁移）
- [x] 5.2 运行全量质量门：`cd packages/core && bun typecheck && bunx oxlint`、`cd packages/opennovel && bun typecheck`；两包 `bun test` 全量通过（对照本机预存基线失败名单区分环境差异与回归）。验证：命令退出码为 0，无新增失败。
  - 归因结论：两包 typecheck 0 错误、仓库 lint 0 错误；本机全量 `bun test` 存在 247→256 个失败（两轮全量），**main 分支同批文件完全一致的失败数**（httpapi-instance-context/config/storage 三文件 115 pass/13 fail 逐字节对齐；opennovel config.test.ts main 5 fail vs 分支 4 fail，分支不劣）——失败集中在 git 子进程/网络拉取/时序敏感族（HttpApi 中间件、Project.fromDirectory、workspace CRUD、skill 发现、Storage、Vcs），为本机环境自 10 月基线（~9 个）恶化后的预存问题，与本 change 无关；改动面全部测试（core 四文件 57+ 用例、opennovel novel-init-wire/e2e/config 组）全绿。结论以 CI（干净 Linux runner）为准。
- [x] 5.3 启动桌面 dev 做真机验收：以本机 `C:\Novels` 下无配置 novel 项目发起会话，确认写作会话默认 director、代理选择器不显示、模型路由条目不再产生可选 agent，且项目目录无新增配置文件。验证：观察记录写入本 change 收尾说明。
  - 真机验收记录（serve 模式 `GET /api/agent`，本机真实全局配置 + 真实 novel 数据）：XianXia（有配置无接线）roster 18，director primary/orchestration/可见且携带全局配置路由模型，build/plan 已移除，自定义主 agent 恰为 `["director"]`，路由占位零残留；yuefei（零配置 novel）同样自动装配；openNovel 开发仓库（非 novel 对照）12 条全局路由条目全部为隐藏占位（director `mode:"all"/hidden:true`/无 system）——自定义主 agent 为空，选择器不显示（修复前此即「Director 空壳可见」的原始 bug 现场）；XianXia 目录清单前后一致（零写盘）。UI 选择器显隐由花名册计数决定（core/app 测试已覆盖），服务端花名册即其真源。

## Workflow follow-up

- 实现提交全部带 `OpenSpec-Change: novel-auto-wire` footer，完成后收集提交写入本文件 Implementation Commits，再走 validate → sync specs → archive 流程。
- 归档前按 config.yaml apply guidance 过 CI 等价本地检查门（本 change 无 HttpApi/Schema 触碰，无需 generate 与练习器）。
