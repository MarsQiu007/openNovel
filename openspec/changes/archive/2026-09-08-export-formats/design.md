## Context

当前导出端点返回 JSON 中的 Markdown 字符串，前端用 Blob 下载。小说数据库没有作者字段；卷、章节、正文和顺序信息已足够构建 TXT 和 EPUB。EPUB 本质上是一个带固定结构文件的 ZIP 容器，可以先复用仓库已有的 ZIP 能力，避免引入大型排版依赖。

## Goals / Non-Goals

**Goals:**

- 扩展现有导出端点，支持 Markdown、EPUB 和 TXT 三种格式。
- 保持现有卷/章顺序和孤儿章兜底逻辑。
- 用轻量 XHTML/OPF/NAV 结构生成 EPUB 3，不引入 DOCX/PDF 或模板定制。

**Non-Goals:**

- 不新增作者字段，也不迁移数据库。
- 不支持封面图片、字体嵌入、CSS 模板选择或发布平台对接。
- 不改变正文编辑器的存储格式。

## Decisions

### D1: 在现有导出端点增加 format 查询参数

保留 `GET /novels/:novelID/export`，新增可选 `format` 参数，取值 `markdown`、`epub`、`txt`，缺省仍为 `markdown`。导出响应增加 `encoding` 字段：文本格式返回 `utf8`，EPUB 返回 `base64`。

这比为三种格式建三个端点更简单，也保证旧调用不传 format 时行为不变。协议 schema 和客户端 SDK 需要同步更新。

### D2: 使用 @zip.js/zip.js 生成 EPUB

服务端复用仓库已在桌面日志和 CLI 依赖中使用的 `@zip.js/zip.js`，把该依赖加入 `packages/server`。不选择 epub-gen 类库，因为本提案只需要基础成书结构，不需要模板引擎和额外依赖。

EPUB 容器写入：

- 首个未压缩 `mimetype` 条目，值为 `application/epub+zip`。
- `META-INF/container.xml` 指向 OPF。
- EPUB 3 的 `content.opf`、`nav.xhtml`，以及兼容旧阅读器的 `toc.ncx`。
- 每个有正文章节一个 XHTML 文件。

### D3: 元数据与正文转换规则

书籍元数据包含书名、语言 `zh-CN`、唯一标识和时间戳；数据库没有作者字段时写入“未知作者”。章节正文按空行分段并转义 XHTML 特殊字符，避免把纯文本误当作 HTML。

Markdown/TXT 使用同一份卷、章、正文排序结果。Markdown 保留现有标题层级；TXT 去掉 Markdown 标记，使用普通文本行和空行分隔。

### D4: 前端选择格式并按编码下载

导出按钮前增加格式选择。文本格式用 UTF-8 Blob 下载；EPUB 先把 Base64 转成二进制 Blob，再使用 `application/epub+zip` 下载。该提案不改 i18n locale 文件，新增控件文案暂用组件内简体中文常量。

## Risks / Trade-offs

- [EPUB 阅读器兼容性差异] → 遵循 EPUB 3 基础结构和导航文件，并额外提供 NCX 兼容旧阅读器。
- [Base64 会增大 JSON 响应体积] → 书籍导出是低频操作，且后续可改为二进制响应；本提案优先保持协议实现简单。
- [复杂 Markdown 正文转换失真] → 当前正文按纯文本分段处理；富文本或 Markdown 精细排版留到后续提案。

## Migration Plan

1. 更新协议 schema 和导出端点，重新生成 SDK。
2. 服务端添加 ZIP 依赖和格式化导出实现。
3. 前端增加格式选择和下载处理。
4. 添加导出单元测试，覆盖 Markdown、TXT、EPUB、孤儿章和空章。
5. 回滚方式是还原导出端点扩展；旧 Markdown 导出保持可用。

## Open Questions

（无。）