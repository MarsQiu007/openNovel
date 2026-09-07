## 1. 空会话初始化入口

- [x] 1.1 在书内空会话中根据零角色、零世界观状态优先展示初始化建议
- [x] 1.2 组装包含书名、类型、简介的初始化提示词，并通过现有创建/绑定会话流程发送
- [x] 1.3 添加测试覆盖零设定优先展示、已有设定不展示和提示词包含书籍上下文

## 2. 首章零设定防护

- [x] 2.1 在 `write_chapter` 中加入第一章、空正文、零角色、零世界观条件的拒绝分支
- [x] 2.2 返回明确提示和结构化元数据，引导先初始化小说设定
- [x] 2.3 添加测试覆盖裸首章拒绝、已有设定放行、已有正文放行和非首章放行

## 3. 质量收尾

- [x] 3.1 在 `packages/app` 和 `packages/plugin` 运行 typecheck 和相关测试
- [x] 3.2 运行全仓 typecheck 和根目录 oxlint
- [x] 3.3 运行 `openspec validate novel-book-bootstrap`
## Implementation Commits

- `773f3d27c` docs(openspec): 细化新书初始化衔接
- `14dcde251` feat(app): 优先建议初始化小说设定
- `938b8d8fe` feat(plugin): 阻止零设定裸写首章
