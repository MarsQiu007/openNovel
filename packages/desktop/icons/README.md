# 应用图标

全部图标由仓库根脚本从 `packages/identity/` 的品牌 artwork 一键再生成：

```bash
bun run script/brand-icon.ts
```

artwork 共 6 个 SVG：`mark`（深底 master）、`mark-light`（透明底反色）、`app-icon`（prod 圆角版式）、`beta-icon`（浅色渠道）、`dev-icon`（蓝图渠道）、`wordmark`（OPENNOVEL 词标）。脚本内置几何一致性断言：修改 master 几何时必须同步全部布局 artwork，否则再生成会失败。

三渠道位于 `icons/{prod,beta,dev}/`：`prod` 深底、`beta` 近白底、`dev` 蓝图蓝底 + 网格。`scripts/copy-icons.ts` 在 predev/prebuild 时把当前渠道拷到 `resources/icons/`。

macOS 说明：脚本经 png2icons 生成的 `icon.icns` 不带 Big Sur 阴影/内边距，若打包后图标观感偏大，可用 Image2Icon 的 'Big Sur Icon' 预设从该渠道 `icon.png` 重新生成 `icon.icns` 覆盖；覆盖后需同步更新 `dock.png`（取 icns 内 `icon_128x128@2x`）。
