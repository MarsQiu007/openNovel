# openNovel

**AI 驱动的小说创作工作台** —— 通过 8 步写作流水线与 37 维连续性审计，规划、起草、审计并修订长篇小说。

<p>
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.en.md">English</a>
</p>

![Tests](https://img.shields.io/github/actions/workflow/status/MarsQiu007/openNovel/test.yml?style=flat-square&branch=dev)

## 截图

| 书架                                    | 工作台                                    |
| --------------------------------------- | ----------------------------------------- |
| ![书架](docs/screenshots/bookshelf.png) | ![工作台](docs/screenshots/workspace.png) |

| 阅读器                                 | 审批与评审                                          |
| -------------------------------------- | --------------------------------------------------- |
| ![阅读器](docs/screenshots/reader.png) | ![审批与评审](docs/screenshots/approval-review.png) |

## 特性

- **8 步写作流水线** —— 大纲 → 上下文组装 → 起草 → 37 维连续性审计 → 修订 → 状态提取 → 提交 → 章节推进，由 AI agent 驱动
- **37 维连续性审计** —— 每章从角色、时间线、剧情、逻辑、设定等维度评审，证据与建议按评审轮次持久化保存
- **书架** —— 一览管理多部小说的类型、简介与进度
- **创建向导** —— 引导式设定类型、世界观、角色与分卷结构
- **工作台** —— 章节树、阅读器、角色/大纲/节奏面板与全文搜索集于一处
- **版本历史** —— 每次章节修订均有存档，随时对比与回滚
- **审批流** —— 章节进入审批队列并附结构化评审详情；可批准、带批注驳回或直达证据
- **导出** —— 稿件就绪后即可导出

## 快速开始（从源码）

需要 [Bun](https://bun.sh)。

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install

# 推荐：以桌面应用方式启动（Electron，自动拉起后端，无需单独启动）
bun run dev:desktop
```

也可选择以 Web 方式在浏览器中运行：

```bash
# 一条命令同时启动后端（端口 4096）与 Web 界面（端口 4444）
bun run dev:all
# 打开 http://localhost:4444
```

打开应用后，添加项目文件夹，从书架创建你的第一部小说。

界面支持简体中文、English 与繁體中文。

## 架构

openNovel 是一个 Bun monorepo：

- `packages/novel-store` —— 核心数据层（小说、章节、角色、章节评审）
- `packages/schema` + `packages/protocol` —— 服务端与客户端共享的 API 契约
- `packages/desktop` —— Electron 桌面应用（自动拉起后端）
- `packages/opennovel` —— 后端服务与 CLI
- `packages/app` —— SolidJS Web 界面（书架、工作台、审批流）
- `packages/plugin` —— 写作流水线工具（起草、连续性审计、评审提交）

## 归属声明

openNovel 是 [opennovel](https://github.com/anomalyco/opennovel)（开源 AI 编程 agent）的 fork，专注于 AI 辅助小说创作。本项目与 opennovel 团队无关。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。保留 opennovel 原始版权声明；openNovel 贡献的版权归各自作者所有。