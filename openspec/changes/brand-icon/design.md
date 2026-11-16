# Design

## Context

现状品牌渲染面（详见 proposal.md Why）：UI 内联三组件（`packages/ui/src/components/logo.tsx` 的 Splash/Mark/Logo，分别渲染于应用加载处、新建会话视图、首页与错误页淡印背景）；资产面（`packages/identity/` master SVG+PNG、`packages/ui/src/assets/favicon/` 的 v3 系与非 v3 系两族、`packages/desktop/icons/{dev,beta,prod}` 三渠道全套、`packages/ui/src/assets/images/social-share*.png`）。`desktop/icons/README.md` 记载的 tauri 生成流程已因依赖移除而断链。

设计源已定稿：`icon-preview-tmp/v2/` 六个 SVG（mark、mark-light、app-icon、dev-icon、splash、wordmark），几何经校验（方环外 128..384 / 内孔 192..320，孔内间隙 ≥6，最细细节 ≥8）。实现时以该稿为新 master 落入正式资产位。

## Goals / Non-Goals

**Goals:**
- 单色扁平「方框藏书」master（深色立书 + 浅色孔底 + 白色书脊豁口/书口线/书签）全触点替换 opencode 方框
- favicon 两系、identity PNG、桌面三渠道、分享图全部产物由仓库内单一 bun 脚本从 master 再生成
- 三组件（Splash/Mark/Logo）按新几何重画，词标重拼 OPENNOVEL 九字母
- 清理无消费方的 desktop/icons/android、desktop/icons/ios 残留目录，修复 icons/README 断链流程

**Non-Goals:**
- 不改动 `--icon-*` 主题 token 的语义与取值体系
- 不动第三方 provider 图标（`provider/opencode.svg`）
- 不引入多色/渐变品牌体系；线上 opennovel.ai 部署不属于本设计

## Decisions

### 1. master 采用 v2「深色书立浅色孔底」反色方案
v2 在 512 大图与 16px 小图两个尺度上都是三版中书形辨识度最高的（书脊豁口 + 双书口线 + 尖尾书签清楚可读）；备选 v1（白书深孔）大图呈「L 形角标」感、书味弱，v3（圆角亲和）深底描边书形有聊天气泡误读风险，均淘汰。词标以 v2 版为准（九字母拼读清晰）；其 V 为斜笔 check 形，与块状风一致，接受远距离轻微误读。

### 2. 再生成管线：仓库根 `script/brand-icon.ts`（Bun + @resvg/resvg-js + png2icons）
- SVG→PNG 用 `@resvg/resvg-js`（Rust 渲染绑定，跨平台、无头、输出确定性），新增为根 devDependency
- ICO/ICNS 用 `png2icons`（纯 JS，多尺寸 PNG 打包 ico/icns）；Windows 端可生成 icns，替代已移除的 tauri icon + Image2Icon 手工流程
- 备选（零新增依赖）：复用 `packages/app` 已装的 Playwright 截图渲染——已在本轮预览管线验证可用，但截图管线有字体/抗锯齿不确定性，仅作兜底
- 产物矩阵在脚本内声明（favicon 两系、identity 96/192/512×深浅、三渠道 icon/dock/托盘/Windows 尺寸、分享图 1200×630），脚本校验「产物清单与声明一致」

### 3. master 落位 `packages/identity/`，favicon 两系同源零引用改动
v2 设计稿直接成为新 master：`identity/mark.svg`、`identity/mark-light.svg` 替换；favicon v3 系与非 v3 系由同一 master 产出不改名（`index.html`、`favicon.tsx`、`site.webmanifest`、`layout/helpers.ts:98` 的线上 URL 引用均零改动，`packages/app/public` 符号链接随源生效）。

### 4. logo.tsx 三组件按 v2 几何重画
- Splash：viewBox 80×100，页顶向书脊下倾的摊开书形（v2 splash 几何），无顶梁
- Mark：viewBox 16×20 小标，孔内书形简化为剪影（小尺度细节省略）
- Logo：viewBox 264×42（9 字母 × 24 宽 + 6 间距），保留 `--icon-weak-base`/`--icon-base`/`--icon-strong-base` 三 token 强弱双色机制，字母 path 按 v2 wordmark 几何转写为 token 色
- stories 同步更新

### 5. 桌面渠道变体与残留清理
dev 渠道 = 蓝图蓝底 + 浅色网格 + 全白图形（v2 dev-icon 版式）；beta/prod 维持现行渠道底色（深底），仅换图形。`desktop/icons/android/mipmap-*`、`desktop/icons/ios/AppIcon-*` 无 Electron 消费方，随本变更删除（关联面穷举：electron-builder 配置仅引用 icon.png/icon.ico/icon.icns/32x32/dock/Square*/StoreLogo）。

### 6. 分享图重画
social-share.png / social-share-zen.png 重画为 1200×630：深底 + 方框藏书 + OPENNOVEL 词标排版（zen 变体为浅色版式），og/twitter image 引用零改动。

## Risks / Trade-offs

- [Windows 端 png2icons 生成的 icon.icns 在 mac 打包中显示异常] → 打包后人工核验 Dock/安装器图标；README 保留 Image2Icon 人工修复作为兜底路径
- [16-32px 托盘小图标真机辨识度不足] → 实现阶段在 dev 环境直接截图取证（Windows 任务栏/托盘）；必要时按真机观感微调书口线粗细
- [新增 devDependency（resvg/resvg-js、png2icons）] → 均为成熟纯绑定库，仅脚本使用，不进任何运行时依赖图
- [favicon.ico 封装尺寸不全导致旧浏览器模糊] → ico 内封装 16/32/48 三尺寸 PNG

## Migration Plan

1. 实现合入后本地 dev 启动即见新图标（任务栏/托盘/Dock/标签页）
2. 三渠道各打一次包验证安装器与系统入口图标
3. 线上 `opennovel.ai/favicon.svg` 需用户同步部署（非代码动作，proposal 已记）
4. 回滚：纯资产替换无数据迁移，`git revert` 即恢复原品牌

## Open Questions

无。
