import { type Accessor, createMemo, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useCharacters, useRelationships } from "@/context/novel-queries"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"

type Character = { id: string; name: string; role: string; description: string }
type Relationship = { id: string; charAId: string; charBId: string; type: string; description: string }

// 角色 role 对应的节点配色
const ROLE_COLORS: Record<string, string> = {
  protagonist: "#6366f1", // 主角 靛蓝
  major: "#0ea5e9", // 主要角色 天蓝
  supporting: "#64748b", // 配角 石板灰
  antagonist: "#ef4444", // 反派 红
  minor: "#a78bfa", // 次要 紫
}

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "#94a3b8"
}

type Translator = { t: (key: string, params?: Record<string, string | number>) => string }

function roleLabel(language: Translator, role: string): string {
  const key = `novel.character.role.${role}`
  const translated = language.t(key)
  return translated === key ? role : translated
}

type GraphNode = {
  id: string
  name: string
  role: string
  x: number
  y: number
  center: boolean
}

type EdgeView = {
  key: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  label: string
  dashed: boolean
}

/**
 * 单个角色的直接关系图。
 * 使用稳定的环形静态布局：中心为当前角色，周围节点按顺序固定在圆周上，
 * 避免动画/物理模拟导致节点和边错位。
 */
function EgoGraph(props: {
  novelID: Accessor<string>
  center: Character
  characters: readonly Character[]
  relationships: readonly Relationship[]
}) {
  const language = useLanguage()
  const [scale, setScale] = createSignal(1)
  const [offset, setOffset] = createSignal({ x: 0, y: 0 })
  const [hoverNode, setHoverNode] = createSignal<string | null>(null)
  const [size, setSize] = createSignal({ w: 800, h: 560 })

  let svgRef: SVGSVGElement | undefined
  let ro: ResizeObserver | undefined
  let panning = false
  let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

  const charById = createMemo(() => {
    const map = new Map<string, Character>()
    for (const c of props.characters) map.set(c.id, c)
    return map
  })

  const neighbors = createMemo<Character[]>(() => {
    const seen = new Set<string>()
    const out: Character[] = []
    for (const rel of props.relationships) {
      const otherId =
        rel.charAId === props.center.id ? rel.charBId : rel.charBId === props.center.id ? rel.charAId : null
      if (!otherId || otherId === props.center.id || seen.has(otherId)) continue
      const other = charById().get(otherId)
      if (other) {
        seen.add(otherId)
        out.push(other)
      }
    }
    return out
  })

  const directEdgeLabelMap = createMemo(() => {
    const map = new Map<string, string[]>()
    for (const rel of props.relationships) {
      const isDirect = rel.charAId === props.center.id || rel.charBId === props.center.id
      if (!isDirect) continue
      const otherId = rel.charAId === props.center.id ? rel.charBId : rel.charAId
      const label = rel.type?.trim()
      if (!label) continue
      const list = map.get(otherId) ?? []
      list.push(label)
      map.set(otherId, list)
    }
    return map
  })

  const layout = createMemo(() => {
    const count = neighbors().length
    const shortSide = Math.min(size().w, size().h)
    const radius = Math.max(130, Math.min(shortSide * 0.32, 130 + count * 18))
    const nodes: GraphNode[] = [
      { id: props.center.id, name: props.center.name, role: props.center.role, x: 0, y: 0, center: true },
    ]
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i / Math.max(count, 1)) * Math.PI * 2
      const c = neighbors()[i]
      nodes.push({
        id: c.id,
        name: c.name,
        role: c.role,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        center: false,
      })
    }
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges: EdgeView[] = []
    for (const node of nodes) {
      if (node.center) continue
      const labels = directEdgeLabelMap().get(node.id) ?? []
      edges.push({
        key: `center-${node.id}`,
        from: { x: 0, y: 0 },
        to: { x: node.x, y: node.y },
        label: labels.join(" / "),
        dashed: false,
      })
    }
    for (const rel of props.relationships) {
      if (rel.charAId === props.center.id || rel.charBId === props.center.id) continue
      const a = byId.get(rel.charAId)
      const b = byId.get(rel.charBId)
      if (!a || !b) continue
      edges.push({
        key: rel.id,
        from: { x: a.x, y: a.y },
        to: { x: b.x, y: b.y },
        label: rel.type?.trim() ?? "",
        dashed: true,
      })
    }
    return { nodes, edges }
  })

  onMount(() => {
    if (!svgRef) return
    const updateSize = () => {
      const rect = svgRef!.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height })
    }
    updateSize()
    ro = new ResizeObserver(updateSize)
    ro.observe(svgRef)
  })
  onCleanup(() => ro?.disconnect())

  function onMouseDown(e: MouseEvent) {
    panning = true
    panStart = { x: e.clientX, y: e.clientY, ox: offset().x, oy: offset().y }
  }
  function onMouseMove(e: MouseEvent) {
    if (!panning) return
    setOffset({ x: panStart.ox + (e.clientX - panStart.x), y: panStart.oy + (e.clientY - panStart.y) })
  }
  function onMouseUp() {
    panning = false
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const next = e.deltaY > 0 ? scale() * 0.9 : scale() * 1.1
    setScale(Math.max(0.5, Math.min(2, next)))
  }

  function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, ratio: number) {
    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
  }

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between px-4 py-2 border-b border-v2-border-border-base shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-3 h-3 rounded-full shrink-0" style={{ background: roleColor(props.center.role) }} />
          <span class="text-sm font-medium text-v2-text-text-base truncate">{props.center.name}</span>
          <Tag>{roleLabel(language, props.center.role)}</Tag>
          <span class="text-xs text-v2-text-text-muted">
            {language.t("novel.relations.directCount", { count: neighbors().length })}
          </span>
        </div>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded hover:bg-v2-background-bg-hover text-v2-text-text-muted"
          onClick={() => {
            setScale(1)
            setOffset({ x: 0, y: 0 })
          }}
        >
          {language.t("novel.relations.resetView")}
        </button>
      </div>

      <Show
        when={neighbors().length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-v2-text-text-faint italic">
            {language.t("novel.relations.noDirectRelations")}
          </div>
        }
      >
        <svg
          ref={svgRef}
          class="flex-1 w-full min-h-0 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${size().w / 2 + offset().x} ${size().h / 2 + offset().y}) scale(${scale()})`}>
            <For each={layout().edges}>
              {(edge) => {
                const labelPos = edgePoint(edge.from, edge.to, 0.55)
                return (
                  <>
                    <line
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      stroke={edge.dashed ? "#cbd5e1" : "#94a3b8"}
                      stroke-width={edge.dashed ? 1 : 1.5}
                      stroke-dasharray={edge.dashed ? "5 4" : undefined}
                    />
                    <Show when={edge.label}>
                      <text
                        x={labelPos.x}
                        y={labelPos.y - 5}
                        text-anchor="middle"
                        font-size="11"
                        fill="#64748b"
                        stroke="#ffffff"
                        stroke-width="3"
                        paint-order="stroke"
                        style={{ "pointer-events": "none" }}
                      >
                        {edge.label}
                      </text>
                    </Show>
                  </>
                )
              }}
            </For>

            <For each={layout().nodes}>
              {(n) => {
                const r = n.center ? 28 : 22
                return (
                  <g
                    transform={`translate(${n.x} ${n.y})`}
                    onMouseEnter={() => setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode(null)}
                  >
                    <circle
                      r={r}
                      fill={roleColor(n.role)}
                      stroke={hoverNode() === n.id ? "#0f172a" : "#ffffff"}
                      stroke-width={hoverNode() === n.id ? 3 : 2}
                    />
                    <text
                      text-anchor="middle"
                      dominant-baseline="central"
                      font-size={n.center ? "15" : "13"}
                      font-weight={600}
                      fill="#ffffff"
                      style={{ "pointer-events": "none" }}
                    >
                      {n.name.trim().charAt(0)}
                    </text>
                    <text
                      y={r + 16}
                      text-anchor="middle"
                      font-size="12"
                      font-weight={n.center ? 600 : 400}
                      fill="#334155"
                      stroke="#ffffff"
                      stroke-width="3"
                      paint-order="stroke"
                      style={{ "pointer-events": "none" }}
                    >
                      {n.name}
                    </text>
                  </g>
                )
              }}
            </For>
          </g>
        </svg>
      </Show>
    </div>
  )
}

