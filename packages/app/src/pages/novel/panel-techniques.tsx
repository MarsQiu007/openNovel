/**
 * 技法库面板：项目级技法资产列表、详情、维护和注入开关。
 *
 * 界面文案使用中文常量；数据由 technique API 提供，不在前端修改置信度等闭环字段。
 */
import { For, Show, createMemo, createSignal, type Component, type JSX } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { Switch } from "@opennovel-ai/ui/v2/switch-v2"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import type { Technique, TechniqueFeedback } from "@opennovel-ai/schema/technique"
import {
  useTechniques,
  useTechniqueDetail,
  useTechniqueInjection,
  useCreateTechnique,
  useUpdateTechnique,
  useDeleteTechnique,
  useSetTechniqueInjection,
} from "@/context/novel-queries"
import { useConfirmDelete } from "./confirm-dialog"
import { parseEvidenceText } from "./technique-utils"

type TechniqueLevel = Technique["level"]
type TechniqueStatus = Technique["status"]

type SelectOption<T extends string> = { value: T; label: string }

const LEVEL_OPTIONS: SelectOption<TechniqueLevel>[] = [
  { value: "paragraph", label: "段落" },
  { value: "sentence", label: "句子" },
  { value: "dialogue", label: "对话" },
  { value: "description", label: "描写" },
  { value: "transition", label: "过渡" },
]

const STATUS_OPTIONS: SelectOption<TechniqueStatus>[] = [
  { value: "unverified", label: "未验证" },
  { value: "verified", label: "已验证" },
  { value: "shadow", label: "影子" },
  { value: "archived", label: "归档" },
]

const ERROR_OPTIONS: SelectOption<"all" | TechniqueLevel | TechniqueStatus>[] = [
  { value: "all", label: "全部" },
]

function optionLabel<T extends string>(options: SelectOption<T>[], value: T | undefined, fallback = "未知") {
  return options.find((item) => item.value === value)?.label ?? fallback
}

function statusVariant(status: TechniqueStatus) {
  if (status === "verified") return "success"
  if (status === "unverified") return "warning"
  if (status === "archived") return "danger"
  return "info"
}


function formatEvidenceText(technique: Technique) {
  return technique.evidence
    .map((item) => [item.sourceTitle, item.sourceLocation, item.excerpt, item.annotation].join(" | "))
    .join("\n")
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return "操作失败"
}

function formatDate(value: number | null | undefined) {
  if (!value) return "未使用"
  return new Date(value).toLocaleString()
}

export default function PanelTechniques() {
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  const query = useTechniques()
  const injection = useTechniqueInjection()
  const setInjection = useSetTechniqueInjection()

  const techniques = createMemo(() => query.data ?? [])
  const selectedTechnique = createMemo(() => techniques().find((item) => item.id === selectedId()))

  const handleBack = () => {
    setSelectedId(null)
    setCreating(false)
  }

  return (
    <div class="flex h-full flex-col">
      <Show when={!selectedTechnique() && !creating()}>
        <div class="border-b border-v2-border-border-base px-4 py-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-medium text-v2-text-text-base">技法库</h3>
            <ButtonV2 size="small" icon="plus" onClick={() => setCreating(true)}>
              新建
            </ButtonV2>
          </div>
          <div class="mt-3 flex items-center justify-between gap-3 rounded-md bg-v2-background-bg-layer-02 px-3 py-2">
            <Switch
              checked={injection.data?.enabled ?? false}
              disabled={setInjection.isPending}
              onChange={(enabled: boolean) => setInjection.mutate({ enabled })}
            >
              技法注入
            </Switch>
            <span class="text-xs text-v2-text-text-muted">{injection.data?.enabled ? "开启" : "关闭"}</span>
          </div>
          <Show when={setInjection.error}>
            <p class="mt-2 text-xs text-v2-text-text-danger">{errorText(setInjection.error)}</p>
          </Show>
        </div>
      </Show>

      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex flex-1 items-center justify-center p-6">
            <p class="text-sm text-v2-text-text-muted">正在加载技法库…</p>
          </div>
        }
      >
        <Show when={!selectedTechnique() && !creating()} fallback={
          <TechniqueDetail
            technique={selectedTechnique()}
            onBack={handleBack}
            onCreate={() => setCreating(true)}
          />
        }>
          <Show when={!query.error} fallback={
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
              <p class="text-sm text-v2-text-text-muted">{errorText(query.error)}</p>
              <ButtonV2 size="small" variant="outline" onClick={() => void query.refetch()}>重试</ButtonV2>
            </div>
          }>
            <TechniqueList techniques={techniques()} onSelect={setSelectedId} />
          </Show>
        </Show>
      </Show>
    </div>
  )
}

