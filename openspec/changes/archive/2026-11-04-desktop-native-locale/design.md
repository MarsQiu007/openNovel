# Design: desktop-native-locale

## Context

主进程当前所有用户可见文案为硬编码英文，穷举清单（含 file:line）：

- `src/main/updater.ts:62-85` — 更新检查失败 / 已是最新 / 更新就绪三类 `dialog.showMessageBox`（含 Restart、Later 按钮）
- `src/main/windows.ts:311-401` — `wireWindowRecovery` 的加载失败 / 渲染进程终止 / 未响应三类恢复对话框；按钮响应当前**按按钮标签字符串比对**（`handle(button: string)`，windows.ts:311-328），本地化后该判定会失效
- `src/main/ipc.ts:119-176` — 目录/文件/保存选择器默认标题（`opts.title ?? "..."`）与过滤器显示名 `pickerFilters`（ipc.ts:15-18）
- `src/main/attachment-picker.ts:21,36,44` — 两条用户可见错误消息（超限、未授权），经 IPC 错误形式上抛给 renderer 展示（已 grep 确认 renderer 无按 message 字符串匹配的消费方）

全局语言设置已持久化在 `opennovel.global.dat` 的 `language` 键（renderer 经 `store-set` IPC 由主进程落盘，见 `src/main/ipc.ts:100`）。`src/main/store.ts:15` 的 `getStore(name)` 按名缓存 `electron-store` 实例，主进程与 renderer 读写同一实例，主进程侧读取无缓存一致性问题。renderer 侧解析逻辑（`src/renderer/i18n/index.ts` 的 `parseStored`/`pickLocale`）支持裸字符串与 `{locale}` 对象两种形状，主进程必须复刻同一规则；其 `detectLocale()` 兜底当前为 `en`（i18n/index.ts:31）。

## Goals / Non-Goals

设计层面目标：

- 主进程取词为同步、使用时读取：对话框弹出那一刻解析当前语言，语言切换即时生效，无需重启或订阅广播。
- 核心解析/取词逻辑可脱离 Electron 单测（注入读取函数），Electron/electron-store 只出现在薄壳。
- 三语词条同框定义，缺失在类型系统与运行时双重暴露。

非目标：菜单栏标签（`DESKTOP_MENU` 英文标签保留）；`show-notification` 通道（文案由 renderer 提供）；恢复对话框 detail 中的诊断字段（`Window:` / `URL:` / `Error:` / `Reason:` / `Code:` 及 detail 文本）保持 ASCII 英文——日志式诊断内容，本地化反而增加对照日志的难度。

## Decisions

### 决策 1：新建 `src/main/native-locale.ts`，使用时同步取词

模块导出三样：

1. `Locale` 类型（`"en" | "zh" | "zht"`）与文案键字典 `Record<Key, { zh, en, zht }>`（zh 为源文案，见决策 3）；
2. `resolveLocale(read: () => unknown): Locale` 纯函数——`read` 注入（生产传入 `() => getStore("opennovel.global.dat").get("language")`），内部复刻 renderer 的 `parseStored`/`pickLocale` 规则（先按字符串解析，再按 `{locale}` 对象解析，非法或缺失回 `zh`）；
3. `t(key: Key, params?: Record<string, string | number>): string`——每次调用先 `resolveLocale` 再取词，params 做 `{name}` 模板替换（与 renderer `resolveTemplate` 同形）。

备选：启动时快照语言 + 订阅设置变更广播。多一套事件通道，换来的是本就不需要的能力（下一次弹窗生效即可满足需求），否掉。

`attachment-picker.ts` 是被大量单测覆盖的纯模块（零 Electron 依赖），不直接 import locale 模块：超限与未授权两条错误文案改为**必填的 getter 参数**（`() => string`），由 `ipc.ts` 组合根注入生产实现（绑定 `t()`），测试注入假文案。这样纯模块测试不触碰 electron-store，同时生产路径的取词仍发生在抛出时刻、随语言即时生效。

### 决策 2：恢复对话框按钮判定改为响应序号

`wireWindowRecovery` 的 `handle(button: string | undefined, wait)` 改为 `handle(index: number | undefined, wait)`，对话框按钮效果按 `result.response` 序号判定；`buttons` 数组由字典组装，顺序固定为 [重启, 导出日志, 继续等待或退出]，语义与序号绑定。`cancelId: 2` 等序号语义不变（本地化只改标签）。

备选：维护"标签→动作"回查表。多一层易漂移的映射；Electron 直接给响应序号，无收益，否掉。

### 决策 3：字典为嵌套三语结构，而非三套平铺表