/** 全局关系列表：展示所有角色之间的关系（边清单），点击可定位到具体角色。 */
function GlobalRelations(props: {
  characters: readonly Character[]
  relationships: readonly Relationship[]
  onSelectCharacter: (id: string) => void
}) {
  const language = useLanguage()
  const nameOf = (id: string) => props.characters.find((c) => c.id === id)?.name ?? "?"

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="px-4 py-2 border-b border-v2-border-border-base shrink-0">
        <h3 class="text-sm font-medium text-v2-text-text-base">{language.t("novel.relations.global")}</h3>
        <p class="text-xs text-v2-text-text-muted">
          {language.t("novel.relations.globalCount", { count: props.relationships.length })}
        </p>
      </div>
      <Show
        when={props.relationships.length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-v2-text-text-faint italic px-4 text-center">
            {language.t("novel.relations.empty")}
          </div>
        }
      >
        <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
          <For each={props.relationships}>
            {(rel) => (
              <button
                type="button"
                class="w-full text-left rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 hover:bg-v2-background-bg-hover px-3 py-2 transition-colors"
                onClick={() => props.onSelectCharacter(rel.charAId)}
              >
                <div class="flex items-center gap-2 flex-wrap text-xs">
                  <span class="font-medium text-v2-text-text-base">{nameOf(rel.charAId)}</span>
                  <span class="text-v2-text-text-muted">—</span>
                  <span class="px-1.5 py-0.5 rounded bg-v2-background-bg-hover text-v2-text-text-base">
                    {rel.type || "—"}
                  </span>
                  <span class="text-v2-text-text-muted">→</span>
                  <span class="font-medium text-v2-text-text-base">{nameOf(rel.charBId)}</span>
                </div>
                <Show when={rel.description}>
                  <p class="mt-1 text-xs text-v2-text-text-muted line-clamp-2">{rel.description}</p>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export type RelationsViewProps = {
  novelID: Accessor<string>
  selectedCharacterId: Accessor<string | null>
  onSelectCharacter: (id: string | null) => void
}

export default function RelationsView(props: RelationsViewProps) {
  const language = useLanguage()
  const charactersQuery = useCharacters(props.novelID)
  const relationshipsQuery = useRelationships(props.novelID)

  const characters = createMemo<readonly Character[]>(() => charactersQuery.data ?? [])
  const relationships = createMemo<readonly Relationship[]>(() => relationshipsQuery.data ?? [])

  const selectedCharacter = createMemo<Character | null>(() => {
    const id = props.selectedCharacterId()
    if (!id) return null
    return characters().find((c) => c.id === id) ?? null
  })

  // 每个角色的直接关系数量，用于左栏排序和徽标
  const degreeById = createMemo(() => {
    const map = new Map<string, number>()
    for (const rel of relationships()) {
      map.set(rel.charAId, (map.get(rel.charAId) ?? 0) + 1)
      map.set(rel.charBId, (map.get(rel.charBId) ?? 0) + 1)
    }
    return map
  })

  const sortedCharacters = createMemo(() =>
    [...characters()].sort((a, b) => (degreeById().get(b.id) ?? 0) - (degreeById().get(a.id) ?? 0)),
  )

  return (
    <div class="flex flex-1 min-h-0">
      {/* 左栏：全局 + 角色列表 */}
      <aside class="w-64 border-r border-v2-border-border-base flex flex-col min-h-0">
        <div class="px-3 py-2 border-b border-v2-border-border-base shrink-0">
          <h3 class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider">
            {language.t("novel.relations.title")}
          </h3>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1">
          <button
            type="button"
            class={`w-full text-left px-3 py-2 text-sm transition-colors ${
              props.selectedCharacterId() === null
                ? "bg-v2-background-bg-hover text-v2-text-text-base font-medium"
                : "text-v2-text-text-base hover:bg-v2-background-bg-hover"
            }`}
            onClick={() => props.onSelectCharacter(null)}
          >
            <span class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-v2-state-fg-info" />
              {language.t("novel.relations.global")}
            </span>
          </button>
          <div class="my-1 border-t border-v2-border-border-base mx-3" />
          <For each={sortedCharacters()}>
            {(c) => {
              const degree = () => degreeById().get(c.id) ?? 0
              return (
                <button
                  type="button"
                  class={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                    props.selectedCharacterId() === c.id
                      ? "bg-v2-background-bg-hover text-v2-text-text-base font-medium"
                      : "text-v2-text-text-base hover:bg-v2-background-bg-hover"
                  }`}
                  onClick={() => props.onSelectCharacter(c.id)}
                >
                  <span class="w-2 h-2 rounded-full shrink-0" style={{ background: roleColor(c.role) }} />
                  <span class="flex-1 min-w-0 truncate">{c.name}</span>
                  <Show when={degree() > 0}>
                    <span class="text-[10px] text-v2-text-text-faint shrink-0">{degree()}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </aside>

      {/* 中间内容：全局列表 or 人物关系图 */}
      <div class="flex-1 flex flex-col min-w-0 bg-v2-background-bg-base">
        <Show
          when={selectedCharacter()}
          fallback={
            <GlobalRelations
              characters={characters()}
              relationships={relationships()}
              onSelectCharacter={(id) => props.onSelectCharacter(id)}
            />
          }
        >
          {(c) => (
            <EgoGraph novelID={props.novelID} center={c()} characters={characters()} relationships={relationships()} />
          )}
        </Show>
      </div>
    </div>
  )
}
