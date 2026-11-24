# Design

## 数据源策略

加载顺序：远端 `CHANGELOG_URL` → 内置快照 → 静默跳过。内置快照在构建期由既有 changelog 生成命令产出（同一机械降级产物），打进 app 构建产物；桌面端直接随 bundle 分发。

## 改动点

1. 构建脚本：生成（或复用发布流水线产物）changelog 快照 JSON，输出到 packages/app 静态资源目录；构建缺失快照时跳过（开发环境不阻塞）。
2. packages/app/src/context/highlights.tsx：fetch 失败/非 2xx 时读取内置快照（静态 import 或 fetch 本地资源），复用 loadReleaseHighlights；远端成功时结果优先。
3. 不新增第二个解析器；快照格式与远端一致。

## 权衡

- 备选「只修站点部署」被否：站点部署不在本仓库控制面内，且离线环境永远需要兜底。
- 快照按最近若干个版本裁剪，控制 bundle 体积。

## 测试策略

- app 包单测：远端 404 时回退内置快照并能解析出亮点；远端成功时不读快照；两者皆失败时静默。
- app 包 typecheck + oxlint；桌面构建后人工确认弹窗可出现。