```
export const dict = {
  "updater.error.title": { zh: "更新错误", en: "Update Error", zht: "更新錯誤" },
  ...
} as const
```

键与三语同框：tsgo 类型保证任何语言不缺键（对象字面量必须三语齐全才能通过类型）；另加运行时完整性测试（遍历断言三语键集合一致 + 无空串），防手工类型断言绕过。

备选：zh/en/zht 三张平铺表。键漂移风险高（en 表加了键、zh 表忘加，编译期不报错），否掉。

### 决策 4：`detectLocale()` 兜底 `en` → `zh`

`src/renderer/i18n/index.ts:31` 的兜底返回值改为 `"zh"`，探测循环本身不动（en / zh / zh-Hant 识别保持现状）。`build(locale)` 以 en 为 base 叠加目标语言，无需调整。`detectLocale` 当前是模块私有函数（i18n/index.ts:18），为可测性将其导出（仅测试消费，属 renderer 内部模块，不进 preload 桥）。

### 决策 5：诊断字段不本地化，且确立"不得按 message 匹配"约束

恢复对话框 detail 中 `Window: xxx` 等技术行与附件错误的对内语义不属用户文案。约束记入本文档：renderer 及未来代码不得按错误 message 字符串匹配分支（现有代码已合规，grep 验证过）。

## 文案定稿（实现唯一来源）

| 键 | zh（源文案） | en | zht |
|---|---|---|---|
| `updater.error.title` | 更新错误 | Update Error | 更新錯誤 |
| `updater.error.message` | 检查更新失败。 | Update check failed. | 檢查更新失敗。 |
| `updater.latest.title` | 无更新 | No Updates | 無更新 |
| `updater.latest.message` | 已是最新版本。 | You're up to date. | 已是最新版本。 |
| `updater.ready.title` | 更新就绪 | Update Ready | 更新就緒 |
| `updater.ready.message` | 更新 {version} 已下载。是否立即重启？ | Update {version} downloaded. Restart now? | 更新 {version} 已下載。是否立即重新啟動？ |
| `updater.ready.restart` | 立即重启 | Restart | 立即重新啟動 |
| `updater.ready.later` | 稍后 | Later | 稍後 |
| `recovery.failed.title` | OpenNovel 加载失败 | OpenNovel failed to load | OpenNovel 載入失敗 |
| `recovery.crashed.title` | OpenNovel 窗口异常终止 | OpenNovel window terminated unexpectedly | OpenNovel 視窗意外終止 |
| `recovery.unresponsive.title` | OpenNovel 未响应 | OpenNovel is not responding | OpenNovel 未回應 |
| `recovery.unresponsive.detail` | 你可以重启应用、导出日志或继续等待。 | You can relaunch the app, open the logs, or keep waiting. | 你可以重新啟動應用、匯出日誌或繼續等待。 |
| `recovery.relaunch` | 重启 | Relaunch | 重新啟動 |
| `recovery.exportLogs` | 导出日志 | Export Logs | 匯出日誌 |
| `recovery.keepWaiting` | 继续等待 | Keep Waiting | 繼續等待 |
| `recovery.quit` | 退出 | Quit | 結束 |
| `picker.folder` | 选择文件夹 | Choose a folder | 選擇資料夾 |
| `picker.file` | 选择文件 | Choose a file | 選擇檔案 |
| `picker.save` | 保存文件 | Save file | 儲存檔案 |
| `picker.filter.files` | 文件 | Files | 檔案 |
| `attachment.tooLarge` | 所选附件超过 20 MB 上限。 | Selected attachments exceed the 20 MB limit. | 所選附件超過 20 MB 上限。 |
| `attachment.unauthorized` | 该文件未通过文件选择器授权。 | File was not selected by the picker. | 該檔案未經檔案選擇器授權。 |

## Risks / Trade-offs

- 全局 `language` 值的写入形状将来在 renderer 侧演进 → 主进程 `resolveLocale` 与 renderer `pickLocale` 规则必须同步演进；现状形状矩阵（字符串 / `{locale}` / 非法 / 缺失）用单测双端锁定，漂移时兜底 zh（安全侧，不会显示错误语言）。
- 卡死对话框按钮文案变化 → 用户文档/截图可能过时；属可接受的产品文案迭代。
- 繁体词条未经母语校对 → tasks 中安排一次繁体文案校对项（源码简体、繁体字典人工核对），允许后续提案修订。
- 附件错误 message 被未来代码按字符串匹配 → 已立约束（决策 5），代码评审把关。

## Migration Plan

无持久化数据迁移：`language` 键格式不变，旧数据全部兼容。行为变更（主进程对话框默认中文、系统语言探测不到时界面为中文）为本变更有意效果。回滚即还原提交。
