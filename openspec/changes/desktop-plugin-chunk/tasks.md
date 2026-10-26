# Tasks

## 1. electron.vite.config.ts：插件 input

- [x] 1.1 引入 `../opennovel/script/bundled-plugins` 清单；`rollupOptions.input` 在 index/sidecar 外追加生成项（键 = chunk 去 `./` 与 `.js`，值 = `"../opennovel/" + wrapper`）
- [x] 1.2 保持既有 entryFileNames/chunkFileNames 与插件不变，确认输出落位 `out/main/plugin-bundle/novel-writer-v2.js`

## 2. 守门与收尾

- [x] 2.1 桌面 `bun run build`（或主进程构建）产出断言：chunk 落位 + 共享 chunk 存在 + sidecar.js 烘焙映射值与路径一致；根 `bunx oxlint` 0 errors
- [ ] 2.2 `openspec validate --strict`、收集实施提交、归档、合并 main（不推送）；通知用户重启 dev:desktop 验收

## Implementation Commits

- `cc9071ebe` feat(desktop): 主构建并入第一方插件 chunk 同构建 code splitting
