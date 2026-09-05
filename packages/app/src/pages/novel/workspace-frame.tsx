import { useParams, useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createSignal, createMemo, For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useNovel } from "@/context/novel"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { ResizeHandle } from "@opennovel-ai/ui/resize-handle"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opennovel-ai/ui/v2/tooltip-v2"
import { Icon } from "@opennovel-ai/ui/icon"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { useWorkspaceData, findBoundNovelSession } from "./workspace-data"
import { useNovelLiveInvalidation } from "@/context/novel-live"
import { createCloudSyncAutoPilot } from "@/context/cloud-sync"
import { useNovelActivity, usePendingApprovalCount } from "@/context/novel-approval"
import { useSync } from "@/context/sync"
import { SessionPage, SessionRouteErrorBoundary } from "@/pages/session"
import { useUpdateNovel, useExportNovel, useStyleGuide, useUpdateStyleGuide, useOutline, useWorldEntries, useCharacters, useBoundNovelSessions, resolveAutoAdoptTarget } from "@/context/novel-queries"
import ChapterSidebar from "./chapter-sidebar"
import ChapterReader from "./chapter-reader"
import ApprovalBar from "./approval-bar"
import ChapterEditor from "./chapter-editor"
import ModeBadge from "./mode-badge"
import { OutlineSidebar, type OutlineTarget } from "./outline-sidebar"
import { OutlineReader } from "./outline-reader"
import { NovelSessionSwitcher } from "./session-switcher"
import { NovelChatEmptyState, ChatSuggestionChip } from "./chat-empty-state"
import PanelCharacters from "./panel-characters"
import { PanelForeshadow } from "./panel-foreshadow"
import { TensionChart } from "./tension-chart"
import RelationsView from "./relations-view"
import MapView from "./map-view"
import { WorldSidebar } from "./world-sidebar"
import { WorldReader } from "./world-reader"
import StructurePanel from "./structure-panel"
import { AnnotationPanel } from "./annotation-panel"
import CanvasPanel from "./canvas-panel"
import {
  collapseThresholds,
  LEFT_PANE_DEFAULT_WIDTH,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  RAIL_PANE_DEFAULT_WIDTH,
  RAIL_PANE_MAX_WIDTH,
  RAIL_PANE_MIN_WIDTH,
  resolvePaneWidth,
} from "./workspace-pane-width"

// 右栏随行面板图标列（key 对应面板组件，labelKey 对应 i18n 文案；对话为默认面板）
const RAIL_PANELS = [
  { key: "chat", icon: "speech-bubble", labelKey: "novel.workspace.chat" },
  { key: "characters", icon: "dot-grid", labelKey: "novel.panel.characters" },
  { key: "foreshadow", icon: "bullet-list", labelKey: "novel.panel.foreshadow" },
  { key: "tension", icon: "align-right", labelKey: "novel.panel.tension" },
  { key: "structure", icon: "file-tree", labelKey: "novel.panel.structure" },
  { key: "annotations", icon: "pencil-line", labelKey: "novel.panel.annotations" },
] as const

type RailPanel = (typeof RAIL_PANELS)[number]["key"]

// 布局持久化结构（novel.workspace.layout.v1）——leftManual / railManual 为左右栏手动收起覆盖
// （null = 跟随宽度规则）；
// leftWidth / railWidth 为分栏设定宽度（null = 未拖过 = 默认宽度，D5 加字段不升版本零迁移）；
// expanded 为展开态面板（expand 形态由 ?tab=panel:<id> URL 承载，持久值仅用于重启后恢复）
type WorkspaceLayout = {
  railPanel: RailPanel
  leftManual: boolean | null
  railManual: boolean | null
  leftWidth: number | null
  railWidth: number | null
  expanded: RailPanel | null
}

// 按书记忆的工作台内容选择存档（novel.workspace.state.v1）：全 optional 增量写入，缺省即默认态。
// 与 novel.reading-progress 同模式（全局持久化键 + 按 novelID 分桶）；布局类状态不在此（走
// novel.workspace.layout.v1 保持全局单份）。大纲项整体存 OutlineTarget（id 语义见 outline-sidebar）。
type PerBookState = {
  leftMode?: "chapters" | "outlines" | "world"
  outline?: OutlineTarget
  worldEntryId?: string
  relationCharacterId?: string
  /** 该书最近所在的会话（会话段路由变化时写入，打开书籍时供自动回跳恢复） */
  sessionId?: string
}

