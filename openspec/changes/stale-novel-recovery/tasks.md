# Tasks

## 1. 自愈语义

- [x] 1.1 书籍详情查询 NotFound 分支：清除当前书籍引用与按书存档键，回落空态
- [x] 1.2 for-session 查询 NotFound 分支：按无绑定返回 null，不设错误
- [x] 1.3 非 404 错误行为回归保持不变

## 2. 验证

- [x] 2.1 app 包单测覆盖三类分支
- [x] 2.2 packages/app 目录 bun typecheck 与 oxlint 通过
- [ ] 2.3 人工冒烟：删除小说后重进应用，不再出现重复 404 请求与错误提示