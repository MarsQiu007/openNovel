/**
 * 实体引用确定性扫描。
 *
 * 把角色 / 世界观条目 / 剧情线按名称在正文或长文本字段中的出现位置
 * 记录到 entity_refs，供设定变更影响分析引用。
 *
 * 本模块由 plugin 下沉至 novel-store：升级回填（derived-data-upgrade）的
 * Phase 1 需要在 server 可达的存储层复用引用扫描。
 */

import { and, eq } from "drizzle-orm"
import {
  getDb,
  CharacterTable,
  EntityRefTable,
  PlotThreadTable,
  WorldEntryTable,
  type Db,
} from "./index.js"
import { computeFingerprint } from "./manual-edit-sync.js"

/**
 * 扫描 content 中对角色 / 世界观条目 / 剧情线的引用并写入 entity_refs。
 *
 * 先清空该 (source_type, source_id, ref_field) 下的旧引用再写入，
 * 同名实体只记录首次出现位置的上下文片段。
 */
export async function scanEntityReferences(
  db: Db,
  novelId: string,
  sourceType: string,
  sourceId: string,
  field: string,
  content: string,
): Promise<number> {
  await db
    .delete(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.source_type, sourceType),
        eq(EntityRefTable.source_id, sourceId),
        eq(EntityRefTable.ref_field, field),
      ),
    )
    .run()

  if (!content) return 0

  const characters = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  const worldEntries = await db
    .select({ id: WorldEntryTable.id, title: WorldEntryTable.title })
    .from(WorldEntryTable)
    .where(eq(WorldEntryTable.novel_id, novelId))
    .all()
  const plotThreads = await db
    .select({ id: PlotThreadTable.id, title: PlotThreadTable.title })
    .from(PlotThreadTable)
    .where(eq(PlotThreadTable.novel_id, novelId))
    .all()

  const entities = [
    ...characters.map((c) => ({ type: "character", id: c.id, name: c.name })),
    ...worldEntries.map((w) => ({ type: "world_entry", id: w.id, name: w.title })),
    ...plotThreads.map((p) => ({ type: "plot_thread", id: p.id, name: p.title })),
  ]

  let count = 0
  for (const ent of entities) {
    if (ent.name.length < 2) continue
    const idx = content.indexOf(ent.name)
    if (idx < 0) continue
    const start = Math.max(0, idx - 25)
    const end = Math.min(content.length, idx + ent.name.length + 25)
    await db
      .insert(EntityRefTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        source_type: sourceType,
        source_id: sourceId,
        target_type: ent.type,
        target_id: ent.id,
        ref_field: field,
        ref_text: content.slice(start, end),
        source_fingerprint: computeFingerprint(content),
      } as never)
      .run()
    count++
  }
  return count
}
