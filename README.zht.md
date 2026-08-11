# openNovel

**AI 驅動的小說創作工作台** —— 透過 8 步寫作流水線與 37 維連續性審計，規劃、起草、審計並修訂長篇小說。

<p>
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.en.md">English</a>
</p>

![Tests](https://img.shields.io/github/actions/workflow/status/MarsQiu007/openNovel/test.yml?style=flat-square&branch=dev)

## 截圖

| 書架                                    | 工作台                                    |
| --------------------------------------- | ----------------------------------------- |
| ![書架](docs/screenshots/bookshelf.png) | ![工作台](docs/screenshots/workspace.png) |

| 閱讀器                                 | 審批與評審                                          |
| -------------------------------------- | --------------------------------------------------- |
| ![閱讀器](docs/screenshots/reader.png) | ![審批與評審](docs/screenshots/approval-review.png) |

## 特性

- **8 步寫作流水線** —— 大綱 → 上下文組裝 → 起草 → 37 維連續性審計 → 修訂 → 狀態提取 → 提交 → 章節推進，由 AI agent 驅動
- **37 維連續性審計** —— 每章從角色、時間線、劇情、邏輯、設定等維度評審，證據與建議按評審輪次持久化保存
- **書架** —— 一覽管理多部小說的類型、簡介與進度
- **創建嚮導** —— 引導式設定類型、世界觀、角色與分卷結構
- **工作台** —— 章節樹、閱讀器、角色/大綱/節奏面板與全文搜索集於一處
- **版本歷史** —— 每次章節修訂均有存檔，隨時對比與回滾
- **審批流** —— 章節進入審批隊列並附結構化評審詳情；可批准、帶批註駁回或直達證據
- **導出** —— 稿件就緒後即可導出

## 快速開始（從源碼）

需要 [Bun](https://bun.sh)。

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install

# 推薦：以桌面應用方式啟動（Electron，自動拉起後端，無需單獨啟動）
bun run dev:desktop
```

也可選擇以 Web 方式在瀏覽器中執行：

```bash
# 一條命令同時啟動後端（端口 4096）與 Web 界面（端口 4444）
bun run dev:all
# 打開 http://localhost:4444
```

打開應用後，添加專案資料夾，從書架創建你的第一部小說。

界面支援 简体中文、English 與繁體中文。

## 架構

openNovel 是一個 Bun monorepo：

- `packages/novel-store` —— 核心資料層（小說、章節、角色、章節評審）
- `packages/schema` + `packages/protocol` —— 服務端與客戶端共享的 API 契約
- `packages/desktop` —— Electron 桌面應用（自動拉起後端）
- `packages/opennovel` —— 後端服務與 CLI
- `packages/app` —— SolidJS Web 界面（書架、工作台、審批流）
- `packages/plugin` —— 寫作流水線工具（起草、連續性審計、評審提交）

## 歸屬聲明

openNovel 是 [opennovel](https://github.com/anomalyco/opennovel)（開源 AI 編程 agent）的 fork，專注於 AI 輔助小說創作。本專案與 opennovel 團隊無關。

## 授權條款

MIT —— 見 [LICENSE](LICENSE)。保留 opennovel 原始版權聲明；openNovel 貢獻的版權歸各自作者所有。
