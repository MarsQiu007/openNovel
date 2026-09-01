# Splash Logo 替换为打开的书 - Implementation Plan

> **For agentic workers:** REQUIRED SUB-LEVEL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/ui/src/components/logo.tsx` 中的 `Splash` 组件从 "O" 形 SVG 替换为风格化的「打开的书」SVG。

**Architecture:** 仅修改单个纯展示组件的 SVG 路径，保持组件 props 接口和调用位置不变。新 SVG 使用与现有 `Splash` 相同的 `viewBox` 和 CSS 颜色变量，确保主题切换和启动页/错误页的样式一致。

**Tech Stack:** SolidJS, SVG, TypeScript, Storybook (用于视觉验证), Bun (类型检查)

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/ui/src/components/logo.tsx` | 修改 | 替换 `Splash` 组件内部的 SVG 路径 |
| `packages/ui/src/components/logo.stories.tsx` | 不修改 | Story 已经展示了 `Splash`，无需调整 |

---

## Task 1: 替换 `Splash` SVG

**Files:**
- Modify: `packages/ui/src/components/logo.tsx:18-32`

- [ ] **Step 1: 打开 `packages/ui/src/components/logo.tsx`，定位到 `Splash` 组件**

当前代码（待替换）：
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
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}
```

- [ ] **Step 2: 将 `Splash` 组件的 SVG 内容替换为打开的书**

替换后的完整组件：
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

- [ ] **Step 3: 保存文件并运行类型检查**

Run:
```bash
cd packages/ui && bun run typecheck
```

Expected: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/components/logo.tsx
git commit -m "feat(ui): 启动 Splash 图标从 O 替换为打开的书"
```

---

## Task 2: 视觉验证

**Files:**
- 查看：Storybook 中的 `UI/Logo` 故事
- 查看：`packages/app/src/app.tsx:480` 和 `packages/app/src/app.tsx:503` 的调用位置

- [ ] **Step 1: 启动 dev server 查看 `Splash` 渲染效果**

在 `packages/app` 中启动 dev server：
```bash
cd packages/app && bun run dev
```

Expected: 启动 Loading 页中央显示「打开的书」图标，不再是 "O"。

- [ ] **Step 2: 验证连接错误页（可选）**

临时停止本地 server 或修改 server URL 至无效地址，刷新应用，确认连接错误页中的 `Splash` 也显示为打开的书。

- [ ] **Step 3: 验证主题切换**

在 light/dark 主题间切换，确认图标颜色跟随 `--icon-base` 和 `--icon-strong-base` 变化。

- [ ] **Step 4: 提交验证截图或备注（可选）**

如需保留验证记录，可将截图放入 `docs/screenshots/` 并在 commit message 中说明。

---

## 验收检查清单

- [ ] `packages/ui/src/components/logo.tsx` 中的 `Splash` 使用新的打开的书 SVG
- [ ] `Mark` 和 `Logo` 组件未被修改
- [ ] `packages/ui` 类型检查通过
- [ ] `packages/app` 能正常启动，Loading 页显示新书图标
- [ ] 连接错误页中的图标也同步更新
- [ ] 图标颜色随主题正确变化

---

## 回滚方式

如需回滚，恢复 `packages/ui/src/components/logo.tsx` 中 `Splash` 的历史 SVG 路径即可。