function TechniqueList(props: { techniques: ReadonlyArray<Technique>; onSelect: (id: string) => void }) {
  const [search, setSearch] = createSignal("")
  const [level, setLevel] = createSignal<"all" | TechniqueLevel>("all")
  const [status, setStatus] = createSignal<"all" | TechniqueStatus>("all")

  const levelFilterOptions = [...ERROR_OPTIONS, ...LEVEL_OPTIONS] as SelectOption<"all" | TechniqueLevel>[]
  const statusFilterOptions = [...ERROR_OPTIONS, ...STATUS_OPTIONS] as SelectOption<"all" | TechniqueStatus>[]

  const filtered = createMemo(() => {
    const keyword = search().trim().toLowerCase()
    return props.techniques.filter((item) => {
      if (level() !== "all" && item.level !== level()) return false
      if (status() !== "all" && item.status !== status()) return false
      if (!keyword) return true
      const haystack = [item.name, item.principle, item.instruction, ...item.sceneTypes].join("\n").toLowerCase()
      return haystack.includes(keyword)
    })
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="space-y-2 border-b border-v2-border-border-base px-4 py-3">
        <TextInputV2
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="搜索名称、原理、指令或场景"
          appearance="base"
          fluid
        />
        <div class="grid grid-cols-2 gap-2">
          <SelectV2
            options={levelFilterOptions}
            value={(item) => item.value}
            label={(item) => item.label}
            current={levelFilterOptions.find((item) => item.value === level())}
            onSelect={(item) => setLevel(item?.value ?? "all")}
          />
          <SelectV2
            options={statusFilterOptions}
            value={(item) => item.value}
            label={(item) => item.label}
            current={statusFilterOptions.find((item) => item.value === status())}
            onSelect={(item) => setStatus(item?.value ?? "all")}
          />
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={filtered().length > 0}
          fallback={<p class="p-6 text-center text-sm text-v2-text-text-muted">还没有技法</p>}
        >
          <For each={filtered()}>
            {(technique) => (
              <button
                type="button"
                class="w-full border-b border-v2-border-border-base px-4 py-3 text-left transition hover:bg-v2-background-bg-layer-02"
                onClick={() => props.onSelect(technique.id)}
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-sm font-medium text-v2-text-text-base">{technique.name}</span>
                  <Tag variant={statusVariant(technique.status)}>{optionLabel(STATUS_OPTIONS, technique.status)}</Tag>
                </div>
                <Show when={technique.principle}>
                  <p class="mt-1 line-clamp-2 text-xs text-v2-text-text-muted">{technique.principle}</p>
                </Show>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <span class="text-xs text-v2-text-text-muted">置信度 {Math.round(technique.confidence * 100)}%</span>
                  <span class="text-xs text-v2-text-text-muted">{optionLabel(LEVEL_OPTIONS, technique.level)}</span>
                  <For each={technique.sceneTypes.slice(0, 3)}>
                    {(scene) => <Tag variant="neutral">{scene}</Tag>}
                  </For>
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function TechniqueDetail(props: {
  technique: Technique | undefined
  onBack: () => void
  onCreate: () => void
}) {
  const [editing, setEditing] = createSignal(false)
  const query = useTechniqueDetail(() => props.technique?.id ?? null)
  const confirmDelete = useConfirmDelete()
  const deleteTechnique = useDeleteTechnique()

  const feedbacks = createMemo(() => query.data?.feedbacks ?? [])

  const handleDelete = () => {
    const technique = props.technique
    if (!technique) return
    confirmDelete({
      title: "删除技法",
      message: `确定要删除「${technique.name}」吗？此操作不可逆。`,
      onConfirm: () => {
        deleteTechnique.mutate(
          { techniqueID: technique.id },
          { onSuccess: () => { props.onBack(); setEditing(false) } },
        )
      },
    })
  }

  return (
    <Show
      when={props.technique}
      fallback={
        <div class="min-h-0 flex-1">
          <TechniqueForm mode="create" onDone={props.onBack} />
        </div>
      }
    >
      {(technique) => (
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="border-b border-v2-border-border-base px-4 py-3">
            <div class="flex items-center gap-2">
              <ButtonV2 size="small" variant="ghost-muted" icon="chevron-down" onClick={props.onBack}>
                返回
              </ButtonV2>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-v2-text-text-base">{technique().name}</span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <Tag variant={statusVariant(technique().status)}>{optionLabel(STATUS_OPTIONS, technique().status)}</Tag>
              <span class="text-xs text-v2-text-text-muted">
                {optionLabel(LEVEL_OPTIONS, technique().level)} · 置信度 {Math.round(technique().confidence * 100)}%
              </span>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <Show when={!editing()} fallback={
              <TechniqueForm mode="edit" technique={technique()} onDone={() => setEditing(false)} />
            }>
              <div class="space-y-4">
                <DetailField label="原理" value={technique().principle || "未填写"} />
                <DetailField label="指令" value={technique().instruction} />
                <DetailField label="常见误用" value={technique().commonMisuse || "未填写"} />
                <div>
                  <h4 class="text-xs font-medium uppercase tracking-wider text-v2-text-text-muted">场景标签</h4>
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    <For each={technique().sceneTypes}>{(scene) => <Tag variant="neutral">{scene}</Tag>}</For>
                  </div>
                </div>
                <div>
                  <h4 class="text-xs font-medium uppercase tracking-wider text-v2-text-text-muted">证据</h4>
                  <Show
                    when={technique().evidence.length > 0}
                    fallback={<p class="mt-1 text-sm text-v2-text-text-muted">暂无证据</p>}
                  >
                    <For each={technique().evidence}>
                      {(evidence) => (
                        <div class="mt-2 rounded-md bg-v2-background-bg-layer-02 p-3">
                          <p class="text-xs text-v2-text-text-muted">
                            {[evidence.sourceTitle, evidence.sourceLocation].filter(Boolean).join(" · ")}
                          </p>
                          <p class="mt-1 text-sm text-v2-text-text-base">{evidence.excerpt}</p>
                          <Show when={evidence.annotation}>
                            <p class="mt-1 text-xs text-v2-text-text-muted">{evidence.annotation}</p>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
                <div>
                  <h4 class="text-xs font-medium uppercase tracking-wider text-v2-text-text-muted">反馈记录</h4>
                  <Show
                    when={feedbacks().length > 0}
                    fallback={<p class="mt-1 text-sm text-v2-text-text-muted">暂无反馈</p>}
                  >
                    <For each={feedbacks()}>
                      {(feedback) => (
                        <div class="mt-2 rounded-md bg-v2-background-bg-layer-02 p-3">
                          <div class="flex items-center justify-between">
                            <span class="text-sm text-v2-text-text-base">
                              评分 {Math.round(feedback.score * 100)}%{feedback.wasUsed ? " · 已使用" : ""}
                            </span>
                            <span class="text-xs text-v2-text-text-muted">{formatDate(feedback.createdAt)}</span>
                          </div>
                          <Show when={feedback.comment}>
                            <p class="mt-1 text-xs text-v2-text-text-muted">{feedback.comment}</p>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          <Show when={!editing()}>
            <div class="flex items-center gap-2 border-t border-v2-border-border-base px-4 py-3">
              <ButtonV2 size="small" variant="outline" onClick={() => setEditing(true)}>编辑</ButtonV2>
              <ButtonV2 size="small" variant="danger" onClick={handleDelete}>删除</ButtonV2>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}

function DetailField(props: { label: string; value: string }) {
  return (
    <div>
      <h4 class="text-xs font-medium uppercase tracking-wider text-v2-text-text-muted">{props.label}</h4>
      <p class="mt-1 whitespace-pre-wrap text-sm text-v2-text-text-base">{props.value}</p>
    </div>
  )
}

function TechniqueForm(props: {
  mode: "create" | "edit"
  technique?: Technique
  onDone: () => void
}) {
  const [name, setName] = createSignal(props.technique?.name ?? "")
  const [principle, setPrinciple] = createSignal(props.technique?.principle ?? "")
  const [instruction, setInstruction] = createSignal(props.technique?.instruction ?? "")
  const [scenes, setScenes] = createSignal(props.technique?.sceneTypes.join(", ") ?? "general")
  const [level, setLevel] = createSignal<TechniqueLevel>(props.technique?.level ?? "paragraph")
  const [status, setStatus] = createSignal<TechniqueStatus>(props.technique?.status ?? "unverified")
  const [commonMisuse, setCommonMisuse] = createSignal(props.technique?.commonMisuse ?? "")
  const [evidence, setEvidence] = createSignal(props.technique ? formatEvidenceText(props.technique) : "")
  const [touched, setTouched] = createSignal(false)

  const createTechnique = useCreateTechnique()
  const updateTechnique = useUpdateTechnique()
  const saving = createTechnique.isPending || updateTechnique.isPending
  const mutationError = createMemo(() => createTechnique.error ?? updateTechnique.error)
  const nameInvalid = () => touched() && name().trim().length === 0
  const instructionInvalid = () => touched() && instruction().trim().length === 0

  const submit = () => {
    setTouched(true)
    if (!name().trim() || !instruction().trim()) return
    const payload = {
      name: name().trim(),
      instruction: instruction().trim(),
      principle: principle().trim(),
      sceneTypes: scenes().split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      level: level(),
      status: status(),
      commonMisuse: commonMisuse().trim(),
      evidence: parseEvidenceText(evidence()),
    }
    if (props.mode === "create") {
      createTechnique.mutate(payload, { onSuccess: props.onDone })
      return
    }
    const technique = props.technique
    if (!technique) return
    updateTechnique.mutate({ ...payload, techniqueID: technique.id }, { onSuccess: props.onDone })
  }

  return (
    <div class="space-y-3">
      <FormField label="名称">
        <TextInputV2 value={name()} onInput={(event) => setName(event.currentTarget.value)} invalid={nameInvalid()} fluid />
        <Show when={nameInvalid()}>
          <p class="mt-1 text-xs text-v2-text-text-danger">名称必填</p>
        </Show>
      </FormField>
      <FormField label="原理">
        <TextareaV2 value={principle()} onInput={(event) => setPrinciple(event.currentTarget.value)} rows={3} fluid />
      </FormField>
      <FormField label="指令">
        <TextareaV2
          value={instruction()}
          onInput={(event) => setInstruction(event.currentTarget.value)}
          invalid={instructionInvalid()}
          rows={5}
          fluid
        />
        <Show when={instructionInvalid()}>
          <p class="mt-1 text-xs text-v2-text-text-danger">指令必填</p>
        </Show>
      </FormField>
      <FormField label="场景标签（用逗号分隔）">
        <TextInputV2 value={scenes()} onInput={(event) => setScenes(event.currentTarget.value)} fluid />
      </FormField>
      <div class="grid grid-cols-2 gap-2">
        <FormField label="层级">
          <SelectV2
            options={LEVEL_OPTIONS}
            value={(item) => item.value}
            label={(item) => item.label}
            current={LEVEL_OPTIONS.find((item) => item.value === level())}
            onSelect={(item) => { const value = item?.value; if (value) setLevel(value) }}
          />
        </FormField>
        <FormField label="状态">
          <SelectV2
            options={STATUS_OPTIONS}
            value={(item) => item.value}
            label={(item) => item.label}
            current={STATUS_OPTIONS.find((item) => item.value === status())}
            onSelect={(item) => { const value = item?.value; if (value) setStatus(value) }}
          />
        </FormField>
      </div>
      <FormField label="常见误用">
        <TextareaV2 value={commonMisuse()} onInput={(event) => setCommonMisuse(event.currentTarget.value)} rows={3} fluid />
      </FormField>
      <FormField label="证据（每行：来源 | 位置 | 摘录 | 注释）">
        <TextareaV2 value={evidence()} onInput={(event) => setEvidence(event.currentTarget.value)} rows={4} fluid />
      </FormField>

      <Show when={mutationError()}>
        <p class="text-xs text-v2-text-text-danger">{errorText(mutationError())}</p>
      </Show>

      <div class="flex items-center gap-2">
        <ButtonV2 size="small" onClick={submit} disabled={saving}>
          {props.mode === "create" ? "创建" : "保存"}
        </ButtonV2>
        <ButtonV2 size="small" variant="ghost" onClick={props.onDone}>取消</ButtonV2>
      </div>
    </div>
  )
}

function FormField(props: { label: string; children: JSX.Element }) {
  return (
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-v2-text-text-muted">{props.label}</span>
      {props.children}
    </label>
  )
}