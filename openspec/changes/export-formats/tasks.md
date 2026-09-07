## 1. 协议与客户端

- [x] 1.1 定义导出格式枚举和响应编码字段，并为导出端点增加可选 `format` 参数；通过 `openspec validate export-formats --type change`
- [x] 1.2 在 `packages/client` 运行 `bun run generate`，确认 SDK 再生成无手改产物并通过 `bun typecheck`

## 2. 服务端导出

- [x] 2.1 为 `packages/server` 添加 ZIP 打包依赖并验证依赖解析成功
- [x] 2.2 实现导出内容收集与 Markdown/TXT/EPUB 格式化，保持卷/章顺序、孤儿章追加、空章跳过和未知作者占位；通过服务端单元测试验证
- [x] 2.3 在导出处理器中注册格式参数，并验证不存在的小说仍返回未找到错误；在 `packages/server` 通过 `bun typecheck` 与测试

## 3. 工作台导出

- [x] 3.1 扩展导出 mutation，把格式参数传给服务端并保留原有错误处理；通过 `packages/app` 的 `bun typecheck`
- [x] 3.2 在工作台导出入口增加格式选择，并按 UTF-8 或 Base64 生成对应 Blob 下载；通过应用单元测试或类型化渲染检查
- [x] 3.3 验证 Markdown、EPUB、TXT 下载文件名和 MIME 类型正确；在 `packages/app` 通过 `bun typecheck` 与相关测试

## 4. 质量收尾

- [x] 4.1 在 `packages/server`、`packages/client` 和 `packages/app` 通过相关测试与 `bun typecheck`
- [x] 4.2 在仓库根目录通过 `bun run typecheck` 和 `bun run lint`
- [x] 4.3 通过 `openspec validate export-formats --type change`