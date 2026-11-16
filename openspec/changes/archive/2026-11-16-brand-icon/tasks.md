# Tasks

## 1. master 落位与再生成脚本

- [x] 1.1 在仓库根 `package.json` 新增 devDependencies `@resvg/resvg-js` 与 `png2icons` 并安装，验证 Bun 可导入（写一个最小渲染 smoke 确认 resvg 出 PNG、png2icons 出 ico/icns Buffer）
- [x] 1.2 将 `icon-preview-tmp/v2/` 设计稿落入正式资产位：`packages/identity/mark.svg` 与 `mark-light.svg` 替换为 v2 几何，核对方环外 128..384 / 内孔 192..320、孔内间隙 ≥6、最细细节 ≥8
- [x] 1.3 编写仓库根 `script/brand-icon.ts`：单一入口再生成脚本，内声明产物矩阵（identity PNG、favicon 两系、桌面三渠道、分享图），每类产物生成后断言文件存在且非空，产物清单与声明一致（无遗漏、无多余）
- [x] 1.4 运行脚本产出 `packages/identity/` 全部 PNG（mark 96/192/512、mark-light 96/192/512），验证尺寸与色值正确

## 2. Web favicon 族

- [x] 2.1 扩展脚本生成 favicon 两系产物（v3 系：favicon-v3.svg/ico/96/apple-touch-v3；非 v3 系：favicon.svg/ico/96/apple-touch/web-app-manifest-192/512 + site.webmanifest 引用的 maskable 图），全部替换 `packages/ui/src/assets/favicon/` 下旧 opencode 产物；favicon.ico 内封装 16/32/48 三尺寸
- [x] 2.2 验证 `packages/app/public` 符号链接与 `index.html`、`favicon.tsx`、`site.webmanifest` 引用零改动生效：构建 `packages/app` 后检查 dist 下 favicon 产物为新图形（浏览器/截图取证）

## 3. UI 内联标识组件

- [x] 3.1 按 v2 几何重画 `packages/ui/src/components/logo.tsx`：Splash 为页顶向书脊下倾摊开书形（80×100）、Mark 为孔内藏书小标（16×20）、Logo 为 OPENNOVEL 九字母词标（264×42），三组件保留 `--icon-weak-base`/`--icon-base`/`--icon-strong-base` token 双色机制，不得硬编码色值
- [x] 3.2 更新 `logo.stories.tsx` 展示三组件新图形
- [x] 3.3 在 `packages/ui` 通过 `bun typecheck` 与 oxlint，运行 ui 组件测试确认无回归；同时检查无新增无人引用的导出

## 4. 桌面图标三渠道

- [x] 4.1 扩展脚本生成三渠道产物（dev/beta/prod：icon.png 512、icon.ico 多尺寸、icon.icns、dock.png、32x32.png、Windows Square30/44/71/89/107/142/150/284/310 与 StoreLogo），全部替换 `packages/desktop/icons/` 下旧产物；dev 渠道为蓝图蓝底 + 浅色网格 + 全白图形，beta/prod 深底
- [x] 4.2 删除 `packages/desktop/icons/android/` 与 `packages/desktop/icons/ios/` 残留目录，全仓 grep 确认无任何构建脚本/配置引用（含 electron-builder 配置与 CI 清单）
- [x] 4.3 改写 `packages/desktop/icons/README.md`：删除已断链的 tauri 流程，改为 `script/brand-icon.ts` 一键再生成说明，保留 Image2Icon 修复 mac 图标的兜底路径说明
- [x] 4.4 在 `packages/desktop` 通过 `bun typecheck`，运行 `copy-icons.ts` 三渠道各一次确认 `resources/icons` 拷贝链路正常

## 5. 社交分享图

- [x] 5.1 重画 `packages/ui/src/assets/images/social-share.png` 与 `social-share-zen.png`（1200×630）：深底/浅底版式 + 方框藏书图形 + OPENNOVEL 词标排版，不含 opencode 品牌元素；验证 index.html og:image 引用零改动生效

## 6. 全面验证与收尾

- [x] 6.1 关联面穷举：全仓 grep `OPENCODE` 逐字母词标残留、favicon 旧图形引用、`social-share` 旧图引用，确认清零；确认 `packages/ui/src/assets/icons/provider/opencode.svg` 作为第三方 provider 图标被保留且未误删
- [x] 6.2 渲染效果自验：用脚本/playwright 生成 master 与各产物预览图，比对 512 大图与 16/32px 小图辨识度符合 design 决策 1
- [x] 6.3 CI 等价预跑：受影响包（ui/app/desktop）全量 `bun test` + 仓库根 `bun turbo typecheck` 全量通过；本变更不触碰 Protocol/Schema/HttpApi，无需 regenerate SDK（grep 自查确认未改契约文件）
- [x] 6.4 清理 `icon-preview-tmp/` 临时目录与渲染脚手架，确认 git status 无残留临时文件

## Workflow follow-up

- 实现提交全部带 `OpenSpec-Change: brand-icon` footer；用 `git log --grep` 收集实现提交写入本文件 `## Implementation Commits`
- 完成后顺序：openspec validate brand-icon --strict → sync specs → archive → 更新 main → 合并 → 清理分支

## Implementation Commits

- `f25dee47e6` chore(deps): 新增 resvg-js 与 png2icons 品牌图标管线依赖
- `762256c785` feat(identity): 落地 v2 方框藏书 master artwork 与再生成脚本
- `e7177c5ad1` feat(ui): 由新 master 再生成 favicon 两系与社交分享图
- `706e8d91ba` feat(ui): 重画内联品牌组件为方框藏书与 OPENNOVEL 词标
- `3524208bd6` feat(desktop): 再生成三渠道图标并清理无消费方移动端目录

## 验证记录

- 仓库根 `bun turbo typecheck` 31/31 通过；desktop 115 测试全过；ui/app 失败均为本机 bun 1.4.3 solid-js `jsxDEV` 环境回归（干净树复现同款报错，与本变更无关），CI bun 1.3.14 正常
- `packages/app` 构建通过，dist favicon 产物确认为新 artwork
- `script/brand-icon.ts` oxlint 0 警告 0 错误
