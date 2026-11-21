# Tasks

## 1. 数据清理与存储单源

- [ ] 1.1 在 novel-store 增加幂等的旧全局库清理入口，覆盖数据库与 SQLite sidecar 文件，并用临时目录测试验证旧库文件被删除、书籍库数据不变
- [ ] 1.2 删除全局库表 SQL、连接入口与路径导出，将技法数据访问收敛到当前书籍库，并在 `packages/novel-store` 通过聚焦测试与 `bun typecheck`

## 2. Plugin 写作链路单源

- [ ] 2.1 从 plugin 技法存储、召回、列表、反馈、确认、转正和固化中移除库路由与来源标记，并更新聚焦测试验证所有操作只命中本书库
- [ ] 2.2 将提取入库、种子导入、层级重分类与对话学习保存统一到当前书籍库，移除全局库/双源选项，并用 `packages/plugin` 聚焦测试验证新技法不进入全局路径
- [ ] 2.3 更新技法工具描述与 director/auditor/pipeline 提示词中的全局库措辞，运行提示词对齐测试确认不再出现跨库路由语义

## 3. 协议、服务与 SDK

- [ ] 3.1 从技法协议与 schema 中移除 `library`、`targetLibrary` 与共享 LocationQuery 的技法库范围字段，并把 scope 描述改为内容性质语义
- [ ] 3.2 将 server 技法 handler 改为只读写本书库，移除双库查找、scope 归库映射与跨库迁移，并在 `packages/server` 运行技法聚焦测试
- [ ] 3.3 在 `packages/client` 运行 `bun run generate`，确认生成产物与单源契约一致且没有手改生成文件

## 4. 云同步退役清理

- [ ] 4.1 从同步计划与状态中移除 `@library` 普通同步单元、快照恢复与删除保护逻辑，并用 `packages/core` 测试确认状态列表不出现该单元
- [ ] 4.2 实现同步运行时的远端 `@library` 与旧登记清理，测试验证远端单元被删除、书籍库项目照常处理且清理失败可重试

## 5. 界面与展示

- [ ] 5.1 更新技法面板的列表筛选、来源徽标、创建表单与受限分级说明，移除归属库选择和跨库归位文案，并通过 `packages/app` typecheck 与 oxlint
- [ ] 5.2 移除同步设置对 `@library` 的显示名与状态处理，并用 grep 确认技法/同步 UI 不再暴露全局库来源

## 6. 集成验证

- [ ] 6.1 在 `packages/opennovel` 运行 HttpApi exercise coverage 模式，验证技法端点单源语义、无全局参数，且既有相关端点不回归
- [ ] 6.2 在 novel-store、plugin、server、core 与 app 对应包目录运行受影响测试，确认全部通过
- [ ] 6.3 在仓库根运行 `bun turbo typecheck` 与 `bun run lint`，确认全量类型检查与 lint 通过
- [ ] 6.4 全仓审计 `getGlobalDb`、`globalDbPath`、`TechniqueLibrary`、`@library`、`targetLibrary` 与技法全局库文案引用，删除残留死代码或在提交说明中登记确需保留的非运行时引用
