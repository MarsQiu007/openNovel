/**
 * 设定中心 — 中央区节点路由（setting-center-tree design D2）。
 *
 * 按设定树选中节点渲染：显示标签组为节点类型的纯函数（displayTabs），
 * 标签选中态为局部 signal、按节点持久化键 reset，不进 URL / perBookState；
 * 旧地址重定向（?tab=relations|map）经一次性内存 pendingTab 首帧落到指定标签。
 * 六类挂接：条目详情 / 角色详情 + ego 图 / 世界观列表 + 地图 / 角色列表 + 关系图 /
 * 单页节点（书籍信息 / 伏笔 / 风格 / 灵魂 / 技法库 / 整理）。
 */
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useCharacters, useNovelDetail, useUpdateNovel, useWorldEntries } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import RelationsView from "./relations-view"
import MapView from "./map-view"
import { WorldEntryDetail } from "./world-entry-detail"
import { StyleGuideEditor } from "./style-guide-editor"
import { NovelSoulEditor } from "./novel-soul-editor"
import { SettingOrganizationPanel } from "./setting-organization"
import { PanelForeshadow } from "./panel-foreshadow"
import PanelTechniques from "./panel-techniques"
import { CharacterDetail, CharacterList } from "./panel-characters"
import { displayTabs, serializeSettingsNode, type SettingsNode, type SettingsTab } from "./settings-node"

const TAB_LABEL_KEYS: Record<SettingsTab, string> = {
  content: "novel.settings.tabContent",
  edit: "novel.settings.tabEdit",
  graph: "novel.settings.tabGraph",
  list: "novel.settings.tabList",
  map: "novel.map.tab",
}

const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

export type SettingsMainProps = {
  novelID: Accessor<string>
  node: Accessor<SettingsNode | null>
  /** 一次性内存标签（旧地址重定向），首帧消费后由 onConsumePendingTab 清除，不落盘 */
  pendingTab: Accessor<SettingsTab | null>
  onConsumePendingTab: () => void
  /** ego 图 / 关系图 / 列表内的深链跳转（选中其他角色或板块 root） */
  onSelectNode: (node: SettingsNode) => void
  onEntryDeleted: () => void
  onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  onSessionFocused?: (sessionID: string | null | undefined) => void
}