export default function NovelWorkspaceFrame() {
  const params = useParams()
  const language = useLanguage()
  const novel = useNovel()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabValue = () => searchParams.tab
  const activeTab = (): "reading" | "writing" | "relations" | "map" | "canvas" => {
    const v = tabValue()
    if (v === "writing" || v === "relations" || v === "map" || v === "canvas") return v
    if (v === "reading") return "reading"
    // 无 tab 参数时：会话模式落在写作视图（对话在右栏随行），否则默认阅读
    return isSessionMode() ? "writing" : "reading"
  }

  // Session embed mode: when session/:id param is present
  const isSessionMode = () => !!params.id

  const novelID = () => params.novelID!
  const data = useWorkspaceData(novelID)
  const sdk = useSDK()
  // Must match the decoded directory used by novel-queries keys — params.dir is base64-encoded
  useNovelLiveInvalidation(sdk().directory, novelID())
  createCloudSyncAutoPilot()
  const [selectedChapterId, setSelectedChapterId] = createSignal<string | null>(null)
  // Remember the last-read chapter per novel so reopening a book restores the reading position
  const [readingProgress, setReadingProgress, _, readingProgressReady] = persisted(
    Persist.global("novel.reading-progress"),
    createStore<Record<string, string>>({}),
  )
  // 写入通道即 setPerBookState：solid store 对象 set 天然浅合并，`setPerBookState(novelID, patch)` 就是增量写入
  const [perBookState, setPerBookState, , perBookStateReady] = persisted(
    Persist.global("novel.workspace.state.v1"),
    createStore<Record<string, PerBookState>>({}),
  )
  // 恢复上次阅读进度：等章节列表就绪后校验 ID 有效性，失效的进度回落到第一章（走查修复：僵尸进度 ID 导致单章 404）
  createEffect(() => {
    const id = novelID()
    if (!readingProgressReady() || data.loading) return
    const saved = readingProgress[id] ?? null
    if (saved && data.chapters.some((c) => c.id === saved)) {
      setSelectedChapterId(saved)
      return
    }
    const fallback = data.chapters[0]?.id ?? null
    setSelectedChapterId(fallback)
    if (fallback && saved) setReadingProgress(id, fallback)
  })
  const selectChapter = (chapterID: string) => {
    setSelectedChapterId(chapterID)
    setReadingProgress(novelID(), chapterID)
  }
  // 当前选中的章节对象（含存在性校验）；ID 不在章节列表中时为 null
  const selectedChapter = createMemo(() => {
    const id = selectedChapterId()
    return id ? (data.chapters.find((c) => c.id === id) ?? null) : null
  })
  const [selectedRelationCharacterId, setSelectedRelationCharacterId] = createSignal<string | null>(null)
  const [leftMode, setLeftMode] = createSignal<"chapters" | "outlines" | "world">("chapters")
  const [selectedOutline, setSelectedOutline] = createSignal<OutlineTarget | null>(null)
  const [selectedWorldEntryId, setSelectedWorldEntryId] = createSignal<string | null>(null)
  // 选择联动：写 signal 的同时更新该书存档——恢复 effect 随数据 refetch 重跑时读到的存档值
  // 就是用户最新选择，恢复幂等（每个选择入口都必须走这里的联动，见下方恢复 effect）
  const changeLeftMode = (value: "chapters" | "outlines" | "world") => {
    setLeftMode(value)
    setPerBookState(novelID(), { leftMode: value })
  }
  const selectOutline = (target: OutlineTarget) => {
    setSelectedOutline(target)
    setPerBookState(novelID(), { outline: target })
  }
  const selectWorldEntry = (entryID: string) => {
    setSelectedWorldEntryId(entryID)
    setPerBookState(novelID(), { worldEntryId: entryID })
  }
  const selectRelationCharacter = (characterID: string | null) => {
    setSelectedRelationCharacterId(characterID)
    // RelationsView 会传 null（取消选中）——null 也同步清存档，否则 refetch 重跑会按旧存档把选择恢复回来
    setPerBookState(novelID(), { relationCharacterId: characterID ?? undefined })
  }
  // 恢复校验的数据源：与各子组件同 queryKey，tanstack query 缓存共享，无重复请求
  const outlineQuery = useOutline(novelID)
  const worldQuery = useWorldEntries(novelID)
  const charactersQuery = useCharacters(novelID)
  // 恢复该书的内容选择现场：等持久化与全部数据源就绪后按存档校验，失效项回落默认空态（不报错）。
  // 大纲项绑定卷号/章节序号（见 outline-sidebar）：master 校验非空，volume/chapter 匹配序号；
  // 世界观条目与关系角色按 ID 匹配列表。重跑幂等：上方每个选择联动都同步写存档，任一数据源
  // refetch 触发重跑时读到的存档值就是用户最新选择，恢复等于无操作。
  createEffect(() => {
    if (!perBookStateReady() || data.loading) return
    const outline = outlineQuery.data
    const world = worldQuery.data
    const characters = charactersQuery.data
    if (!outline || !world || !characters) return
    const saved = perBookState[novelID()]
    if (!saved) return
    const mode = saved.leftMode
    if (mode === "chapters" || mode === "outlines" || mode === "world") setLeftMode(mode)
    const target = saved.outline
    if (target) {
      const valid =
        (target.section === "master" && outline.master.length > 0) ||
        (target.section === "volume" && outline.volumes.some((v) => v.volumeId === target.id)) ||
        (target.section === "chapter" && outline.chapters.some((c) => c.chapterId === target.id))
      setSelectedOutline(valid ? target : null)
    }
    if (saved.worldEntryId !== undefined)
      setSelectedWorldEntryId(world.some((e) => e.id === saved.worldEntryId) ? saved.worldEntryId : null)
    if (saved.relationCharacterId !== undefined)
      setSelectedRelationCharacterId(
        characters.some((c) => c.id === saved.relationCharacterId) ? saved.relationCharacterId : null,
      )
  })

  // —— 会话自动回跳（design D5）：路由会话段可选，打开任何书都处于"未选中"初始态 ——
  const boundSessions = useBoundNovelSessions(novelID)
  // 会话记忆写入：会话段变化即视为用户显式切换/新建，写入该书存档（与左栏选择同机制）
  createEffect(() => {
    if (!perBookStateReady()) return
    const sessionID = params.id
    if (!sessionID || !novelID()) return
    setPerBookState(novelID(), { sessionId: sessionID })
  })
  // 未选中会话时自动回到该书记忆的（无记忆则最近活跃的）绑定会话；零绑定保持懒创建空态
  createEffect(() => {
    if (!perBookStateReady()) return
    if (params.id || !novelID()) return
    const list = boundSessions.data
    if (!list) return
    const target = resolveAutoAdoptTarget({
      sessions: list,
      rememberedSessionID: perBookState[novelID()]?.sessionId,
    })
    if (target) navigate(`/${params.dir}/novel/${novelID()}/session/${target}`)
  })
  // —— 布局状态（D6）：带版本号持久化键，承载右栏面板与左栏手动收起覆盖 ——
  const [layout, setLayout, , layoutReady] = persisted(
    Persist.global("novel.workspace.layout.v1"),
    createStore<WorkspaceLayout>({
      railPanel: "chat",
      leftManual: null,
      railManual: null,
      leftWidth: null,
      railWidth: null,
      expanded: null,
    }),
  )
  // 右栏随行面板：对话默认激活；旧数据/非法枚举安全降级为对话（D6 降级规则）
  const railPanel = createMemo<RailPanel>(() =>
    RAIL_PANELS.some((item) => item.key === layout.railPanel) ? layout.railPanel : "chat",
  )
  const setRailPanel = (key: RailPanel) => setLayout("railPanel", key)
  // 进入会话模式时自动切回对话（等待持久化就绪，避免被恢复值覆盖）。
  // 仅在模式边界（非会话 → 会话）触发：effect 追踪的是 params.id 属性，会话内切换/新建
  // 会话同样会重跑本 effect——不加边界判定会把用户刚选中的右栏面板强行打回对话。
  let wasSessionMode = false
  createEffect(() => {
    if (!layoutReady()) return
    const sessionMode = isSessionMode()
    if (sessionMode && !wasSessionMode) setRailPanel("chat")
    wasSessionMode = sessionMode
  })

  // —— 面板双态（D2/D3）：expand 由 ?tab=panel:<id> 承载，peek 在右栏 ——
  const expandedPanel = createMemo<RailPanel | null>(() => {
    const v = tabValue()
    if (typeof v !== "string" || !v.startsWith("panel:")) return null
    const match = RAIL_PANELS.find((item) => item.key === v.slice("panel:".length))
    return match && match.key !== "chat" ? match.key : null
  })
  // expand 前的右栏面板恢复点（仅内存，不跨会话）
  const [peekMemo, setPeekMemo] = createSignal<RailPanel>("chat")
  createEffect(() => {
    if (!expandedPanel()) setPeekMemo(railPanel())
  })
  // 展开态同步进持久化（URL 为准），重启/重进工作台后一次性恢复
  createEffect(() => {
    setLayout("expanded", expandedPanel())
  })
  let expandRestored = false
  createEffect(() => {
    if (!layoutReady()) return
    if (expandRestored) return
    expandRestored = true
    if (expandedPanel()) return
    const match = RAIL_PANELS.find((item) => item.key === layout.expanded)
    if (match && match.key !== "chat") setSearchParams({ tab: `panel:${match.key}` })
  })
  const exitExpand = (target?: RailPanel) => {
    if (!expandedPanel()) return
    setSearchParams({ tab: undefined })
    setRailPanel(target ?? peekMemo())
    // 退出展开态清除右栏手动收起——"展开态返回恢复右栏"的承诺优先于收起态（D2）
    setLayout("railManual", false)
  }
  const openRailPanel = (key: RailPanel) => {
    if (expandedPanel()) {
      // 展开态下点图标 = 退出展开并切换到目标面板（此前直接 return，图标列看起来全部失灵）
      exitExpand(key)
      return
    }
    if (railPanel() === key) {
      // 已激活面板再点：进入 expand 态
      if (key !== "chat") setSearchParams({ tab: `panel:${key}` })
      return
    }
    setRailPanel(key)
    // 默认深度：结构面板 expand，其余 peek（3.1）
    if (key === "structure") setSearchParams({ tab: "panel:structure" })
  }
  createEffect(() => {
    if (!expandedPanel()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitExpand()
    }
    window.addEventListener("keydown", handler)
    onCleanup(() => window.removeEventListener("keydown", handler))
  })

  // —— 宽度规则（D5）：主区保底 720px，两档自动收边（随行右栏先让位，导航左栏后让位），手动操作优先 ——
  const [widthCollapsed, setWidthCollapsed] = createSignal(false)
  const [railWidthCollapsed, setRailWidthCollapsed] = createSignal(false)
  const leftManual = () => (typeof layout.leftManual === "boolean" ? layout.leftManual : null)
  const leftCollapsed = () => !!expandedPanel() || (leftManual() ?? widthCollapsed())
  const railManual = () => (typeof layout.railManual === "boolean" ? layout.railManual : null)
  const railCollapsed = () => !!expandedPanel() || (railManual() ?? railWidthCollapsed())
  // —— 分栏宽度（D1/D4）：生效宽度 = 拖拽内存态 ?? 设定宽度 ?? 默认值。
  // onResize 高频回调只写内存态，松手（onCollapseChange(false)）才提交持久化，避免每帧写 localStorage；
  // 未发生拖拽（内存态为 null，普通点击/双击的第一段按下）不提交，防止覆盖设定值。
  const [dragLeftWidth, setDragLeftWidth] = createSignal<number | null>(null)
  const [dragRailWidth, setDragRailWidth] = createSignal<number | null>(null)
  const leftPaneWidth = () => dragLeftWidth() ?? resolvePaneWidth(layout.leftWidth, LEFT_PANE_DEFAULT_WIDTH)
  const railPaneWidth = () => dragRailWidth() ?? resolvePaneWidth(layout.railWidth, RAIL_PANE_DEFAULT_WIDTH)
  const commitLeftWidth = () => {
    const width = dragLeftWidth()
    if (width === null) return
    setDragLeftWidth(null)
    setLayout("leftWidth", width)
  }
  const commitRailWidth = () => {
    const width = dragRailWidth()
    if (width === null) return
    setDragRailWidth(null)
    setLayout("railWidth", width)
  }
  let bodyRef: HTMLDivElement | undefined
  let widthObserver: ResizeObserver | undefined
  // Body 容器在数据就绪后才挂载（Show when={!data.loading}）：onMount 时 bodyRef 尚未赋值，
  // observer 必须等就绪后建立，否则自动收边永久失效（走查修复）
  createEffect(() => {
    if (data.loading) return
    if (!bodyRef || widthObserver) return
    let leftWasBelow = false
    let railWasBelow = false
    // 观察三区布局的外层容器而非主区：侧栏显隐会改变主区宽度，观察主区会形成自激励反馈环
    // （收起→主区变宽→恢复→主区变窄→再收起，每帧翻转，走查时表现为 UI 高频闪烁）
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      // 阈值从设定宽度实时读取（非响应式：仅 Body 宽变化时判定，拖宽后的悬置态由下次窗口变化收编）
      const thresholds = collapseThresholds(leftPaneWidth(), railPaneWidth())
      const leftBelow = width < thresholds.left // 左档 = 左栏宽 + 主区保底
      const railBelow = width < thresholds.rail // 右档 = max(右栏宽 + 主区保底, 左档 + 1)
      // 宽度回到阈值以上时结束手动覆盖会话，回归自动规则
      if (leftWasBelow && !leftBelow) setLayout("leftManual", null)
      if (railWasBelow && !railBelow) setLayout("railManual", null)
      leftWasBelow = leftBelow
      railWasBelow = railBelow
      setWidthCollapsed(leftBelow)
      setRailWidthCollapsed(railBelow)
    })
    observer.observe(bodyRef)
    widthObserver = observer
    onCleanup(() => observer.disconnect())
  })
  const [isEditing, setIsEditing] = createSignal(false)
  const [editTitle, setEditTitle] = createSignal("")
  const [editSynopsis, setEditSynopsis] = createSignal("")
  const [editGenre, setEditGenre] = createSignal("")
  const [editTone, setEditTone] = createSignal("")
  const [editPov, setEditPov] = createSignal("")
  const [editTense, setEditTense] = createSignal("")
  const [editRules, setEditRules] = createSignal("")

  const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

  // Session activity & approval state
  const sync = useSync()
  const novelActivity = useNovelActivity()
  const pendingCount = createMemo(() => usePendingApprovalCount(data.chapters))
  const updateNovel = useUpdateNovel()
  const styleGuideQuery = useStyleGuide(novelID)
  const updateStyleGuide = useUpdateStyleGuide()
  const [isCancelling, setIsCancelling] = createSignal(false)

  async function cancelGeneration() {
    if (isCancelling()) return
    setIsCancelling(true)
    try {
      const boundID = await findBoundNovelSession(sdk, novel, novelID())
      if (boundID)
        await sdk()
          .client.session.abort({ sessionID: boundID })
          .catch(() => {})
    } finally {
      setIsCancelling(false)
    }
  }
  const exportNovel = useExportNovel()

  async function downloadExport() {
    const result = await exportNovel.mutateAsync({ novelID: novelID() })
    const url = URL.createObjectURL(new Blob([result.content], { type: "text/markdown;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = result.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function startEdit() {
    if (!data.novel) return
    setEditTitle(data.novel.title)
    setEditSynopsis(data.novel.synopsis)
    setEditGenre(data.novel.genre)
    const sg = styleGuideQuery.data
    setEditTone(sg?.tone ?? "")
    setEditPov(sg?.pov ?? "")
    setEditTense(sg?.tense ?? "")
    setEditRules(
      Object.entries(sg?.rules ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    )
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  async function saveEdit() {
    if (!data.novel) return
    await updateNovel.mutateAsync({
      novelID: novelID(),
      title: editTitle().trim() || undefined,
      synopsis: editSynopsis().trim() || undefined,
      genre: (editGenre() as (typeof GENRES)[number]) || undefined,
    })
    const rules = Object.fromEntries(
      editRules()
        .split("\n")
        .map((line) => {
          const idx = line.search(/[:：]/)
          if (idx <= 0) return null
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const
        })
        .filter((entry): entry is readonly [string, string] => entry !== null && entry[0].length > 0),
    )
    await updateStyleGuide.mutateAsync({
      novelID: novelID(),
      tone: editTone().trim(),
      pov: editPov().trim(),
      tense: editTense().trim(),
      rules,
    })
    setIsEditing(false)
  }

  const sessionStatusText = createMemo(() => {
    if (!novelActivity()) return ""
    const ctx = sync()
    const sessions = ctx.data.session
    if (!sessions || sessions.length === 0) return language.t("novel.workspace.writingInProgress")
    const activeSession = sessions.find((s) => ctx.data.session_working(s.id))
    if (!activeSession) return language.t("novel.workspace.writingInProgress")
    const status = ctx.data.session_status[activeSession.id]
    if (!status) return language.t("novel.workspace.writingInProgress")
    if (status.type === "retry") return language.t("novel.workspace.auditingInProgress")
    return language.t("novel.workspace.writingInProgress")
  })

  // 已绑定空会话判定：消息已加载且无任何用户消息、历史不在加载中（与 timeline ready 同判定）
  const emptySessionChipVisible = () => {
    const id = params.id
    if (!id) return false
    const messages = sync().data.message[id]
    return (
      messages !== undefined && !messages.some((m) => m.role === "user") && !sync().session.history.loading(id)
    )
  }

  // 建议 chip 在已存在会话中的动作：以建议文本原文发入当前会话（无包装、不新建）
  async function sendToCurrentSession(text: string) {
    const sessionID = params.id
    if (!sessionID) return
    await sdk().client.session.prompt({
      sessionID,
      directory: sdk().directory,
      parts: [{ type: "text", text }],
    })
  }

  return (
    <Show
      when={!data.loading}
      fallback={
        <div class="flex flex-col h-full items-center justify-center gap-4">
          <Spinner class="w-8 h-8 text-v2-text-text-muted" />
          <p class="text-sm text-v2-text-text-muted">{language.t("novel.workspace.loading")}</p>
        </div>
      }
    >
      <Show
        when={!data.error && !!data.novel}
        fallback={
          <div class="flex flex-col h-full items-center justify-center">
            <div class="flex flex-col items-center gap-4 text-center max-w-md">
              <div class="flex flex-col items-center gap-2">
                <h2 class="text-lg font-medium text-v2-text-text-base">{language.t("novel.workspace.title")}</h2>
                <p class="text-sm text-v2-text-text-muted">{data.error ?? language.t("novel.workspace.notFound")}</p>
              </div>
              <ButtonV2 variant="contrast" size="normal" onClick={() => navigate("/")}>
                ← {language.t("novel.workspace.back")}
              </ButtonV2>
            </div>
          </div>
        }
      >
        <div class="flex flex-col h-full w-full">
          {/* Header */}
          <header class="flex items-center justify-between px-5 py-3 border-b border-v2-border-border-base">
            <div class="flex items-center gap-4">
              <ButtonV2
                variant="ghost-muted"
                size="small"
                onClick={() => {
                  // 展开态下返回按钮先回到 peek（D3），再按返回回到书架
                  if (expandedPanel()) {
                    exitExpand()
                    return
                  }
                  navigate("/")
                }}
              >
                ← {language.t("novel.workspace.back")}
              </ButtonV2>
              <TooltipV2 placement="bottom" value={language.t("novel.workspace.toggleNav")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name={leftCollapsed() ? "chevron-double-right" : "chevron-left"} size="small" />}
                  onClick={() => setLayout("leftManual", !(leftManual() ?? widthCollapsed()))}
                />
              </TooltipV2>
              <Show
                when={isEditing()}
                fallback={
                  <>
                    <h1 class="text-xl font-bold text-v2-text-text-base">{data.novel!.title}</h1>
                    <Tag>{language.t(`novel.genre.${data.novel!.genre}`)}</Tag>
                    <Tag>{language.t(`novel.chapter.status.${data.novel!.status}`)}</Tag>
                    <ButtonV2 variant="ghost-muted" size="small" onClick={startEdit}>
                      {language.t("novel.workspace.edit")}
                    </ButtonV2>
                  </>
                }
              >
                <div class="flex items-center gap-3">
                  <TextInputV2 value={editTitle()} onInput={(e) => setEditTitle(e.currentTarget.value)} />
                  <SelectV2
                    options={[...GENRES]}
                    current={editGenre() as (typeof GENRES)[number]}
                    label={(g) => language.t(`novel.genre.${g}`)}
                    onSelect={(g) => g && setEditGenre(g)}
                  />
                </div>
              </Show>
            </div>
            <div class="flex items-center gap-3">
              <Show when={isEditing()}>
                <ButtonV2 variant="contrast" size="small" onClick={() => void saveEdit()}>
                  {language.t("common.action.save")}
                </ButtonV2>
                <ButtonV2 variant="neutral" size="small" onClick={cancelEdit}>
                  {language.t("common.action.cancel")}
                </ButtonV2>
              </Show>
              <Show when={!isEditing()}>
                <ButtonV2
                  variant="outline"
                  size="small"
                  onClick={() => void downloadExport()}
                  disabled={exportNovel.isPending}
                  title={language.t("novel.workspace.exportHint")}
                >
                  {exportNovel.isPending
                    ? language.t("novel.workspace.exporting")
                    : language.t("novel.workspace.export")}
                </ButtonV2>
              </Show>
              <Show when={pendingCount() > 0}>
                <Tag variant="accent">
                  {language.t("novel.workspace.pendingApproval")} ({pendingCount()})
                </Tag>
              </Show>
              <ModeBadge />
              <TooltipV2 placement="bottom" value={language.t("novel.workspace.toggleRail")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name={railCollapsed() ? "chevron-double-left" : "chevron-right"} size="small" />}
                  onClick={() => setLayout("railManual", !(railManual() ?? railWidthCollapsed()))}
                />
              </TooltipV2>
            </div>
          </header>

          <Show when={isEditing()}>
            <div class="px-6 py-3 border-b border-v2-border-border-base bg-v2-background-bg-layer-01 space-y-2">
              <TextareaV2
                fluid
                value={editSynopsis()}
                onInput={(e) => setEditSynopsis(e.currentTarget.value)}
                placeholder={language.t("novel.wizard.description")}
                rows={3}
              />
              <div class="flex items-center gap-2">
                <div class="flex-1 min-w-0">
                  <TextInputV2
                    fluid
                    value={editTone()}
                    onInput={(e) => setEditTone(e.currentTarget.value)}
                    placeholder={language.t("novel.style.tone")}
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <TextInputV2
                    fluid
                    value={editPov()}
                    onInput={(e) => setEditPov(e.currentTarget.value)}
                    placeholder={language.t("novel.style.pov")}
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <TextInputV2
                    fluid
                    value={editTense()}
                    onInput={(e) => setEditTense(e.currentTarget.value)}
                    placeholder={language.t("novel.style.tense")}
                  />
                </div>
              </div>
              <TextareaV2
                fluid
                class="font-mono"
                value={editRules()}
                onInput={(e) => setEditRules(e.currentTarget.value)}
                placeholder={language.t("novel.style.rulesHint")}
                rows={3}
              />
            </div>
          </Show>

          {/* Pipeline status bar — shown when a bound session is active */}
          <Show when={novelActivity()}>
            <div class="flex items-center gap-2 px-6 py-2 bg-v2-background-bg-layer-01 border-b border-v2-border-border-base">
              <span class="w-2 h-2 rounded-full bg-v2-state-fg-success" />
              <span class="flex-1 text-xs text-v2-text-text-muted">{sessionStatusText()}</span>
              <ButtonV2 variant="danger" size="small" onClick={() => void cancelGeneration()} disabled={isCancelling()}>
                {isCancelling()
                  ? language.t("novel.workspace.cancelling")
                  : language.t("novel.workspace.cancelGeneration")}
              </ButtonV2>
            </div>
          </Show>

          {/* Body — 三区布局：左栏导航 / 主区焦点 / 右栏随行 */}
          <div ref={bodyRef} class="flex flex-1 min-h-0">
            {/* 左栏：导航区（章节/大纲/设定），常驻可用；宽度 = 设定值（D1），右缘拖拽手柄可调（D3） */}
            <aside
              classList={{ hidden: leftCollapsed() }}
              class="relative border-r border-v2-border-border-base flex flex-col min-h-0 shrink-0"
              style={{ width: `${leftPaneWidth()}px` }}
            >
              <ResizeHandle
                direction="horizontal"
                edge="end"
                size={leftPaneWidth()}
                min={LEFT_PANE_MIN_WIDTH}
                max={LEFT_PANE_MAX_WIDTH}
                collapseThreshold={LEFT_PANE_MIN_WIDTH}
                onResize={setDragLeftWidth}
                onCollapseChange={(dragging) => {
                  if (!dragging) commitLeftWidth()
                }}
                onCollapse={() => {
                  // 拖到最小宽度再向外拽 = 手动收起（D3）：提交 min 为设定宽度，再展开按 220px 显示
                  setDragLeftWidth(null)
                  setLayout("leftWidth", LEFT_PANE_MIN_WIDTH)
                  setLayout("leftManual", true)
                }}
                onDblClick={() => {
                  // 双击重置默认宽度（D3）：mousedown 对 e.detail > 1 早退，不与拖拽冲突
                  setDragLeftWidth(null)
                  setLayout("leftWidth", null)
                }}
              />
              <div class="flex border-b border-v2-border-border-base shrink-0 px-3 py-2">
                <SegmentedControlV2
                  class="segmented-control-v2--full-width"
                  value={leftMode()}
                  onChange={(value) => value && changeLeftMode(value as "chapters" | "outlines" | "world")}
                >
                  <SegmentedControlItemV2 value="world">
                    {language.t("novel.workspace.modeSettings")}
                  </SegmentedControlItemV2>
                  <SegmentedControlItemV2 value="outlines">
                    {language.t("novel.workspace.modeOutlines")}
                  </SegmentedControlItemV2>
                  <SegmentedControlItemV2 value="chapters">
                    {language.t("novel.workspace.modeChapters")}
                  </SegmentedControlItemV2>
                </SegmentedControlV2>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Show when={leftMode() === "chapters"}>
                  <ChapterSidebar
                    novelID={novelID()}
                    volumes={data.volumes}
                    chapters={data.chapters}
                    selectedChapterId={selectedChapterId()}
                    onSelectChapter={selectChapter}
                  />
                </Show>
                <Show when={leftMode() === "outlines"}>
                  <OutlineSidebar
                    novelID={novelID()}
                    volumes={data.volumes}
                    chapters={data.chapters}
                    selectedOutline={selectedOutline}
                    onSelectOutline={selectOutline}
                  />
                </Show>
                <Show when={leftMode() === "world"}>
                  <WorldSidebar
                    novelID={novelID}
                    selectedEntryId={selectedWorldEntryId}
                    onSelect={selectWorldEntry}
                  />
                </Show>
              </div>
            </aside>

            {/* 主区：焦点区 */}
            <div class="relative flex-1 flex flex-col min-w-0">
              {/* expand 态下原视图保持挂载（display 切换），退出展开后状态不丢 */}
              <div class="flex flex-col flex-1 min-h-0" style={{ display: expandedPanel() ? "none" : "flex" }}>
                <Show when={leftMode() === "chapters"}>
                  {/* 视图切换：阅读/写作/关系/地图/画布 */}
                  <div class="flex border-b border-v2-border-border-base px-8 py-2 shrink-0">
                    <SegmentedControlV2
                      value={activeTab()}
                      onChange={(value) => value && setSearchParams({ tab: value })}
                    >
                      <SegmentedControlItemV2 value="reading">
                        {language.t("novel.workspace.reading")}
                      </SegmentedControlItemV2>
                      <SegmentedControlItemV2 value="writing">
                        {language.t("novel.workspace.writingSession")}
                      </SegmentedControlItemV2>
                      <SegmentedControlItemV2 value="relations">
                        {language.t("novel.relations.tab")}
                      </SegmentedControlItemV2>
                      <SegmentedControlItemV2 value="map">{language.t("novel.map.tab")}</SegmentedControlItemV2>
                      <SegmentedControlItemV2 value="canvas">{language.t("novel.panel.canvas")}</SegmentedControlItemV2>
                    </SegmentedControlV2>
                  </div>

                  {/* 视图内容 */}
                  <div class="flex flex-col flex-1 min-h-0 px-8 py-6">
                    <Show when={activeTab() === "reading"}>
                      <div class="flex flex-col h-full">
                        <ChapterReader
                          novelID={novelID()}
                          chapters={data.chapters}
                          selectedChapterId={selectedChapterId()}
                          onSelectChapter={selectChapter}
                        />
                        {/* 仅在选中章节存在于列表时挂载，避免僵尸进度 ID 发出必然 404 的单章请求 */}
                        <Show when={selectedChapter()}>
                          <ApprovalBar
                            novelID={novelID()}
                            chapterID={selectedChapter()!.id}
                            status={selectedChapter()!.status}
                          />
                        </Show>
                      </div>
                    </Show>
                    <Show when={activeTab() === "writing"}>
                      <Show
                        when={selectedChapterId()}
                        fallback={
                          <div class="flex items-center justify-center flex-1 min-h-0 text-sm text-v2-text-text-faint">
                            {language.t("novel.reader.empty")}
                          </div>
                        }
                      >
                        <ChapterEditor
                          novelID={novelID()}
                          chapterID={selectedChapterId()!}
                          onExit={() => setSearchParams({ tab: "reading" })}
                        />
                      </Show>
                    </Show>
                    <Show when={activeTab() === "relations"}>
                      <RelationsView
                        novelID={novelID}
                        selectedCharacterId={selectedRelationCharacterId}
                        onSelectCharacter={selectRelationCharacter}
                      />
                    </Show>
                    <Show when={activeTab() === "map"}>
                      <MapView />
                    </Show>
                    <Show when={activeTab() === "canvas"}>
                      <CanvasPanel novelID={novelID} />
                    </Show>
                  </div>
                </Show>

                <Show when={leftMode() === "outlines"}>
                  <div class="flex flex-col flex-1 min-h-0">
                    <OutlineReader
                      novelID={novelID()}
                      volumes={data.volumes}
                      chapters={data.chapters}
                      selectedOutline={selectedOutline}
                    />
                  </div>
                </Show>

                <Show when={leftMode() === "world"}>
                  <WorldReader
                    novelID={novelID}
                    selectedEntryId={selectedWorldEntryId}
                    onEntryDeleted={() => setSelectedWorldEntryId(null)}
                  />
                </Show>
              </div>

              {/* expand 态：面板占主区（D3 面板单实现、容器自适应）；右上角常驻返回——
                  误触展开（再点已激活图标）后右栏随左右栏一起收起，Esc 不可发现，返回是可见的自救入口 */}
              <Show when={expandedPanel()} keyed>
                {(key) => (
                  <div class="relative flex flex-col flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div class="absolute right-3 top-3 z-10">
                      <TooltipV2 placement="bottom" value={language.t("novel.workspace.back")}>
                        <IconButtonV2
                          variant="ghost-muted"
                          size="small"
                          icon={<Icon name="chevron-left" size="small" />}
                          aria-label={language.t("novel.workspace.back")}
                          onClick={() => exitExpand()}
                        />
                      </TooltipV2>
                    </div>
                    <Show when={key === "characters"}>
                      <PanelCharacters
                        novelID={novelID}
                        selectedChapterId={selectedChapterId}
                        chapters={data.chapters}
                      />
                    </Show>
                    <Show when={key === "foreshadow"}>
                      <PanelForeshadow
                        novelID={novelID}
                        selectedChapterId={selectedChapterId}
                        chapters={data.chapters}
                      />
                    </Show>
                    <Show when={key === "tension"}>
                      <TensionChart novelID={novelID} selectedChapterId={selectedChapterId} chapters={data.chapters} />
                    </Show>
                    <Show when={key === "structure"}>
                      <StructurePanel
                        novelID={novelID}
                        selectedVolumeId={() => {
                          const ch = data.chapters.find((c: { id: string }) => c.id === selectedChapterId())
                          return ch?.volumeId ?? null
                        }}
                      />
                    </Show>
                    <Show when={key === "annotations"}>
                      <AnnotationPanel novelID={novelID} chapterID={selectedChapterId} />
                    </Show>
                  </div>
                )}
              </Show>

              {/* expand 态窄条：生成中呼吸灯，点击恢复对话（3.2） */}
              <Show when={expandedPanel() && novelActivity()}>
                <button
                  type="button"
                  title={language.t("novel.workspace.chat")}
                  onClick={() => exitExpand("chat")}
                  class="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 py-4 px-1.5 border border-r-0 border-v2-border-border-base rounded-l-lg bg-v2-background-bg-layer-01 shadow-sm hover:bg-v2-background-bg-layer-02"
                >
                  <Icon name="speech-bubble" size="small" />
                  <span class="w-2 h-2 rounded-full bg-v2-state-fg-success animate-pulse" />
                </button>
              </Show>
            </div>

            {/* 右栏：随行区 — 图标列 + 面板区；宽度 = 设定值（D1），左缘拖拽手柄可调（D3） */}
            <aside
              classList={{ hidden: railCollapsed() }}
              class="relative border-l border-v2-border-border-base flex min-h-0 shrink-0"
              style={{ width: `${railPaneWidth()}px` }}
            >
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={railPaneWidth()}
                min={RAIL_PANE_MIN_WIDTH}
                max={RAIL_PANE_MAX_WIDTH}
                collapseThreshold={RAIL_PANE_MIN_WIDTH}
                onResize={setDragRailWidth}
                onCollapseChange={(dragging) => {
                  if (!dragging) commitRailWidth()
                }}
                onCollapse={() => {
                  // 拖到最小宽度再向外拽 = 手动收起（D3）：提交 min 为设定宽度，再展开按 320px 显示
                  setDragRailWidth(null)
                  setLayout("railWidth", RAIL_PANE_MIN_WIDTH)
                  setLayout("railManual", true)
                }}
                onDblClick={() => {
                  // 双击重置默认宽度（D3）：mousedown 对 e.detail > 1 早退，不与拖拽冲突
                  setDragRailWidth(null)
                  setLayout("railWidth", null)
                }}
              />
              {/* 面板区 */}
              <div class="flex-1 min-w-0 flex flex-col min-h-0">
                {/* 对话面板：常驻挂载（display 切换保持会话状态不重置） */}
                <div class="relative flex flex-col flex-1 min-h-0" style={{ display: railPanel() === "chat" ? "flex" : "none" }}>
                  <NovelSessionSwitcher dir={params.dir!} novelID={novelID()} />
                  <Show
                    when={params.id}
                    fallback={<NovelChatEmptyState dir={params.dir!} novelID={novelID()} />}
                  >
                    <div class="flex-1 min-h-0 overflow-y-auto">
                      <SessionRouteErrorBoundary sessionID={params.id}>
                        <SessionPage />
                      </SessionRouteErrorBoundary>
                    </div>
                    {/* 已绑定空会话（如新建轻会话后未发消息）：时间线就绪且无用户消息时
                        提供与空态一致的建议 chip，点击直接发入当前会话 */}
                    <Show when={emptySessionChipVisible()}>
                      <div class="absolute bottom-24 left-1/2 z-10 -translate-x-1/2">
                        <ChatSuggestionChip
                          suggestion={language.t("novel.writing.writeNextChapter")}
                          onPick={(text) => void sendToCurrentSession(text)}
                        />
                      </div>
                    </Show>
                  </Show>
                </div>

                {/* 检视面板：按需挂载（solid-query 缓存兜底）；chat 激活时必须隐藏——
                    两个 flex-1 兄弟会平分栏高，常驻包裹层会把对话面板挤到半格 */}
                <div
                  classList={{ hidden: railPanel() === "chat" }}
                  class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <Show when={railPanel() === "characters"}>
                    <PanelCharacters novelID={novelID} selectedChapterId={selectedChapterId} chapters={data.chapters} />
                  </Show>
                  <Show when={railPanel() === "foreshadow"}>
                    <PanelForeshadow novelID={novelID} selectedChapterId={selectedChapterId} chapters={data.chapters} />
                  </Show>
                  <Show when={railPanel() === "tension"}>
                    <TensionChart novelID={novelID} selectedChapterId={selectedChapterId} chapters={data.chapters} />
                  </Show>
                  <Show when={railPanel() === "structure"}>
                    <StructurePanel
                      novelID={novelID}
                      selectedVolumeId={() => {
                        const ch = data.chapters.find((c: { id: string }) => c.id === selectedChapterId())
                        return ch?.volumeId ?? null
                      }}
                    />
                  </Show>
                  <Show when={railPanel() === "annotations"}>
                    <AnnotationPanel novelID={novelID} chapterID={selectedChapterId} />
                  </Show>
                </div>
              </div>

              {/* 图标列（右栏最右缘）：面板区在前、切换列在后 */}
              <div class="flex flex-col items-center gap-1 py-3 px-1.5 border-l border-v2-border-border-base shrink-0">
                <For each={RAIL_PANELS}>
                  {(item) => (
                    <TooltipV2 placement="left" value={language.t(item.labelKey)}>
                      <IconButtonV2
                        variant="ghost-muted"
                        size="normal"
                        state={railPanel() === item.key ? "pressed" : "rest"}
                        icon={<Icon name={item.icon} size="small" />}
                        aria-label={language.t(item.labelKey)}
                        onClick={() => openRailPanel(item.key)}
                      />
                    </TooltipV2>
                  )}
                </For>
              </div>
            </aside>
          </div>
        </div>
      </Show>
    </Show>
  )
}
