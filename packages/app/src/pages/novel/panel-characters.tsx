import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import {
  useCharacters,
  useCreateCharacter,
  useUpdateCharacter,
  useDeleteCharacter,
  useRelationships,
  useCreateRelationship,
  useDeleteRelationship,
  useCharacterStates,
  useCreateCharacterState,
  useUpdateCharacterState,
  useDeleteCharacterState,
  useAllCharacterStates,
} from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Marked } from "marked"

const marked = new Marked()

function sanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
}

export type PanelCharactersProps = {
  novelID: Accessor<string>
  selectedChapterId: Accessor<string | null>
  chapters: ReadonlyArray<{ id: string; order: number; title: string }>
}

export default function PanelCharacters(props: PanelCharactersProps) {
  const language = useLanguage()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const query = useCharacters(props.novelID)
  const allStatesQuery = useAllCharacterStates(props.novelID)

  const characters = createMemo(() => query.data ?? [])

  const selectedCharacter = createMemo(() => {
    const id = selectedId()
    if (!id) return undefined
    return characters().find((c) => c.id === id)
  })

  const chapterOrder = (id: string | undefined | null) => {
    if (!id) return ""
    return props.chapters.find((c) => c.id === id)?.order ?? ""
  }

  const chapterStates = createMemo(() => {
    const id = props.selectedChapterId()
    if (!id) return []
    return (allStatesQuery.data ?? []).filter((s) => s.chapterId === id)
  })

  const handleBack = () => setSelectedId(null)

  return (
    <div class="flex flex-col flex-1 min-h-0">
      <Show when={chapterStates().length > 0}>
        <div class="px-3 py-2 border-b border-v2-border-border-base bg-v2-background-bg-layer-02 space-y-1.5">
          <h4 class="text-[11px] font-medium text-v2-text-text-muted uppercase tracking-wider">
            {language.t("novel.panel.currentChapter", { chapter: chapterOrder(props.selectedChapterId()) })}
          </h4>
          <For each={chapterStates()}>
            {(state) => {
              const ch = characters().find((c) => c.id === state.characterId)
              return (
                <div>
                  <span class="text-sm text-v2-text-text-base">{ch?.name ?? state.characterId}</span>
                  <Show when={state.location || state.mood}>
                    <span class="ml-2 text-xs text-v2-text-text-muted">
                      {[state.location, state.mood].filter(Boolean).join(" · ")}
                    </span>
                  </Show>
                  <Show when={state.summary}>
                    <p class="text-xs text-v2-text-text-muted">{state.summary}</p>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex items-center justify-center p-6">
            <p class="text-sm text-v2-text-text-muted">{language.t("novel.panel.characters.loading")}</p>
          </div>
        }
      >
        <Show
          when={!selectedCharacter()}
          fallback={
            <CharacterDetail
              character={selectedCharacter()!}
              characters={characters()}
              onBack={handleBack}
              language={language}
              novelID={props.novelID}
            />
          }
        >
          <CharacterList
            characters={characters()}
            onSelect={setSelectedId}
            language={language}
            novelID={props.novelID}
          />
        </Show>
      </Show>
    </div>
  )
}

function CharacterList(props: {
  characters: ReadonlyArray<{
    id: string
    name: string
    role: string
    description: string
    createdAt: number
  }>
  onSelect: (id: string) => void
  language: ReturnType<typeof useLanguage>
  novelID: Accessor<string>
}) {
  const [searchQuery, setSearchQuery] = createSignal("")
  const [isAdding, setIsAdding] = createSignal(false)
  const [name, setName] = createSignal("")
  const [role, setRole] = createSignal("")
  const [description, setDescription] = createSignal("")
  const createChar = useCreateCharacter()

  const filtered = createMemo(() => {
    const q = searchQuery().toLowerCase()
    if (!q) return props.characters
    return props.characters.filter((c) => c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  })

  const handleSubmit = async () => {
    if (!name().trim()) return
    await createChar.mutateAsync({
      novelID: props.novelID(),
      name: name().trim(),
      role: role().trim() || undefined,
      description: description().trim() || undefined,
    })
    setName("")
    setRole("")
    setDescription("")
    setIsAdding(false)
  }

  const handleCancel = () => {
    setName("")
    setRole("")
    setDescription("")
    setIsAdding(false)
  }

  return (
    <div class="flex flex-col flex-1 min-h-0">
      {/* Search */}
      <div class="px-3 py-2 border-b border-v2-border-border-base">
        <TextInputV2
          fluid
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder={props.language.t("novel.panel.characters.search")}
        />
      </div>

      {/* List */}
      <Show
        when={filtered().length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center p-6 text-center gap-2">
            <p class="text-sm text-v2-text-text-muted">
              {props.characters.length === 0
                ? props.language.t("novel.panel.characters.empty")
                : props.language.t("common.search.placeholder")}
            </p>
          </div>
        }
      >
        <div class="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For each={filtered()}>
            {(character) => (
              <button
                onClick={() => props.onSelect(character.id)}
                class="w-full text-left px-3 py-2.5 border-b border-v2-border-border-base hover:bg-v2-background-bg-layer-01 transition-colors"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-v2-text-text-base truncate">{character.name}</span>
                  <Tag class="shrink-0">{character.role}</Tag>
                </div>
                <p class="mt-0.5 text-xs text-v2-text-text-muted line-clamp-2">{character.description}</p>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Count and Add Button */}
      <div class="px-3 py-1.5 border-t border-v2-border-border-base flex items-center justify-between">
        <p class="text-xs text-v2-text-text-muted">
          {props.language.t("novel.panel.characters.count", {
            count: String(filtered().length),
          })}
        </p>
        <Show when={!isAdding()} fallback={null}>
          <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(true)}>
            +
          </ButtonV2>
        </Show>
      </div>

      {/* Add Character Form */}
      <Show when={isAdding()}>
        <div class="px-3 py-2 border-t border-v2-border-border-base bg-v2-background-bg-layer-01">
          <div class="space-y-2">
            <div>
              <label class="block text-xs text-v2-text-text-muted mb-1">
                {props.language.t("novel.panel.characters.name")} *
              </label>
              <TextInputV2 fluid type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </div>
            <div>
              <label class="block text-xs text-v2-text-text-muted mb-1">
                {props.language.t("novel.panel.characters.role")}
              </label>
              <TextInputV2 fluid type="text" value={role()} onInput={(e) => setRole(e.currentTarget.value)} />
            </div>
            <div>
              <label class="block text-xs text-v2-text-text-muted mb-1">
                {props.language.t("novel.panel.characters.description")}
              </label>
              <TextareaV2
                fluid
                class="resize-none"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                rows={3}
              />
            </div>
            <div class="flex gap-2">
              <ButtonV2
                variant="contrast"
                size="small"
                onClick={handleSubmit}
                disabled={!name().trim() || createChar.isPending}
              >
                {props.language.t("novel.panel.characters.save")}
              </ButtonV2>
              <ButtonV2 variant="outline" size="small" onClick={handleCancel}>
                {props.language.t("novel.panel.characters.cancel")}
              </ButtonV2>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

export function CharacterDetail(props: {
  character: {
    id: string
    name: string
    role: string
    description: string
    createdAt?: number
  }
  characters: ReadonlyArray<{
    id: string
    name: string
    role: string
    description: string
    createdAt?: number
  }>
  onBack: () => void
  onClose?: () => void
  language: ReturnType<typeof useLanguage>
  novelID: Accessor<string>
}) {
  const [isEditing, setIsEditing] = createSignal(false)
  const [name, setName] = createSignal(props.character.name)
  const [role, setRole] = createSignal(props.character.role)
  const [description, setDescription] = createSignal(props.character.description)
  const updateChar = useUpdateCharacter()
  const deleteChar = useDeleteCharacter()

  const descriptionHtml = createMemo(() =>
    sanitize(marked.parse(props.character.description, { async: false }) as string),
  )

  const handleEdit = () => {
    setName(props.character.name)
    setRole(props.character.role)
    setDescription(props.character.description)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!name().trim()) return
    await updateChar.mutateAsync({
      novelID: props.novelID(),
      characterID: props.character.id,
      name: name().trim(),
      role: role().trim() || undefined,
      description: description().trim() || undefined,
    })
    setIsEditing(false)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleDelete = async () => {
    await deleteChar.mutateAsync({
      novelID: props.novelID(),
      characterID: props.character.id,
    })
    if (props.onClose) props.onClose()
    else props.onBack()
  }

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Back button and Edit */}
      <div class="px-3 py-2 border-b border-v2-border-border-base flex items-center justify-between">
        <ButtonV2 variant="ghost" size="small" onClick={props.onBack}>
          {props.language.t("novel.panel.characters.back")}
        </ButtonV2>
        <div class="flex items-center gap-1">
          <Show when={!isEditing()}>
            <ButtonV2 variant="ghost" size="small" onClick={handleEdit}>
              {props.language.t("novel.panel.characters.edit")}
            </ButtonV2>
          </Show>
          <Show when={props.onClose}>
            <ButtonV2 variant="ghost" size="small" onClick={props.onClose} title="close">
              ×
            </ButtonV2>
          </Show>
        </div>
      </div>

      <Show
        when={isEditing()}
        fallback={
          <>
            {/* Header */}
            <div class="px-3 py-3 border-b border-v2-border-border-base">
              <h3 class="text-base font-semibold text-v2-text-text-base">{props.character.name}</h3>
              <Tag class="mt-1">{props.character.role}</Tag>
            </div>

            {/* Description */}
            <div class="px-3 py-3 border-b border-v2-border-border-base">
              <h4 class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider mb-1.5">
                {props.language.t("novel.panel.characters.description")}
              </h4>
              <div
                class="prose prose-sm max-w-none text-v2-text-text-base leading-relaxed"
                innerHTML={descriptionHtml()}
              />
            </div>

            {/* Character states */}
            <StatesSection novelID={props.novelID} characterID={props.character.id} language={props.language} />

            {/* Relationships */}
            <RelationshipsSection
              novelID={props.novelID}
              characterID={props.character.id}
              characters={props.characters}
              language={props.language}
            />

            {/* Delete Button */}
            <div class="px-3 py-3 border-t border-v2-border-border-base mt-auto">
              <ButtonV2 variant="danger" class="w-full" onClick={handleDelete} disabled={deleteChar.isPending}>
                {props.language.t("novel.panel.characters.delete")}
              </ButtonV2>
            </div>
          </>
        }
      >
        {/* Edit Mode */}
        <div class="px-3 py-3 flex flex-1 flex-col gap-3 min-h-0">
          <div class="shrink-0">
            <label class="block text-xs text-v2-text-text-muted mb-1">
              {props.language.t("novel.panel.characters.name")} *
            </label>
            <TextInputV2 fluid type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
          <div class="shrink-0">
            <label class="block text-xs text-v2-text-text-muted mb-1">
              {props.language.t("novel.panel.characters.role")}
            </label>
            <TextInputV2 fluid type="text" value={role()} onInput={(e) => setRole(e.currentTarget.value)} />
          </div>
          <div class="flex flex-1 flex-col min-h-0">
            <label class="block text-xs text-v2-text-text-muted mb-1 shrink-0">
              {props.language.t("novel.panel.characters.description")}
            </label>
            <TextareaV2
              fluid
              class="resize-none flex-1!"
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </div>
          <div class="flex gap-2 shrink-0">
            <ButtonV2
              variant="contrast"
              size="small"
              onClick={handleSave}
              disabled={!name().trim() || updateChar.isPending}
            >
              {props.language.t("novel.panel.characters.save")}
            </ButtonV2>
            <ButtonV2 variant="outline" size="small" onClick={handleCancel}>
              {props.language.t("novel.panel.characters.cancel")}
            </ButtonV2>
          </div>
        </div>
      </Show>
    </div>
  )
}

export function StatesSection(props: {
  novelID: Accessor<string>
  characterID: string
  language: ReturnType<typeof useLanguage>
}) {
  const statesQuery = useCharacterStates(props.novelID, () => props.characterID)
  const createState = useCreateCharacterState()
  const updateState = useUpdateCharacterState()
  const deleteState = useDeleteCharacterState()
  const [isAdding, setIsAdding] = createSignal(false)
  const [place, setPlace] = createSignal("")
  const [mood, setMood] = createSignal("")
  const [summary, setSummary] = createSignal("")

  const states = createMemo(() => statesQuery.data ?? [])

  const handleAdd = async () => {
    if (!place().trim() && !mood().trim() && !summary().trim()) return
    await createState.mutateAsync({
      novelID: props.novelID(),
      characterID: props.characterID,
      place: place().trim() || undefined,
      mood: mood().trim() || undefined,
      summary: summary().trim() || undefined,
    })
    setPlace("")
    setMood("")
    setSummary("")
    setIsAdding(false)
  }

  return (
    <div class="px-3 py-3 border-b border-v2-border-border-base">
      <div class="flex items-center justify-between mb-1.5">
        <h4 class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider">
          {props.language.t("novel.panel.characters.states")}
        </h4>
        <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(!isAdding())}>
          {isAdding() ? props.language.t("novel.panel.characters.cancel") : "+"}
        </ButtonV2>
      </div>

      <Show
        when={states().length > 0}
        fallback={
          <p class="text-xs text-v2-text-text-muted italic">
            {props.language.t("novel.panel.characters.states.empty")}
          </p>
        }
      >
        <div class="space-y-2">
          <For each={states()}>
            {(state) => (
              <div class="group flex items-start gap-2">
                <button
                  onClick={() =>
                    void updateState.mutateAsync({
                      novelID: props.novelID(),
                      characterID: props.characterID,
                      stateID: state.id,
                      active: state.active ? 0 : 1,
                    })
                  }
                  class={`mt-1 shrink-0 w-2 h-2 rounded-full ${state.active ? "bg-v2-state-fg-success" : "bg-v2-icon-icon-muted"}`}
                  type="button"
                  title={props.language.t(
                    state.active ? "novel.panel.characters.state.active" : "novel.panel.characters.state.inactive",
                  )}
                />
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-v2-text-text-base">
                    {[state.location, state.mood].filter(Boolean).join(" · ")}
                  </p>
                  <Show when={state.summary}>
                    <p class="text-xs text-v2-text-text-muted">{state.summary}</p>
                  </Show>
                </div>
                <button
                  onClick={() =>
                    void deleteState.mutateAsync({
                      novelID: props.novelID(),
                      characterID: props.characterID,
                      stateID: state.id,
                    })
                  }
                  class="opacity-0 group-hover:opacity-100 shrink-0 text-xs text-v2-text-text-faint hover:text-v2-state-fg-danger transition-opacity"
                  type="button"
                  title={props.language.t("common.action.delete")}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={isAdding()}>
        <div class="mt-2 space-y-2 rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2">
          <TextInputV2
            fluid
            type="text"
            value={place()}
            onInput={(e) => setPlace(e.currentTarget.value)}
            placeholder={props.language.t("novel.panel.characters.state.place")}
          />
          <TextInputV2
            fluid
            type="text"
            value={mood()}
            onInput={(e) => setMood(e.currentTarget.value)}
            placeholder={props.language.t("novel.panel.characters.state.mood")}
          />
          <TextInputV2
            fluid
            type="text"
            value={summary()}
            onInput={(e) => setSummary(e.currentTarget.value)}
            placeholder={props.language.t("novel.panel.characters.state.summary")}
          />
          <ButtonV2 variant="contrast" size="small" onClick={() => void handleAdd()} disabled={createState.isPending}>
            {props.language.t("novel.panel.characters.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}

export function RelationshipsSection(props: {
  novelID: Accessor<string>
  characterID: string
  characters: ReadonlyArray<{ id: string; name: string }>
  language: ReturnType<typeof useLanguage>
}) {
  const relQuery = useRelationships(props.novelID)
  const createRel = useCreateRelationship()
  const deleteRel = useDeleteRelationship()
  const [isAdding, setIsAdding] = createSignal(false)
  const [targetId, setTargetId] = createSignal("")
  const [type, setType] = createSignal("")
  const [description, setDescription] = createSignal("")

  const mine = createMemo(() =>
    (relQuery.data ?? []).filter((r) => r.charAId === props.characterID || r.charBId === props.characterID),
  )

  const otherName = (r: { charAId: string; charBId: string }) => {
    const otherId = r.charAId === props.characterID ? r.charBId : r.charAId
    return props.characters.find((c) => c.id === otherId)?.name ?? otherId
  }

  const candidates = createMemo(() => props.characters.filter((c) => c.id !== props.characterID))

  const handleAdd = async () => {
    if (!targetId() || !type().trim()) return
    await createRel.mutateAsync({
      novelID: props.novelID(),
      charAId: props.characterID,
      charBId: targetId(),
      type: type().trim(),
      description: description().trim() || undefined,
    })
    setTargetId("")
    setType("")
    setDescription("")
    setIsAdding(false)
  }

  return (
    <div class="px-3 py-3">
      <div class="flex items-center justify-between mb-1.5">
        <h4 class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider">
          {props.language.t("novel.panel.characters.relationships")}
        </h4>
        <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(!isAdding())}>
          {isAdding() ? props.language.t("novel.panel.characters.cancel") : "+"}
        </ButtonV2>
      </div>

      <Show
        when={mine().length > 0}
        fallback={
          <p class="text-xs text-v2-text-text-muted italic">
            {props.language.t("novel.panel.characters.relationships.empty")}
          </p>
        }
      >
        <div class="space-y-2">
          <For each={mine()}>
            {(rel) => (
              <div class="group flex items-start gap-2">
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-v2-text-text-base">
                    <Tag>{rel.type}</Tag> {otherName(rel)}
                  </p>
                  <Show when={rel.description}>
                    <p class="mt-0.5 text-xs text-v2-text-text-muted">{rel.description}</p>
                  </Show>
                </div>
                <button
                  onClick={() => void deleteRel.mutateAsync({ novelID: props.novelID(), relationshipID: rel.id })}
                  class="opacity-0 group-hover:opacity-100 shrink-0 text-xs text-v2-text-text-faint hover:text-v2-state-fg-danger transition-opacity"
                  type="button"
                  title={props.language.t("common.action.delete")}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={isAdding()}>
        <div class="mt-2 space-y-2 rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2">
          <SelectV2
            class="w-full"
            options={candidates()}
            current={candidates().find((c) => c.id === targetId())}
            value={(c) => c.id}
            label={(c) => c.name}
            placeholder={props.language.t("novel.panel.characters.rel.target")}
            onSelect={(c) => setTargetId(c?.id ?? "")}
          />
          <TextInputV2
            fluid
            type="text"
            value={type()}
            onInput={(e) => setType(e.currentTarget.value)}
            placeholder={props.language.t("novel.panel.characters.rel.typePlaceholder")}
          />
          <TextInputV2
            fluid
            type="text"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder={props.language.t("novel.panel.characters.rel.description")}
          />
          <ButtonV2
            variant="contrast"
            size="small"
            onClick={() => void handleAdd()}
            disabled={!targetId() || !type().trim() || createRel.isPending}
          >
            {props.language.t("novel.panel.characters.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