export function SettingsMain(props: SettingsMainProps) {
  const language = useLanguage()
  const charactersQuery = useCharacters(props.novelID)
  const characters = () => charactersQuery.data ?? []

  const worldEntryId = () => {
    const node = props.node()
    return node?.kind === "world-entry" ? node.entryId : null
  }
  const characterId = () => {
    const node = props.node()
    return node?.kind === "character" ? node.characterId : null
  }
  const kindIs = (kind: SettingsNode["kind"]) => props.node()?.kind === kind

  const tabs = createMemo(() => {
    const node = props.node()
    return node ? displayTabs(node) : null
  })

  const [tab, setTab] = createSignal<SettingsTab>("content")
  // 标签 reset 粒度 = 节点持久化键：切节点落默认标签；pendingTab 与节点同批到达时落指定标签。
  // 消费 pending 触发的二次重跑必须走「key 未变」分支——否则会把它打回默认标签。
  let lastNodeKey: string | null = null
  createEffect(() => {
    const node = props.node()
    const key = node ? serializeSettingsNode(node) : null
    const pending = props.pendingTab()
    if (key !== lastNodeKey) {
      lastNodeKey = key
      const list = node ? displayTabs(node) : null
      setTab(pending && list?.includes(pending) ? pending : (list?.[0] ?? "content"))
      return
    }
    if (pending) {
      const list = node ? displayTabs(node) : null
      if (list?.includes(pending)) setTab(pending)
      props.onConsumePendingTab()
    }
  })

  const pickCharacter = (id: string | null) => {
    if (id) props.onSelectNode({ kind: "character", characterId: id })
  }

  return (
    <div class="flex flex-col flex-1 min-h-0">
      <Show when={tabs()}>
        <div class="flex border-b border-v2-border-border-base px-6 py-2 shrink-0">
          <SegmentedControlV2
            value={tab()}
            onChange={(value) => {
              const next = value as SettingsTab
              if (tabs()!.includes(next)) setTab(next)
            }}
          >
            <For each={tabs()!}>
              {(item) => <SegmentedControlItemV2 value={item}>{language.t(TAB_LABEL_KEYS[item])}</SegmentedControlItemV2>}
            </For>
          </SegmentedControlV2>
        </div>
      </Show>

      <div class="flex flex-col flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Show when={!props.node()}>
          <div class="flex items-center justify-center flex-1 min-h-0 text-sm text-v2-text-text-muted">
            {language.t("novel.settings.selectNode")}
          </div>
        </Show>

        {/* —— 单页节点 —— */}
        <Show when={kindIs("book-info")}>
          <BookInfoForm novelID={props.novelID} />
        </Show>
        <Show when={kindIs("foreshadow")}>
          <PanelForeshadow novelID={props.novelID} selectedChapterId={() => null} chapters={[]} />
        </Show>
        <Show when={kindIs("style")}>
          <StyleGuideEditor novelID={props.novelID} />
        </Show>
        <Show when={kindIs("soul")}>
          <NovelSoulEditor novelID={props.novelID} />
        </Show>
        <Show when={kindIs("techniques")}>
          <PanelTechniques novelID={props.novelID()} />
        </Show>
        <Show when={kindIs("organization")}>
          <SettingOrganizationPanel novelID={props.novelID} />
        </Show>

        {/* —— 世界观板块 root：列表 / 地图 —— */}
        <Show when={kindIs("world")}>
          <Show
            when={tab() === "map"}
            fallback={<WorldOverviewList novelID={props.novelID} onSelectEntry={(id) => props.onSelectNode({ kind: "world-entry", entryId: id })} />}
          >
            <MapView novelID={props.novelID} />
          </Show>
        </Show>

        {/* —— 世界观条目：内容 / 编辑 —— */}
        <Show when={worldEntryId() !== null}>
          <WorldEntryDetail
            novelID={props.novelID}
            selectedEntryId={worldEntryId}
            editing={() => tab() === "edit"}
            onEditingChange={() => setTab("content")}
            onEntryDeleted={props.onEntryDeleted}
            onExecute={props.onExecute}
            onSessionFocused={props.onSessionFocused}
          />
        </Show>

        {/* —— 角色板块 root：列表 / 关系图 —— */}
        <Show when={kindIs("characters")}>
          <Show
            when={tab() === "graph"}
            fallback={
              <CharacterList
                characters={characters()}
                onSelect={(id) => props.onSelectNode({ kind: "character", characterId: id })}
                onCreated={(id) => props.onSelectNode({ kind: "character", characterId: id })}
                language={language}
                novelID={props.novelID}
                hideSearch
              />
            }
          >
            <RelationsView
              novelID={props.novelID}
              selectedCharacterId={() => null}
              onSelectCharacter={pickCharacter}
              globalView={() => (tab() === "graph" ? "graph" : "list")}
              onGlobalViewChange={(view) => setTab(view)}
            />
          </Show>
        </Show>

        {/* —— 角色节点：内容 / 编辑 / 图（ego 关系图） —— */}
        <Show when={characterId() !== null}>
          <Show
            when={tab() === "graph"}
            fallback={
              <Show when={characterId()} keyed>
                {(id) => {
                  const character = characters().find((c) => c.id === id)
                  return (
                    <Show when={character} keyed>
                      {(current) => (
                        <CharacterDetail
                          character={current}
                          characters={characters()}
                          onBack={() => props.onSelectNode({ kind: "characters" })}
                          language={language}
                          novelID={props.novelID}
                          selectedChapterId={() => null}
                          editing={() => tab() === "edit"}
                          onEditingChange={() => setTab("content")}
                        />
                      )}
                    </Show>
                  )
                }}
              </Show>
            }
          >
            <RelationsView
              novelID={props.novelID}
              selectedCharacterId={characterId}
              onSelectCharacter={pickCharacter}
            />
          </Show>
        </Show>
      </div>
    </div>
  )
}

