# openNovel

**AI 驱动的长篇小说创作工作台** —— 以 8 步写作流水线与 37 维连续性审计，规划、起草、审计并修订长篇小说。桌面端优先，数据全部本地存储。

<p>
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.en.md">English</a>
</p>

![Tests](https://img.shields.io/github/actions/workflow/status/MarsQiu007/openNovel/test.yml?style=flat-square&branch=dev)
![License](https://img.shields.io/github/license/MarsQiu007/openNovel?style=flat-square)
![Platform](https://img.shields.io/badge/Windows-macOS-Linux-5b8def?style=flat-square)

> **关于 fork**
>
> openNovel 是 [openCode](https://github.com/anomalyco/opencode)（开源 AI 编程 agent）的 fork。我们保留了其会话运行时、工具注册、上下文代数与 Electron 外壳，并把整套面向“写代码”的 agent 框架改造为面向“写小说”的创作工作台：编程工具被替换为大纲、起草、连续性审计、审批、状态提交等写作工具。
>
> 本项目由 openNovel 社区独立维护，**与 openCode 团队无任何隶属、背书或关联关系**。原始 openCode 版权归其作者所有，详见 [归属声明](#归属声明)。

## 截图

<p align="center">
  <img src="docs/screenshots/bookshelf.png" alt="书架" width="49%" />
  <img src="docs/screenshots/workspace.png" alt="工作台" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/characters.png" alt="角色关系" width="49%" />
  <img src="docs/screenshots/approval-review.png" alt="审批与评审" width="49%" />
</p>

<p align="center">
  <sub>书架 · 工作台 · 角色关系图谱 · 37 维连续性审计与审批</sub>
</p>

## 功能特性

### 写作流水线

- **8 步写作流水线** —— 大纲 → 上下文组装 → 起草 → 37 维连续性审计 → 修订 → 状态提取 → 提交 → 章节推进，由 AI agent 按阶段驱动
- **37 维连续性审计** —— 每章从角色、关系、时间线、地点、剧情、世界观、文风、逻辑、细节 9 大类共 37 个维度自动审查，问题附带证据与修改建议，按评审轮次持久化
- **多轮修订与质量闭环** —— 审计不通过的章节自动回到修订环节，支持确定性检查与 AI 深审双重结果，直到通过或人工介入
- **写作风格与技巧库** —— 可配置叙事视角、时态、文风、写作规则，并从已完成章节中提取、沉淀与复用写作技巧

### 作品管理

- **书架** —— 一览管理多部小说的类型、简介、进度与更新时间
- **创建向导** —— 引导式设定类型、世界观、主角、分卷结构
- **大纲与卷章管理** —— 分卷、章节树、节拍（beat）、大纲画布，支持拖拽与折叠
- **设定中心** —— 世界观条目、角色档案、关系、伏笔、剧情线索、灵魂设定（soul）集中维护
- **角色关系图谱** —— 自动生成角色关系网络图，按主角 / 主要 / 配角 / 反分配色

### 阅读、评审与版本

- **工作台** —— 章节树、阅读器、角色 / 伏笔 / 节奏 / 结构 / 批注 / 画布面板与全文搜索集于一处
- **审批流** —— 章节进入待审核队列并附结构化评审详情；可通过、带批注退回，或直达对应会话
- **版本历史** —— 每次章节修订均存档，支持对比与回滚
- **导出** —— 稿件就绪后可导出

### 运行形态

- **桌面端优先** —— 基于 Electron，开箱即用；后端随应用自动拉起，无需单独启动服务；支持 Windows / macOS / Linux 与自动更新
- **Web 自托管** —— 同一套 SolidJS 前端可在浏览器中运行，后端以本地服务方式部署
- **多语言界面** —— 简体中文、English、繁體中文
- **本地优先** —— 小说数据存储在本地 SQLite（含 FTS5 全文检索），不依赖云端即可使用

## 快速开始

### 桌面端（推荐）

桌面端会自动拉起内置后端，无需额外配置。从源码运行：

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install
bun run dev:desktop
```

如需打包当前平台的安装包：

```bash
cd packages/desktop
bun run build && bun run package
# 产物位于 packages/desktop/dist/
```

### 在浏览器中运行

```bash
# 一条命令同时启动后端（端口 4096）与 Web 界面（端口 4444）
bun run dev:all
# 打开 http://localhost:4444
```

打开应用后，添加一个项目文件夹，即可从书架创建你的第一部小说。

> 需要 [Bun](https://bun.sh) 运行时。

## 架构

openNovel 是一个 Bun monorepo：

- `packages/novel-store` —— 核心数据层（小说、卷章、角色、关系、世界观、章节评审、FTS5 全文检索）
- `packages/plugin` —— 写作流水线与工具集（大纲、起草、连续性审计、修订、审批闸门、状态提交）
- `packages/opennovel` —— 后端服务与 CLI
- `packages/desktop` —— Electron 桌面应用（自动拉起并托管后端）
- `packages/app` —— SolidJS Web / 桌面共用界面（书架、工作台、审批流）
- `packages/schema` + `packages/protocol` —— 服务端与客户端共享的 API 契约
- `packages/core` —— 从 openCode 继承并演化的会话运行时、上下文代数与工具框架

## 贡献

欢迎提交 Issue 与 Pull Request。提交信息请使用 Conventional Commits 风格（如 `feat(plugin): ...`、`fix(desktop): ...`）。详细约定见 [AGENTS.md](AGENTS.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 归属声明

openNovel 是 [openCode](https://github.com/anomalyco/opencode) 的衍生作品。openCode 是一款开源 AI 编程 agent，其会话运行时、工具系统、上下文管理与桌面外壳构成了 openNovel 的技术底座；openNovel 在此基础上将目标领域从“编程”改写为“长篇小说创作”，并新增了小说数据模型、写作流水线、37 维连续性审计与审批工作流。

- openCode 原始代码版权归 openCode 作者所有
- openNovel 贡献的代码版权归各自作者所有
- 本项目与 openCode 团队不存在隶属、赞助或背书关系

## 许可证

[MIT](LICENSE) © openNovel contributors。基于 openCode（MIT）的衍生作品，原始版权声明随附保留。