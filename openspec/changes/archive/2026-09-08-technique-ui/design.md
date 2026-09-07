## Context

技法三张表已经存在，plugin 侧也有提取、shadow 检索、反馈和注入开关读取逻辑；但 server 没有技法管理 API，app 没有技法面板。现有 `readNovelConfig` 只处理写作模式字段，`writeNovelConfig` 会重建配置对象，因此不能直接用于技法注入开关。小说数据主要由 `novel-store` 持有，`server` 已经依赖该包并使用 Location 中间件解析项目根目录。

## Goals / Non-Goals

**Goals:**

- 为技法库提供稳定的管理 API，覆盖列表、详情、创建、更新、删除和反馈查询。
- 在书籍工作台右栏增加技法库面板，复用现有面板布局和查询缓存模式。
- 为技法注入开关提供只修改该字段的读写 API，不破坏 `.novel/config.json` 中的其他字段。

**Non-Goals:**

- 不修改技法提取、贝叶斯置信度、shadow 记录或注入裁剪算法。
- 不新增 agent 检索工具；写作管线已有的技法检索继续保留。
- 不把向量大字段暴露给前端，也不为 UI 引入全文检索新依赖。

## Decisions

### 1. 契约放在独立技法协议组

新增 `TechniqueGroup` 和 `server.technique` handler，路径使用 `/api/techniques`，成功/错误模型放在 `schema/technique`。相比把端点继续塞进 `NovelGroup`，这能避免 NovelGroup 继续膨胀，也让技法库和技法注入边界一致。

### 2. 数据访问落在 novel-store

在 `novel-store` 增加技法管理读取/写入函数，服务端 handler 只做协议字段与 store 数据映射。plugin 现有 `technique-store` 继续服务写作管线；不要让 server 反向依赖 plugin。创建/更新使用服务端生成时间、UUID 和默认值，confidence 由既有反馈算法维护，UI 不直接编辑 confidence。

### 3. 列表返回轻量技法，详情返回反馈

列表和详情都排除 `embedding`。详情额外返回反馈记录；后续如果库规模显著增长，可在 API 层增加分页或服务端筛选，UI 初版先用关键词和枚举筛选本地结果。

### 4. 注入开关使用专用配置函数

在 `novel-store` 增加 `readTechniqueInjection` / `writeTechniqueInjection`，读取时仅把 `true` 视为开启，写入时备份、fsync 并保留既有 JSON 字段。plugin 的开关读取改为复用该共享函数，避免服务端和插件产生两套配置语义。

### 5. 前端接入右栏随行面板

在 `RAIL_PANELS` 增加 `techniques`，新增 `PanelTechniques`。组件内使用中文常量文案，不修改 i18n locale。面板采用列表/详情两级视图，表单校验缺失必填字段时不发起请求。

### 6. SDK 由生成器更新

协议和 handler 完成后，在 `packages/client` 运行 `bun run generate`。禁止手写 generated client 文件；前端查询函数引用生成后的 client 方法。

## Risks / Trade-offs

- [技法库规模增大后前端本地筛选变慢] → 初版接受；协议已保留服务端筛选扩展点，后续可加分页。
- [配置文件被外部破坏] → 开关读取降级为关闭，写入前备份并在解析失败时拒绝覆盖。
- [删除技法会同时清理反馈记录] → 删除前使用现有确认对话框提示；这是避免孤儿反馈继续出现在其他界面。
- [HttpApi 生成结果较大] → 独立协议组仍比改大 NovelGroup 更易维护；生成器必须执行，不手改。