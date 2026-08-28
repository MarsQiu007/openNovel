/**
 * 大纲画布布局 — 纯逻辑模块
 *
 * 负责画布布局 JSON 的 schema 校验、自动布局生成和迁移。
 * 只存 UI 坐标和视图状态，不污染 Markdown 大纲。
 */

export type CanvasColumn = {
  id: string
  x: number
  width: number
}

export type CanvasCard = {
  id: string
  x: number
  y: number
  columnId: string | null
}

export type CanvasLayout = {
  columns: CanvasColumn[]
  cards: CanvasCard[]
  viewport?: { x: number; y: number; zoom: number }
}

/**
 * 校验并规范化画布布局。损坏时返回自动布局作为回退，不阻塞大纲读写。
 */
export function sanitizeLayout(raw: unknown, fallback?: CanvasLayout): CanvasLayout {
  if (!raw || typeof raw !== "object") return fallback ?? defaultLayout()
  const obj = raw as Record<string, unknown>
  const columns = Array.isArray(obj.columns) ? obj.columns.filter(isColumn) : []
  const cards = Array.isArray(obj.cards) ? obj.cards.filter(isCard) : []
  if (columns.length === 0 && cards.length === 0) return fallback ?? defaultLayout()
  return { columns, cards, viewport: isViewport(obj.viewport) ? obj.viewport : undefined }
}

function isColumn(v: unknown): v is CanvasColumn {
  if (!v || typeof v !== "object") return false
  const c = v as Record<string, unknown>
  return typeof c.id === "string" && typeof c.x === "number" && typeof c.width === "number"
}

function isCard(v: unknown): v is CanvasCard {
  if (!v || typeof v !== "object") return false
  const c = v as Record<string, unknown>
  return (
    typeof c.id === "string" &&
    typeof c.x === "number" &&
    typeof c.y === "number" &&
    (typeof c.columnId === "string" || c.columnId == null)
  )
}

function isViewport(v: unknown): v is { x: number; y: number; zoom: number } {
  if (!v || typeof v !== "object") return false
  const vp = v as Record<string, unknown>
  return typeof vp.x === "number" && typeof vp.y === "number" && typeof vp.zoom === "number"
}

/**
 * 根据卷和章节数据生成默认自动布局。
 * 卷为列，章节为卡，按顺序排列。
 */
export function defaultLayout(
  volumes: Array<{ id: string; order: number }> = [],
  chapters: Array<{ id: string; order: number; volume_id: string | null }> = [],
): CanvasLayout {
  const columnWidth = 280
  const columnGap = 16
  const cardHeight = 80
  const columnHeaderHeight = 28
  const cardGap = 8
  const sortedVolumes = [...volumes].sort((a, b) => a.order - b.order)
  const columns: CanvasColumn[] = sortedVolumes.map((v, i) => ({
    id: v.id,
    x: i * (columnWidth + columnGap),
    width: columnWidth,
  }))
  const cards: CanvasCard[] = []
  for (const col of columns) {
    const colChapters = chapters
      .filter((c) => c.volume_id === col.id)
      .sort((a, b) => a.order - b.order)
    colChapters.forEach((ch, i) => {
      cards.push({
        id: ch.id,
        x: col.x,
        y: columnHeaderHeight + i * (cardHeight + cardGap),
        columnId: col.id,
      })
    })
  }
  const unassigned = chapters.filter((c) => !c.volume_id).sort((a, b) => a.order - b.order)
  const freeX = sortedVolumes.length * (columnWidth + columnGap)
  unassigned.forEach((ch, i) => {
    cards.push({ id: ch.id, x: freeX, y: i * (cardHeight + cardGap), columnId: null })
  })
  return { columns, cards, viewport: { x: 0, y: 0, zoom: 1 } }
}
