# 任务

- [x] 1. 修复 bootstrap.test.ts（2 处 v2 mock 加 session.active）
- [x] 2. 修复 workspace-data.test.ts（session mock 改为 v2.session 结构）
- [x] 3. 本地验证两个测试文件通过（本地有 jsxDEV 环境限制，CI 验证）
- [x] 4. 提交并推送，确认 CI 恢复

## 实施提交

- `822520a544` docs(openspec): 建立 fix-app-test-mocks-v2-session 提案（含测试修复）
- `d479809f04` test(app): 补 v2.permission/question mock 修正 create 返回结构
- `22cf4cd75f` test(app): 修正 session.active mock 数据与 prompt 参数结构
- `5bf379e932` test(app): 补 session.get mock 修正 list 返回嵌套结构

## 备注

CI 上 app#test 的 bootstrap 和 workspace-data 用例已全部通过。剩余 BrowserTool 7 个失败是 core 包 headless Chromium 在 CI 环境缺浏览器二进制（`Executable doesn't exist`），与本次修复无关，属既有 CI 环境问题。
