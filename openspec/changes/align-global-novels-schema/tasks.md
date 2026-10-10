# Tasks

## 1. core 建表定义补列

- [x] 1.1 修改 packages/core/src/session/sql.ts 的 NovelTable drizzle 定义，补 master_outline（text DEFAULT '' NOT NULL）、story_spine（text 可空）、content_nature（text DEFAULT 'general' NOT NULL）三列；验证：packages/core 下 bun run typecheck 通过
- [x] 1.2 运行生成器 bun script/migration.ts --name global_novels_columns，一次性产出迁移文件 packages/core/src/database/migration/20261010032350_global_novels_columns.ts、重新生成的 schema.gen.ts 初始建表、migration.gen.ts 注册与 schema.json 快照；验证：生成器成功且 bun script/migration.ts --check 报告无漂移（exit=0）
- [x] 1.3 修复生成脚本 Windows 兼容：script/migration.ts 的 generatedMigrations 中 file.split("/") 不切分反斜杠路径导致 Windows 下生成即报错，改为跨平台切分；验证：Windows 下生成器可正常产出迁移与注册表

## 2. 存量库补列行为验证

- [x] 2.1 在 packages/core 新增测试：建含 session 表 + 旧结构 novels 表（无三列，含 20260721152252 历史迁移记录）的既有库，执行迁移管线（applyOnly 路径），断言三列补齐且默认值正确（master_outline=''、content_nature='general'、story_spine 为 NULL）；验证：新增测试通过
- [x] 2.2 在 packages/core 新增测试：迁移重复执行（两次 applyOnly）后列结构与数据不变；验证：新增测试通过
- [x] 2.3 在 packages/core 新增测试：全新空库走 apply() 后 novels 表直接具备三列；验证：新增测试通过

## 3. 防漂移一致性校验

- [x] 3.1 在 packages/novel-store 新增一致性校验测试（以 novel-store NovelTable drizzle 定义的 10 列为基准）：断言 core schema.gen.ts 中 novels CREATE 的列名+默认值集合与其完全相等；断言本提案新增迁移的补列集合恰为旧 CREATE 缺失的三列（master_outline/story_spine/content_nature）；断言 core session/sql.ts 的 drizzle 定义列集合为其子集；验证：测试在定义一致时通过
- [x] 3.2 人工验证校验有效性：临时从 core 定义删掉一列运行该校验测试，断言测试失败且报错指明缺失列名，随后还原；验证：校验确实能拦截漂移

## 4. 回归确认

- [x] 4.1 全量运行 packages/core 与 packages/novel-store 测试套件；验证：全部通过
- [x] 4.2 本地运行 httpapi exerciser（packages/opennovel 下 bun run test:httpapi）；验证：coverage 与 auth 两模式均 pass=334 fail=0 且无 schema 相关失败；effect 模式因 CI 工作流已标注的 Windows bun-pty FFI 限制（仅 Linux 运行该门禁）不在本地执行

## Implementation Commits

- `024a1c77` fix(core): 对齐全局库 novels 表结构并修复迁移生成脚本 Windows 兼容
- `8442d773` test(core): 覆盖全局库 novels 补列迁移的存量与新建行为
- `2c641532` test(novel-store): 新增 novels 表结构防漂移一致性校验