/** 书籍信息节点：书名 / 简介 / 类型（拆分自头部编辑表单元数据部分，单一数据源）。 */
function BookInfoForm(props: { novelID: Accessor<string> }) {
  const language = useLanguage()
  const detail = useNovelDetail(props.novelID)
  const updateNovel = useUpdateNovel()
  const [title, setTitle] = createSignal("")
  const [synopsis, setSynopsis] = createSignal("")
  const [genre, setGenre] = createSignal<string>("")

  createEffect(() => {
    const data = detail.data
    if (!data) return
    setTitle(data.title)
    setSynopsis(data.synopsis)
    setGenre(data.genre)
  })

  async function save() {
    await updateNovel.mutateAsync({
      novelID: props.novelID(),
      title: title().trim() || undefined,
      synopsis: synopsis().trim() || undefined,
      genre: (genre() as (typeof GENRES)[number]) || undefined,
    })
    showToast({ variant: "success", title: language.t("novel.settings.bookInfo.saved") })
  }

  return (
    <div class="mx-auto flex max-w-3xl w-full flex-col gap-4 p-6">
      <Show
        when={!detail.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        }
      >
        <div class="flex items-center gap-3">
          <TextInputV2
            fluid
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder={language.t("novel.wizard.namePlaceholder")}
          />
          <SelectV2
            options={[...GENRES]}
            current={genre() as (typeof GENRES)[number]}
            label={(g) => language.t(`novel.genre.${g}`)}
            onSelect={(g) => g && setGenre(g)}
          />
        </div>
        <TextareaV2
          fluid
          value={synopsis()}
          onInput={(e) => setSynopsis(e.currentTarget.value)}
          placeholder={language.t("novel.wizard.description")}
          rows={6}
        />
        <div>
          <ButtonV2 variant="contrast" size="small" onClick={() => void save()} disabled={updateNovel.isPending}>
            {updateNovel.isPending ? language.t("novel.settings.entry.saving") : language.t("common.action.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}

/** 世界观板块 root「列表」标签：分类概览 + 条目计数，点击条目下钻到对应节点。 */
function WorldOverviewList(props: { novelID: Accessor<string>; onSelectEntry: (id: string) => void }) {
  const language = useLanguage()
  const query = useWorldEntries(props.novelID)

  const groups = createMemo(() => {
    const data = query.data
    if (!data) return new Map<string, NonNullable<typeof data>>()
    const groups = new Map<string, NonNullable<typeof data>>()
    for (const entry of data) {
      const cat = entry.category || language.t("novel.panel.world.uncategorized")
      const existing = groups.get(cat)
      if (existing) {
        groups.set(cat, [...existing, entry])
      } else {
        groups.set(cat, [entry])
      }
    }
    return groups
  })

  return (
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        }
      >
        <Show
          when={groups().size > 0}
          fallback={
            <p class="text-sm text-v2-text-text-muted px-4 py-8 text-center">
              {language.t("novel.panel.world.empty")}
            </p>
          }
        >
          <For each={Array.from(groups().entries())}>
            {([category, entries]) => (
              <div class="flex flex-col gap-1">
                <h4 class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider">
                  {category} ({entries.length})
                </h4>
                <For each={entries}>
                  {(entry) => (
                    <button
                      type="button"
                      class="truncate rounded px-3 py-2 text-left text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-02 transition-colors"
                      onClick={() => props.onSelectEntry(entry.id)}
                    >
                      {entry.title}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
