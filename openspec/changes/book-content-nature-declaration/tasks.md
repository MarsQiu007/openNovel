# Tasks

## 1. novel-store 存储与迁移

- [x] 1.1 `NovelTable` 增加 `content_nature` 列（text，NOT NULL DEFAULT `'general'`），`updateNovel` store 函数支持写该字段（创建插入在 server handler 直接完成，见任务 3.1），新增 `getBookContentNature(directory)` 查询 helper（无行/无列/异常一律返回 `'general'`）；验证：`packages/novel-store` 目录跑 `bun test` 通过，新 helper 行为有测试覆盖
- [x] 1.2 `migrate.ts` 新增 `migrateNovelContentNature(exec, query)` 并挂入 `runMigrations`（注册顺序须在 `migrateTechniqueScope` 之后，数据迁移依赖 techniques.scope 列已就绪）：novels 表缺失直接跳过；无 `content_nature` 列则 ALTER 补列；列就绪后执行幂等数据迁移（`UPDATE novels SET content_nature='adult' WHERE content_nature='general' AND EXISTS (SELECT 1 FROM techniques WHERE scope='adult')`，techniques 表缺失时跳过）；验证：新增迁移测试覆盖"默认 general / 含 adult 技法的书转 adult / 重复执行幂等 / 无 novels 或 techniques 表跳过"四个场景且 `bun test` 通过

## 2. 运行时判定切换（plugin）

- [x] 2.1 `technique-nature.ts` 的 `resolveBookContentNature` 改为调用 novel-store `getBookContentNature`，不再调用 `bookHasAdultTechniques`；失败从紧回落 general 语义不变；`bookHasAdultTechniques` 保留但注释改为迁移期用途；验证：`technique-nature.test.ts` 改为列驱动语义（novel 行 `content_nature='adult'` 判 adult；仅有 adult 技法但 novel 为 general 判 general；无 novel 行判 general），`packages/plugin` 目录相关测试全绿

## 3. 协议与生成物

- [x] 3.1 `packages/schema/src/novel.ts`：`CreateNovelInput`/`UpdateNovelInput` 增加可选 `content_nature`（`'general'|'adult'`），`Novel`/`NovelDetail` 增加 `content_nature` 回传字段；server `createNovel`/`updateNovel` 透传、`toNovel` 映射新列；验证：`packages/client` 运行 `bun run generate` 成功，相关包 `bun typecheck` 通过
- [x] 3.2 运行 `./packages/sdk/js/script/build.ts` 重新生成 legacy JS SDK；验证：生成物 diff 仅含 content_nature 相关契约，SDK 构建成功

## 4. app 界面

- [x] 4.1 创建向导 `wizard.tsx` 确认页增加内容性质选项行（普通默认选中 / 成人向），提交并入 `createNovel.mutateAsync` 的 `content_nature`（`useCreateNovel` 的 mutationFn 显式列字段调用契约，输入类型与调用处都要带该字段）；不新增向导步骤、canNext 不变；文案中性中文硬编码（不改 i18n locale 文件）；验证：app 现有测试通过，创建请求载荷含该字段（单测或手测记录）
- [x] 4.2 技法面板 `panel-techniques.tsx`：顶部新增检测确认条（显示条件=书 general 且本书技法列表存在 `scope==='adult'` 且本地未忽略；确认调 `useUpdateNovel` 写 `'adult'`（其 mutationFn 同样显式列字段，输入类型与调用处都要带该字段）；暂不写 localStorage 按书忽略）；表单"成人内容"内联说明更新为显式声明语义；验证：app 目录 `bun typecheck` 与现有测试通过；面板组件无单测先例，确认条显示/确认/暂不三种状态随任务 5.1 冒烟记录

## 5. 集成验证

- [x] 5.1 冒烟：复制 `C:\Novels` 下一本含 adult 技法的旧书库与一本普通旧书库到临时目录，用 novel-store 打开后确认前者迁移为 adult、后者为 general、重复打开结果不变；`packages/novel-store`、`packages/plugin` 全量测试与 `oxlint`（仓库根）通过；冒烟输出记录进提交说明或任务备注
