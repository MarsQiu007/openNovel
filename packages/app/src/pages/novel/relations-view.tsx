import { type Accessor, createEffect, createMemo, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useCharacters, useRelationships } from "@/context/novel-queries"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { useSpring } from "@opennovel-ai/ui/motion-spring"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { CharacterDetail } from "@/pages/novel/panel-characters"

type Character = {
  id: string
  name: string
  role: string
  description: string
  createdAt?: number
}
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
  fromId: string
  toId: string
  label: string
  dashed: boolean
}

/**
 * 单个角色的直接关系图。
 * 基础布局为稳定的环形静态布局：中心为当前角色，周围节点按顺序固定在圆周上。
 * 节点支持鼠标拖拽重新排布，拖拽后的位置被持久化直到点击"重置布局"。
 */
function EgoGraph(props: {
  novelID: Accessor<string>
  center: Character
  characters: readonly Character[]
  relationships: readonly Relationship[]
  onSelectCharacter?: (id: string) => void
}) {
  const language = useLanguage()
  const [scale, setScale] = createSignal(1)
  const [offset, setOffset] = createSignal({ x: 0, y: 0 })
  const [hoverNode, setHoverNode] = createSignal<string | null>(null)
  const [size, setSize] = createSignal({ w: 800, h: 560 })
  const [userOffsets, setUserOffsets] = createSignal<ReadonlyMap<string, { dx: number; dy: number }>>(new Map())
  const [draggingId, setDraggingId] = createSignal<string | null>(null)

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
    const offsets = userOffsets()
    const centerOffset = offsets.get(props.center.id) ?? { dx: 0, dy: 0 }
    const nodes: GraphNode[] = [
      {
        id: props.center.id,
        name: props.center.name,
        role: props.center.role,
        x: centerOffset.dx,
        y: centerOffset.dy,
        center: true,
      },
    ]
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i / Math.max(count, 1)) * Math.PI * 2
      const c = neighbors()[i]
      const o = offsets.get(c.id) ?? { dx: 0, dy: 0 }
      nodes.push({
        id: c.id,
        name: c.name,
        role: c.role,
        x: Math.cos(angle) * radius + o.dx,
        y: Math.sin(angle) * radius + o.dy,
        center: false,
      })
    }
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const center = byId.get(props.center.id)!
    const edges: EdgeView[] = []
    for (const node of nodes) {
      if (node.center) continue
      const labels = directEdgeLabelMap().get(node.id) ?? []
      edges.push({
        key: `center-${node.id}`,
        fromId: props.center.id,
        toId: node.id,
        from: { x: center.x, y: center.y },
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
        fromId: rel.charAId,
        toId: rel.charBId,
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

  function clientToSvg(clientX: number, clientY: number) {
    if (!svgRef) return { x: 0, y: 0 }
    const rect = svgRef.getBoundingClientRect()
    return {
      x: (clientX - rect.left - size().w / 2 - offset().x) / scale(),
      y: (clientY - rect.top - size().h / 2 - offset().y) / scale(),
    }
  }

  function currentPos(n: GraphNode) {
    const o = userOffsets().get(n.id)
    return { x: n.x + (o?.dx ?? 0), y: n.y + (o?.dy ?? 0) }
  }

  function startDrag(e: MouseEvent, n: GraphNode) {
    e.stopPropagation()
    e.preventDefault()
    setDraggingId(n.id)
    const base = currentPos(n)
    const grab = clientToSvg(e.clientX, e.clientY)
    const grabDx = grab.x - base.x
    const grabDy = grab.y - base.y

    const onMove = (ev: MouseEvent) => {
      const p = clientToSvg(ev.clientX, ev.clientY)
      setUserOffsets((prev) => {
        const next = new Map(prev)
        next.set(n.id, { dx: p.x - grabDx - n.x, dy: p.y - grabDy - n.y })
        return next
      })
    }
    const onUp = () => {
      setDraggingId(null)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function resetLayout() {
    setUserOffsets(new Map())
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
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="px-2 py-1 text-xs rounded hover:bg-v2-background-bg-hover text-v2-text-text-muted disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={resetLayout}
            disabled={userOffsets().size === 0}
            title={language.t("novel.relations.resetLayout")}
          >
            {language.t("novel.relations.resetLayout")}
          </button>
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
          style={{ "touch-action": "none" }}
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
                const isHighlighted = () => {
                  const id = draggingId()
                  return id !== null && (edge.fromId === id || edge.toId === id)
                }
                return (
                  <>
                    <line
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      stroke={isHighlighted() ? "#6366f1" : edge.dashed ? "#cbd5e1" : "#94a3b8"}
                      stroke-width={isHighlighted() ? 2.5 : edge.dashed ? 1 : 1.5}
                      stroke-dasharray={edge.dashed ? "5 4" : undefined}
                      style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
                    />
                    <Show when={edge.label}>
                      <text
                        x={labelPos.x}
                        y={labelPos.y - 5}
                        text-anchor="middle"
                        font-size="11"
                        fill={isHighlighted() ? "#4f46e5" : "#64748b"}
                        stroke="#ffffff"
                        stroke-width="3"
                        paint-order="stroke"
                        style={{ "pointer-events": "none", transition: "fill 0.15s" }}
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
                const isHovered = () => hoverNode() === n.id
                const isDragging = () => draggingId() === n.id
                const targetScale = () => {
                  if (isDragging()) return 1.12
                  if (isHovered()) return 1.08
                  return 1.0
                }
                const springScale = useSpring(targetScale, { visualDuration: 0.18, bounce: 0.25 })
                return (
                  <g
                    transform={`translate(${n.x} ${n.y}) scale(${springScale()})`}
                    onMouseEnter={() => setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode(null)}
                    onMouseDown={(e) => startDrag(e, n)}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelectCharacter?.(n.id)
                    }}
                    style={{ cursor: isDragging() ? "grabbing" : "pointer" }}
                  >
                    <circle
                      r={r}
                      fill={roleColor(n.role)}
                      stroke={isHovered() || isDragging() ? "#0f172a" : "#ffffff"}
                      stroke-width={isHovered() || isDragging() ? 3 : 2}
                      style={{ filter: isDragging() ? "drop-shadow(0 4px 6px rgba(15,23,42,0.3))" : undefined }}
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

/** 全局关系力导向图：以 Fruchterman-Reingold 简化算法绘制所有角色与所有关系。 */
function GlobalGraph(props: {
  novelID: Accessor<string>
  characters: readonly Character[]
  relationships: readonly Relationship[]
  onSelectCharacter?: (id: string) => void
}) {
  const language = useLanguage()
  const [scale, setScale] = createSignal(1)
  const [offset, setOffset] = createSignal({ x: 0, y: 0 })
  const [hoverNode, setHoverNode] = createSignal<string | null>(null)
  const [size, setSize] = createSignal({ w: 800, h: 560 })
  const [positions, setPositions] = createSignal<ReadonlyMap<string, { x: number; y: number }>>(new Map())
  const [userOffsets, setUserOffsets] = createSignal<ReadonlyMap<string, { dx: number; dy: number }>>(new Map())
  const [draggingId, setDraggingId] = createSignal<string | null>(null)

  let svgRef: SVGSVGElement | undefined
  let ro: ResizeObserver | undefined
  let panning = false
  let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

  // 主角锚定在图中心：力导向模拟中固定不动，其余节点自然环绕排布
  const protagonistId = createMemo(() => props.characters.find((c) => c.role === "protagonist")?.id)

  // Fruchterman-Reingold 简化版力导向算法
  function runSimulation() {
    const w = size().w
    const h = size().h
    const chars = props.characters
    if (chars.length === 0) {
      setPositions(new Map())
      return
    }
    const area = w * h
    const k = Math.sqrt(area / Math.max(chars.length, 1)) * 0.7

    // 初始位置：主角锚定原点，其余节点圆周 + 抖动，避免同点起始
    const pid = protagonistId()
    const nodes = chars.map((c, i) => {
      if (c.id === pid) {
        return { id: c.id, x: 0, y: 0, vx: 0, vy: 0, fixed: true }
      }
      const angle = (i / chars.length) * Math.PI * 2
      const r = Math.min(w, h) * 0.3
      return {
        id: c.id,
        x: Math.cos(angle) * r + (Math.random() - 0.5) * 40,
        y: Math.sin(angle) * r + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        fixed: false,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = props.relationships
      .map((r) => {
        const a = byId.get(r.charAId)
        const b = byId.get(r.charBId)
        return a && b ? { a, b } : null
      })
      .filter((e): e is { a: typeof nodes[number]; b: typeof nodes[number] } => e !== null)

    const iterations = 300
    let temperature = Math.min(w, h) * 0.12

    for (let iter = 0; iter < iterations; iter++) {
      // 1. 库仑斥力（任意节点对）
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].vx = 0
        nodes[i].vy = 0
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
          const force = (k * k) / dist
          nodes[i].vx += (dx / dist) * force
          nodes[i].vy += (dy / dist) * force
        }
      }
      // 2. 胡克引力（边）
      for (const { a, b } of edges) {
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = (dist * dist) / k
        a.vx -= (dx / dist) * force
        a.vy -= (dy / dist) * force
        b.vx += (dx / dist) * force
        b.vy += (dy / dist) * force
      }
      // 3. 中心向心力，避免漂出视野
      for (const n of nodes) {
        n.vx -= n.x * 0.005
        n.vy -= n.y * 0.005
      }
      // 4. 应用位移 + 温度衰减（主角锚定不动）
      for (const n of nodes) {
        if (n.fixed) continue
        const disp = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (disp < 0.001) continue
        const limit = Math.min(disp, temperature)
        n.x += (n.vx / disp) * limit
        n.y += (n.vy / disp) * limit
      }
      temperature *= 0.96
    }

    setPositions(new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])))
  }

  // 监听变化（角色集、关系集、画布尺寸）重新模拟
  createEffect(() => {
    props.characters
    props.relationships
    size()
    runSimulation()
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
    setScale(Math.max(0.3, Math.min(2.5, next)))
  }

  function clientToSvg(clientX: number, clientY: number) {
    if (!svgRef) return { x: 0, y: 0 }
    const rect = svgRef.getBoundingClientRect()
    return {
      x: (clientX - rect.left - size().w / 2 - offset().x) / scale(),
      y: (clientY - rect.top - size().h / 2 - offset().y) / scale(),
    }
  }

  function startDrag(e: MouseEvent, n: GraphNode) {
    e.stopPropagation()
    e.preventDefault()
    setDraggingId(n.id)
    const pos = positions().get(n.id) ?? { x: 0, y: 0 }
    const offsets = userOffsets()
    const o = offsets.get(n.id) ?? { dx: 0, dy: 0 }
    const base = { x: pos.x + o.dx, y: pos.y + o.dy }
    const grab = clientToSvg(e.clientX, e.clientY)
    const grabDx = grab.x - base.x
    const grabDy = grab.y - base.y
    const onMove = (ev: MouseEvent) => {
      const p = clientToSvg(ev.clientX, ev.clientY)
      setUserOffsets((prev) => {
        const next = new Map(prev)
        next.set(n.id, { dx: p.x - grabDx - pos.x, dy: p.y - grabDy - pos.y })
        return next
      })
    }
    const onUp = () => {
      setDraggingId(null)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function resetLayout() {
    setUserOffsets(new Map())
    runSimulation()
  }

  function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, ratio: number) {
    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
  }

  const layout = createMemo(() => {
    const pos = positions()
    const offsets = userOffsets()
    const pid = protagonistId()
    const nodes: GraphNode[] = props.characters.map((c) => {
      const p = pos.get(c.id) ?? { x: 0, y: 0 }
      const o = offsets.get(c.id) ?? { dx: 0, dy: 0 }
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        x: p.x + o.dx,
        y: p.y + o.dy,
        center: c.id === pid,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges: EdgeView[] = []
    for (const rel of props.relationships) {
      const a = byId.get(rel.charAId)
      const b = byId.get(rel.charBId)
      if (!a || !b) continue
      edges.push({
        key: rel.id,
        fromId: rel.charAId,
        toId: rel.charBId,
        from: { x: a.x, y: a.y },
        to: { x: b.x, y: b.y },
        label: rel.type?.trim() ?? "",
        dashed: false,
      })
    }
    return { nodes, edges }
  })

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between px-4 py-2 border-b border-v2-border-border-base shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-sm font-medium text-v2-text-text-base">{language.t("novel.relations.global")}</span>
          <span class="text-xs text-v2-text-text-muted">
            {language.t("novel.relations.graphCount", {
              characters: props.characters.length,
              relationships: props.relationships.length,
            })}
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="px-2 py-1 text-xs rounded hover:bg-v2-background-bg-hover text-v2-text-text-muted disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={resetLayout}
            disabled={userOffsets().size === 0}
            title={language.t("novel.relations.resetLayout")}
          >
            {language.t("novel.relations.resetLayout")}
          </button>
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
      </div>

      <Show
        when={props.characters.length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-v2-text-text-faint italic">
            {language.t("novel.relations.emptyGraph")}
          </div>
        }
      >
        <svg
          ref={svgRef}
          class="flex-1 w-full min-h-0 cursor-grab active:cursor-grabbing select-none"
          style={{ "touch-action": "none" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${size().w / 2 + offset().x} ${size().h / 2 + offset().y}) scale(${scale()})`}>
            <For each={layout().edges}>
              {(edge) => {
                const labelPos = edgePoint(edge.from, edge.to, 0.5)
                const isHighlighted = () => {
                  const id = hoverNode() ?? draggingId()
                  return id !== null && (edge.fromId === id || edge.toId === id)
                }
                return (
                  <>
                    <line
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      stroke={isHighlighted() ? "#6366f1" : "#94a3b8"}
                      stroke-width={isHighlighted() ? 2.5 : 1.2}
                      stroke-opacity={isHighlighted() ? 1 : 0.6}
                      style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
                    />
                    <Show when={edge.label}>
                      <text
                        x={labelPos.x}
                        y={labelPos.y - 4}
                        text-anchor="middle"
                        font-size="10"
                        fill={isHighlighted() ? "#4f46e5" : "#64748b"}
                        stroke="#ffffff"
                        stroke-width="3"
                        paint-order="stroke"
                        style={{ "pointer-events": "none", transition: "fill 0.15s" }}
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
                const isHovered = () => hoverNode() === n.id
                const isDragging = () => draggingId() === n.id
                const targetScale = () => {
                  if (isDragging()) return 1.15
                  if (isHovered()) return 1.1
                  return 1.0
                }
                const springScale = useSpring(targetScale, { visualDuration: 0.18, bounce: 0.25 })
                return (
                  <g
                    transform={`translate(${n.x} ${n.y}) scale(${springScale()})`}
                    onMouseEnter={() => setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode(null)}
                    onMouseDown={(e) => startDrag(e, n)}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelectCharacter?.(n.id)
                    }}
                    style={{ cursor: isDragging() ? "grabbing" : "pointer" }}
                  >
                    <circle
                      r={r}
                      fill={roleColor(n.role)}
                      stroke={isHovered() || isDragging() ? "#0f172a" : "#ffffff"}
                      stroke-width={isHovered() || isDragging() ? 3 : 2}
                      style={{ filter: isDragging() ? "drop-shadow(0 4px 6px rgba(15,23,42,0.3))" : undefined }}
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
                      font-weight={n.center ? 600 : 500}
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

/** 角色编辑抽屉：点击图节点后弹出，复用 CharacterDetail 的完整编辑能力。 */
function CharacterEditDrawer(props: {
  open: boolean
  characterId: string | null
  characters: readonly Character[]
  novelID: Accessor<string>
  onClose: () => void
}) {
  const language = useLanguage()

  const character = createMemo<Character | null>(() => {
    const id = props.characterId
    if (!id) return null
    return props.characters.find((c) => c.id === id) ?? null
  })

  return (
    <Drawer open={props.open} onOpenChange={(o) => { if (!o) props.onClose() }}>
      <DrawerContent>
        <Show when={character()} fallback={null}>
          {(c) => (
            <div class="flex w-full flex-1 min-h-0 flex-col">
              <CharacterDetail
                character={c()}
                characters={props.characters}
                onBack={props.onClose}
                onClose={props.onClose}
                language={language}
                novelID={props.novelID}
              />
            </div>
          )}
        </Show>
      </DrawerContent>
    </Drawer>
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

type GlobalViewMode = "list" | "graph"

export default function RelationsView(props: RelationsViewProps) {
  const language = useLanguage()
  const charactersQuery = useCharacters(props.novelID)
  const relationshipsQuery = useRelationships(props.novelID)

  const characters = createMemo<readonly Character[]>(() => charactersQuery.data ?? [])
  const relationships = createMemo<readonly Relationship[]>(() => relationshipsQuery.data ?? [])
  const [globalView, setGlobalView] = createSignal<GlobalViewMode>("list")
  const [editingCharacterId, setEditingCharacterId] = createSignal<string | null>(null)

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

      {/* 中间内容：全局列表 or 全局图 or 人物关系图 */}
      <div class="flex-1 flex flex-col min-w-0 bg-v2-background-bg-base">
        <Show
          when={selectedCharacter()}
          fallback={
            <>
              {/* 全局视图模式切换：列表 / 图 */}
              <div class="flex items-center gap-1 px-4 pt-2 shrink-0">
                <button
                  type="button"
                  class={`px-2.5 py-1 text-xs rounded transition-colors ${
                    globalView() === "list"
                      ? "bg-v2-background-bg-hover text-v2-text-text-base font-medium"
                      : "text-v2-text-text-muted hover:bg-v2-background-bg-hover"
                  }`}
                  onClick={() => setGlobalView("list")}
                >
                  {language.t("novel.relations.viewList")}
                </button>
                <button
                  type="button"
                  class={`px-2.5 py-1 text-xs rounded transition-colors ${
                    globalView() === "graph"
                      ? "bg-v2-background-bg-hover text-v2-text-text-base font-medium"
                      : "text-v2-text-text-muted hover:bg-v2-background-bg-hover"
                  }`}
                  onClick={() => setGlobalView("graph")}
                >
                  {language.t("novel.relations.viewGraph")}
                </button>
              </div>
              <div class="flex-1 min-h-0 flex flex-col">
                <Show
                  when={globalView() === "graph"}
                  fallback={
                    <GlobalRelations
                      characters={characters()}
                      relationships={relationships()}
                      onSelectCharacter={(id) => props.onSelectCharacter(id)}
                    />
                  }
                >
                  <GlobalGraph
                    novelID={props.novelID}
                    characters={characters()}
                    relationships={relationships()}
                    onSelectCharacter={(id) => setEditingCharacterId(id)}
                  />
                </Show>
              </div>
            </>
          }
        >
          {(c) => (
            <EgoGraph
              novelID={props.novelID}
              center={c()}
              characters={characters()}
              relationships={relationships()}
              onSelectCharacter={(id) => setEditingCharacterId(id)}
            />
          )}
        </Show>
      </div>

      <CharacterEditDrawer
        open={editingCharacterId() !== null}
        characterId={editingCharacterId()}
        characters={characters()}
        novelID={props.novelID}
        onClose={() => setEditingCharacterId(null)}
      />
    </div>
  )
}
