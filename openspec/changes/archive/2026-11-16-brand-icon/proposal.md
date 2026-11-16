# Proposal

## Why

openNovel 是 openCode 的 fork，但全部品牌视觉资产（应用图标、favicon、启动图形、词标、社交分享图）仍沿用 opencode 的方框 logo 与 OPENCODE 词标——桌面 Dock/任务栏、浏览器标签页、PWA 安装图标、og 分享图上展示的都是上游品牌，与「AI 长篇小说创作工作台」的产品身份不符，且词标组件在首页/错误页以 path 逐字母拼出 "OPENCODE"，是用户可见的品牌残留。需要一次完整的品牌图标替换。

## What Changes

- **新品牌 master「方框藏书」**：保留 opencode 白色方环几何基因（512 画布，外环 128..384、内孔 192..320），孔内为一本白色立书——深色书脊豁口 + 深色双书口线 + 深色尖尾小书签；单色扁平（#131010 / #FFFFFF / #5A5858），16px 下仍保持「方框 + 书」辨识度
- **packages/identity 更新**：mark.svg / mark-light.svg（反色版）替换为 v2 设计稿，配套 mark PNG（96/192/512、含 light）由再生成脚本导出
- **favicon 族脚本化再生成**：packages/ui/src/assets/favicon 下 v3 系（index.html 引用）与非 v3 系（site.webmanifest、线上项目图标 URL 引用）全部由仓库内 bun 脚本从新 master 一键产出（svg/ico/96x96/192/512/apple-touch），替换已断链的手工 tauri 流程
- **UI 内联标识组件改造**（packages/ui/src/components/logo.tsx）：Splash 改为页顶向书脊下倾的摊开书形（viewBox 80×100）；Mark 小标孔内藏书；Logo 词标重拼为 OPENNOVEL 九字母块状像素风（viewBox 264×42，保留 --icon-* CSS 变量强弱双色机制），同步更新 stories
- **桌面图标三渠道全套**（packages/desktop/icons/{dev,beta,prod}）：icon.png / icon.ico / icon.icns、dock.png、32x32.png（托盘/Linux）、Windows Square*/StoreLogo 全部由新设计再生成；dev 渠道保留蓝图蓝底 + 网格的渠道区分体系
- **残留清理**：删除 desktop/icons 下无消费方的 android/mipmap-*、ios/AppIcon-* 目录（Electron 打包不引用）；改写 icons/README.md 的 tauri 流程为脚本流程
- **分享图重画**：social-share.png / social-share-zen.png 重画为 openNovel 品牌版（index.html og:image / twitter:image 引用）

## Capabilities

### New Capabilities

- `brand-identity`: openNovel 品牌视觉标识——master 图标、反色版、启动图形、词标、渠道变体，以及 favicon/桌面图标/分享图等派生资产的呈现行为与脚本化再生成管线

### Modified Capabilities

（无——现有 spec 无品牌标识相关 capability，本次为新增）

## Impact

- **受影响包**：`packages/identity`（master 资产）、`packages/ui`（favicon 资产 + logo.tsx 组件 + stories）、`packages/app`（public 符号链接指向的 favicon 产物随源更新）、`packages/desktop`（icons 三渠道 + icons/README）
- **不受影响**：协议 / Schema / Server HttpApi（无需 regenerate SDK）、数据模型与本地数据（纯资产替换，无持久化变更）、运行时依赖图
- **关联面**：packages/app/src/pages/layout/helpers.ts:98 引用线上 `https://opennovel.ai/favicon.svg` 作为 openNovel 项目图标——代码不改，但线上域名需随发布同步更新 favicon；packages/app/public 下 favicon 符号链接指向 ui 资产，源更新即生效，无需改链接
- **CI**：generate / typecheck / test 无新增面；favicon 与桌面图标为构建期静态产物
- **风险**：icon.icns 需在 Windows 端脚本生成并验证 electron-builder 打包后 mac 图标正常；Electron 托盘 16px 级小图标辨识度需在真机确认

## 非目标

- 不改动第三方 provider 图标（`ui/src/assets/icons/provider/opencode.svg` 是上游服务商图标，保留）
- 不改产品名、包名、应用标识符（`ai.opennovel.desktop` 等保持不变）
- 不引入多色/渐变品牌体系，不设计 UI 主题色（`--icon-*` token 语义不变）
- opennovel.ai 线上 favicon 的部署不在本变更范围内（仅记录需同步）
- 不重绘 packages/app/src/assets/help/ 下的功能截图
