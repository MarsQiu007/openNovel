# openNovel

**AI 驅動的長篇小說創作工作台** —— 透過 8 步寫作流水線與 37 維連續性審計，規劃、起草、審計並修訂長篇小說。桌面端優先，資料全部本機儲存。

<p>
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.en.md">English</a>
</p>

![Tests](https://img.shields.io/github/actions/workflow/status/MarsQiu007/openNovel/test.yml?style=flat-square&branch=dev)
![License](https://img.shields.io/github/license/MarsQiu007/openNovel?style=flat-square)
![Platform](https://img.shields.io/badge/Windows-macOS-Linux-5b8def?style=flat-square)

> **關於 fork**
>
> openNovel 是 [openCode](https://github.com/anomalyco/opencode)（開源 AI 編程 agent）的 fork。我們保留了其會話執行階段、工具註冊、上下文代數與 Electron 外殼，並把整套面向「寫程式」的 agent 框架改造為面向「寫小說」的創作工作台：編程工具被替換為大綱、起草、連續性審計、審批、狀態提交等寫作工具。
>
> 本專案由 openNovel 社群獨立維護，**與 openCode 團隊無任何隸屬、背書或關聯關係**。原始 openCode 版權歸其作者所有，詳見[歸屬聲明](#歸屬聲明)。

## 截圖

<p align="center">
  <img src="docs/screenshots/bookshelf.png" alt="書架" width="49%" />
  <img src="docs/screenshots/workspace.png" alt="工作台" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/characters.png" alt="角色關係" width="49%" />
  <img src="docs/screenshots/approval-review.png" alt="審批與評審" width="49%" />
</p>

<p align="center">
  <sub>書架 · 工作台 · 角色關係圖譜 · 37 維連續性審計與審批</sub>
</p>

## 功能特性

### 寫作流水線

- **8 步寫作流水線** —— 大綱 → 上下文組裝 → 起草 → 37 維連續性審計 → 修訂 → 狀態提取 → 提交 → 章節推進，由 AI agent 按階段驅動
- **37 維連續性審計** —— 每章從角色、關係、時間線、地點、劇情、世界觀、文風、邏輯、細節 9 大類共 37 個維度自動審查，問題附帶證據與修改建議，按評審輪次持久化
- **多輪修訂與品質閉環** —— 審計不通過的章節自動回到修訂環節，結合確定性檢查與 AI 深審雙重結果，直到通過或人工介入
- **寫作風格與技巧庫** —— 可配置敘事視角、時態、語氣、寫作規則，並從已完成章節中提取、沉澱與複用寫作技巧

### 作品管理

- **書架** —— 瀏覽管理多部小說的類型、簡介、進度與更新時間
- **建立嚮導** —— 引導式設定類型、世界觀、主角、分卷結構
- **大綱與卷章管理** —— 分卷、章節樹、節拍（beat）、大綱畫布，支援拖曳與摺疊
- **設定中心** —— 世界觀條目、角色檔案、關係、伏筆、劇情線索、靈魂設定（soul）集中維護
- **角色關係圖譜** —— 自動產生角色關係網路圖，依主角／主要／配角／反派配色

### 閱讀、評審與版本

- **工作台** —— 章節樹、閱讀器、角色／伏筆／節奏／結構／批註／畫布面板與全文搜尋集於一處
- **審批流** —— 章節進入待審核佇列並附結構化評審詳情；可通過、帶批註退回，或直達對應會話
- **版本歷史** —— 每次章節修訂均存檔，支援比對與回滾
- **匯出** —— 稿件就緒後可匯出

### 執行形態

- **桌面端優先** —— 基於 Electron，開箱即用；後端隨應用自動啟動，無需單獨執行服務；支援 Windows／macOS／Linux 與自動更新
- **Web 自架** —— 同一套 SolidJS 介面可在瀏覽器中執行，後端以本機服務方式部署
- **多語言介面** —— 简体中文、English、繁體中文
- **本機優先** —— 小說資料儲存在本機 SQLite（含 FTS5 全文檢索），不需依賴雲端即可使用

## 快速開始

### 桌面端（推薦）

桌面端會自動啟動內建後端，無需額外設定。從源碼執行：

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install
bun run dev:desktop
```

如需打包目前平台的安裝檔：

```bash
cd packages/desktop
bun run build && bun run package
# 產物位於 packages/desktop/dist/
```

### 在瀏覽器中執行

```bash
# 一條指令同時啟動後端（連接埠 4096）與 Web 介面（連接埠 4444）
bun run dev:all
# 開啟 http://localhost:4444
```

開啟應用後，新增一個專案資料夾，即可從書架建立你的第一部小說。

> 需要 [Bun](https://bun.sh) 執行環境。

## 架構

openNovel 是一個 Bun monorepo：

- `packages/novel-store` —— 核心資料層（小說、卷章、角色、關係、世界觀、章節評審、FTS5 全文檢索）
- `packages/plugin` —— 寫作流水線與工具集（大綱、起草、連續性審計、修訂、審批閘門、狀態提交）
- `packages/opennovel` —— 後端服務與 CLI
- `packages/desktop` —— Electron 桌面應用（自動啟動並託管後端）
- `packages/app` —— SolidJS Web／桌面共用介面（書架、工作台、審批流）
- `packages/schema` + `packages/protocol` —— 服務端與用戶端共享的 API 契約
- `packages/core` —— 從 openCode 繼承並演化的會話執行階段、上下文代數與工具框架

## 貢獻

歡迎提交 Issue 與 Pull Request。提交訊息請使用 Conventional Commits 風格（如 `feat(plugin): ...`、`fix(desktop): ...`）。詳細約定見 [AGENTS.md](AGENTS.md) 與 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 歸屬聲明

openNovel 是 [openCode](https://github.com/anomalyco/opencode) 的衍生作品。openCode 是一款開源 AI 編程 agent，其會話執行階段、工具系統、上下文管理與桌面外殼構成了 openNovel 的技術底座；openNovel 在此基礎上將目標領域從「寫程式」改寫為「長篇小說創作」，並新增了小說資料模型、寫作流水線、37 維連續性審計與審批工作流程。

- openCode 原始程式碼版權歸 openCode 作者所有
- openNovel 貢獻的程式碼版權歸各自作者所有
- 本專案與 openCode 團隊不存在隸屬、贊助或背書關係

## 授權條款

[MIT](LICENSE) © openNovel contributors。基於 openCode（MIT）的衍生作品，原始版權聲明隨附保留。