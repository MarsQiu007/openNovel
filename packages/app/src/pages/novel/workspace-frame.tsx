import { useParams, useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createSignal, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useNovel } from "@/context/novel"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { useWorkspaceData } from "./workspace-data"
import { useNovelLiveInvalidation } from "@/context/novel-live"
import { createCloudSyncAutoPilot } from "@/context/cloud-sync"
import { useNovelActivity, usePendingApprovalCount } from "@/context/novel-approval"
import { useSync } from "@/context/sync"
import { SessionPage, SessionRouteErrorBoundary } from "@/pages/session"
import { useUpdateNovel, useExportNovel, useStyleGuide, useUpdateStyleGuide } from "@/context/novel-queries"
import ChapterSidebar from "./chapter-sidebar"
import ChapterReader from "./chapter-reader"
import ApprovalBar from "./approval-bar"
import ChapterEditor from "./chapter-editor"
import ModeBadge from "./mode-badge"
import { OutlineSidebar, type OutlineTarget } from "./outline-sidebar"
import { OutlineReader } from "./outline-reader"
import WritingFlowButton, { findBoundNovelSession } from "./writing-flow"
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

export default function NovelWorkspaceFrame() {
  const params = useParams()
  const language = useLanguage()
  const novel = useNovel()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabValue = () => searchParams.tab
  const activeTab = (): "reading" | "writing" | "characters" | "relations" | "map" | "canvas" => {
    const v = tabValue()
    if (v === "writing" || v === "characters" || v === "relations" || v === "map" || v === "canvas") return v
    return "reading"
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
  createEffect(() => {
    const id = novelID()
    if (!readingProgressReady()) return
    setSelectedChapterId(readingProgress[id] ?? null)
  })
  const selectChapter = (chapterID: string) => {
    setSelectedChapterId(chapterID)
    setReadingProgress(novelID(), chapterID)
  }
  const [selectedRelationCharacterId, setSelectedRelationCharacterId] = createSignal<string | null>(null)
  const [leftMode, setLeftMode] = createSignal<"chapters" | "outlines" | "world">("chapters")
  const [selectedOutline, setSelectedOutline] = createSignal<OutlineTarget | null>(null)
  const [selectedWorldEntryId, setSelectedWorldEntryId] = createSignal<string | null>(null)
  const [panelTab, setPanelTab] = createSignal<"characters" | "foreshadow" | "tension" | "structure" | "annotations" | "canvas">("characters")
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

  const sessionStatusType = createMemo(() => {
    if (!novelActivity()) return null
    const ctx = sync()
    const sessions = ctx.data.session
    if (!sessions || sessions.length === 0) return "writing"
    const activeSession = sessions.find((s) => ctx.data.session_working(s.id))
    if (!activeSession) return "writing"
    const status = ctx.data.session_status[activeSession.id]
    if (!status) return "writing"
    if (status.type === "retry") return "auditing"
    return "writing"
  })

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
                  if (activeTab() === "relations" || activeTab() === "map") {
                    navigate(`/${params.dir}/novel/${params.novelID}`)
                  } else {
                    navigate("/")
                  }
                }}
              >
                ← {language.t("novel.workspace.back")}
              </ButtonV2>
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
                <WritingFlowButton novelID={novelID()} novelTitle={data.novel!.title} />
              </Show>
              <Show when={pendingCount() > 0}>
                <Tag variant="accent">
                  {language.t("novel.workspace.pendingApproval")} ({pendingCount()})
                </Tag>
              </Show>
              <ModeBadge />
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

          {/* Body */}
          <div class="flex flex-1 min-h-0">
            {/* Session embed: full-width when session/:id param is present */}
            <Show when={isSessionMode()}>
              <div class="flex-1 flex flex-col min-h-0">
                <div class="flex items-center justify-between px-4 py-2 border-b border-v2-border-border-base shrink-0">
                  <div class="flex items-center gap-4">
                    <ButtonV2
                      variant="ghost-muted"
                      size="small"
                      onClick={() => navigate(`/${params.dir}/novel/${params.novelID}`)}
                    >
                      ← {language.t("novel.workspace.backToNovel")}
                    </ButtonV2>
                    <h1 class="text-xl font-bold text-v2-text-text-base">{data.novel!.title}</h1>
                    <Tag>{language.t(`novel.genre.${data.novel!.genre}`)}</Tag>
                    <Tag>{language.t("novel.workspace.writingSession")}</Tag>
                  </div>
                  <Show when={novelActivity()}>
                    <div class="flex items-center gap-2">
                      <span
                        class={`w-2 h-2 rounded-full animate-pulse ${sessionStatusType() === "auditing" ? "bg-v2-state-fg-warning" : "bg-v2-state-fg-success"}`}
                      />
                      <span class="text-xs text-v2-text-text-muted">{sessionStatusText()}</span>
                    </div>
                  </Show>
                </div>
                <div class="flex-1 overflow-y-auto">
                  <SessionRouteErrorBoundary sessionID={params.id}>
                    <SessionPage />
                  </SessionRouteErrorBoundary>
                </div>
              </div>
            </Show>

            <Show when={!isSessionMode()}>
              {/* Relations / Map views: full-width (no left/right sidebars) */}
              <Show when={(activeTab() === "characters" || activeTab() === "relations" || activeTab() === "map" || activeTab() === "canvas") && leftMode() !== "world"}>
                <div class="flex-1 flex flex-col min-w-0">
                  <Show when={activeTab() === "characters"}>
                    <PanelCharacters
                      novelID={novelID}
                      selectedChapterId={selectedChapterId}
                      chapters={data.chapters}
                    />
                  </Show>
                  <Show when={activeTab() === "relations"}>
                    <RelationsView
                      novelID={novelID}
                      selectedCharacterId={selectedRelationCharacterId}
                      onSelectCharacter={setSelectedRelationCharacterId}
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

              {/* Reading / Writing / World views: classic three-column layout */}
              <Show when={activeTab() === "reading" || activeTab() === "writing" || leftMode() === "world"}>
                <aside class="w-72 border-r border-v2-border-border-base flex flex-col min-h-0">
                  {/* Left mode switcher */}
                  <div class="flex border-b border-v2-border-border-base shrink-0 px-3 py-2">
                    <SegmentedControlV2
                      class="segmented-control-v2--full-width"
                      value={leftMode()}
                      onChange={(value) => value && setLeftMode(value as "chapters" | "outlines" | "world")}
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
                        onSelectOutline={setSelectedOutline}
                      />
                    </Show>
                    <Show when={leftMode() === "world"}>
                      <WorldSidebar
                        novelID={novelID}
                        selectedEntryId={selectedWorldEntryId}
                        onSelect={setSelectedWorldEntryId}
                      />
                    </Show>
                  </div>
                </aside>

                {/* Center content */}
                <div class="flex-1 flex flex-col min-w-0">
                  <Show when={leftMode() === "chapters"}>
                    {/* Tabs */}
                    <div class="flex border-b border-v2-border-border-base px-8 py-2">
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
                      </SegmentedControlV2>
                    </div>

                    {/* Tab content */}
                    <div class="flex flex-col flex-1 min-h-0 px-8 py-6">
                      {activeTab() === "reading" ? (
                        <div class="flex flex-col h-full">
                          <ChapterReader
                            novelID={novelID()}
                            chapters={data.chapters}
                            selectedChapterId={selectedChapterId()}
                            onSelectChapter={selectChapter}
                          />
                          <Show when={selectedChapterId()}>
                            <ApprovalBar
                              novelID={novelID()}
                              chapterID={selectedChapterId()!}
                              status={data.chapters.find((c) => c.id === selectedChapterId())?.status ?? ""}
                            />
                          </Show>
                        </div>
                      ) : (
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
                      )}
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

                {/* Right panel slot */}
                <aside class="w-80 border-l border-v2-border-border-base flex flex-col min-h-0">
                  <div class="flex flex-col flex-1 min-h-0">
                    {/* Tab buttons — scrollable tab bar for 6+ items */}
                    <div class="flex border-b border-v2-border-border-base shrink-0 px-2">
                      <div class="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mb-px">
                        <For each={([
                          { key: "characters", label: () => language.t("novel.panel.characters") },
                          { key: "foreshadow", label: () => language.t("novel.panel.foreshadow") },
                          { key: "tension", label: () => language.t("novel.panel.tension") },
                          { key: "structure", label: () => language.t("novel.panel.structure") },
                          { key: "annotations", label: () => language.t("novel.panel.annotations") },
                          { key: "canvas", label: () => language.t("novel.panel.canvas") },
                        ] as const)}>
                          {(tab) => (
                            <button
                              type="button"
                              onClick={() => setPanelTab(tab.key as Parameters<typeof setPanelTab>[0])}
                              classList={{
                                "px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors shrink-0": true,
                                "border-v2-border-border-accent text-v2-text-text-base": panelTab() === tab.key,
                                "border-transparent text-v2-text-text-muted hover:text-v2-text-text-base hover:border-v2-border-border-weak": panelTab() !== tab.key,
                              }}
                            >
                              {tab.label()}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    {/* Tab content */}
                    <div class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <Show when={panelTab() === "characters"}>
                        <PanelCharacters
                          novelID={novelID}
                          selectedChapterId={selectedChapterId}
                          chapters={data.chapters}
                        />
                      </Show>
                      <Show when={panelTab() === "foreshadow"}>
                        <PanelForeshadow
                          novelID={novelID}
                          selectedChapterId={selectedChapterId}
                          chapters={data.chapters}
                        />
                      </Show>
                      <Show when={panelTab() === "tension"}>
                        <TensionChart
                          novelID={novelID}
                          selectedChapterId={selectedChapterId}
                          chapters={data.chapters}
                        />
                      </Show>
                      <Show when={panelTab() === "structure"}>
                        <StructurePanel
                          novelID={novelID}
                          selectedVolumeId={() => {
                            const ch = data.chapters.find((c: { id: string }) => c.id === selectedChapterId())
                            return ch?.volumeId ?? null
                          }}
                        />
                      </Show>
                      <Show when={panelTab() === "annotations"}>
                        <AnnotationPanel novelID={novelID} chapterID={selectedChapterId} />
                      </Show>
                      <Show when={panelTab() === "canvas"}>
                        <CanvasPanel novelID={novelID} />
                      </Show>
                    </div>
                  </div>
                </aside>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </Show>
  )
}
