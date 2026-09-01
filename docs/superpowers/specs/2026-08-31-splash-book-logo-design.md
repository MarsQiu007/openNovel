# Splash Logo 替换为打开的书

## 背景

当前桌面端启动时，Loading 遮罩中央显示的是一个风格化的字母 "O"（`<Splash />` 组件）。用户反馈这个 "O" 与 opencode 桌面版启动过程过于相似，希望替换为与 openNovel 产品定位更相关的视觉符号。

## 目标

将 `packages/ui/src/components/logo.tsx` 中的 `Splash` 组件从 "O" 形 SVG 替换为风格化的「打开的书」SVG，使启动 Loading 页和连接错误页的图标与小说/阅读/写作的产品意象一致。

## 范围

- **修改**：`packages/ui/src/components/logo.tsx` 中的 `Splash` 组件
- **不修改**：
  - `Mark` 组件（小号 "O" 标志）
  - `Logo` 组件（带 "openNovel" 文字的完整 logo）
  - favicon / apple-touch-icon / social-share 图片
  - `packages/app/src/app.tsx` 中的调用代码

## 设计方案

### 视觉风格

延续现有 `Splash` 的**几何方块风格**：

- 使用矩形和直线路径拼出图形
- 不使用曲线、渐变或复杂描边
- 保持 `viewBox="0 0 80 100"`，与现有 `Splash` 尺寸一致
- 使用现有 CSS 变量着色：
  - `--icon-base`：书页主体
  - `--icon-strong-base`：书脊、顶部厚度线

### SVG 结构

```svg
<svg
  viewBox="0 0 80 100"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <!-- 左页 -->
  <rect x="8" y="15" width="32" height="70" fill="var(--icon-base)" />
  <!-- 右页 -->
  <rect x="40" y="15" width="32" height="70" fill="var(--icon-base)" />
  <!-- 中间书脊 / 折痕 -->
  <rect x="36" y="15" width="8" height="70" fill="var(--icon-strong-base)" />
  <!-- 顶部书页厚度 -->
  <rect x="8" y="12" width="64" height="6" fill="var(--icon-strong-base)" />
</svg>
```

### 使用位置

`Splash` 组件被以下两处使用，替换后会同时更新：

1. `packages/app/src/app.tsx:480` —— 启动 Loading 遮罩
2. `packages/app/src/app.tsx:503` —— 服务器连接错误页

## 实现方式

直接替换 `Splash` 组件的 JSX 内容，保持组件 props 接口不变：

```tsx
export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="8" y="15" width="32" height="70" fill="var(--icon-base)" />
      <rect x="40" y="15" width="32" height="70" fill="var(--icon-base)" />
      <rect x="36" y="15" width="8" height="70" fill="var(--icon-strong-base)" />
      <rect x="8" y="12" width="64" height="6" fill="var(--icon-strong-base)" />
    </svg>
  )
}
```

## 验收标准

- [ ] 启动应用时，Loading 页中央显示「打开的书」图标，不再是 "O"
- [ ] 图标在不同主题（light/dark）下颜色正确跟随 `--icon-base` / `--icon-strong-base`
- [ ] 服务器连接错误页中的图标也同步更新
- [ ] `Mark` 和 `Logo` 保持原样不变
- [ ] `packages/ui` 的类型检查和 `packages/app` 的构建通过

## 风险与回滚

- 风险较低：仅替换单个 SVG 组件，无业务逻辑变更
- 回滚方式：恢复 `packages/ui/src/components/logo.tsx` 中 `Splash` 的历史 SVG 路径即可
