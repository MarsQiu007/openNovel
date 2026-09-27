# Tasks

- [x] 1.0 修复升级横幅无效 token 类名
  - [x] 1.1 横幅容器 `bg-v2-background-bg-secondary` → `bg-v2-background-bg-layer-01`
  - [x] 1.2 确认弹窗 `bg-v2-background-bg-primary` → `bg-v2-background-bg-base`
  - [x] 1.3 失败计数 `text-v2-text-text-error` → `text-v2-state-fg-danger`
  - [x] 1.4 替换后类名在 theme.css 均有变量定义、旧类名零残留；`bun run typecheck`（packages/app）通过
