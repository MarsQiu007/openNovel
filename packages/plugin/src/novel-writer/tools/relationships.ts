/**
 * relationships 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { and, eq } from "drizzle-orm"
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { deduplicateRelationships, listDescriptionHistory, restoreDescription, scanReferences } from "../state-commit.js"
import { applyImpact, buildImpactReport, planImpact } from "../setting-impact.js"
import { normalizeSettingText, SETTING_TEXT_FORMAT_RULE, settingTextFormatError } from "../setting-text.js"
import { CharacterTable, getDb, RelationshipTable } from "../session-store.js"
import { resolveNovelId } from "./shared.js"

export const relationshipsTools = {
  create_relationship: defineTool({
    description:
      "建立两个角色之间的单条关系。char_a 和 char_b 都可以是角色名（需在本小说内唯一）或角色 UUID；type 必填，描述关系类型（如 friend/enemy/mentor/亲人/师徒/宿敌）。这是单条创建入口，比 save_novel_settings 批量模式更直接；如需批量创建或多条设定一起落库，请用 save_novel_settings。\n\n" + SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      char_a: Schema.String.annotate({ description: "角色 A 的名称或 UUID" }),
      char_b: Schema.String.annotate({ description: "角色 B 的名称或 UUID" }),
      type: Schema.String.annotate({ description: "关系类型（如 friend/enemy/mentor/亲人/师徒/宿敌）" }),
      description: Schema.optional(Schema.String.annotate({ description: "关系的详细说明（可选）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      // V2 args 字段只读，normalize 后的描述改用局部变量承载（V1 原地写回 args.description）
      const description = typeof args.description === "string" ? normalizeSettingText(args.description) : args.description
      const textError = settingTextFormatError(description ?? "", "relationship", "description")
      if (textError) return { title: "create_relationship", output: `设定文本格式校验失败：${textError}` }

      const resolveChar = async (
        input: string,
        label: string,
      ): Promise<{ id: string } | { error: string }> => {
        const trimmed = input.trim()
        if (!trimmed) return { error: `${label}：不能为空` }
        if (trimmed.length === 36 && trimmed.includes("-")) {
          const [row] = await db
            .select({ id: CharacterTable.id })
            .from(CharacterTable)
            .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.id, trimmed)))
            .limit(1)
            .all()
          return row ? { id: row.id } : { error: `${label}：ID "${trimmed}" 不属于本小说或不存在` }
        }
        const rows = await db
          .select({ id: CharacterTable.id })
          .from(CharacterTable)
          .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, trimmed)))
          .all()
        if (rows.length === 1) return { id: rows[0].id }
        if (rows.length > 1) {
          return { error: `${label}：姓名 "${trimmed}" 匹配到 ${rows.length} 个角色，存在歧义，请使用 UUID` }
        }
        return { error: `${label}：姓名 "${trimmed}" 未匹配到任何角色` }
      }

      const a = await resolveChar(args.char_a, "char_a")
      if ("error" in a) return { title: "create_relationship", output: a.error }
      const b = await resolveChar(args.char_b, "char_b")
      if ("error" in b) return { title: "create_relationship", output: b.error }
      if (a.id === b.id) {
        return { title: "create_relationship", output: "char_a 和 char_b 不能是同一角色" }
      }
      if (!args.type.trim()) {
        return { title: "create_relationship", output: "type 不能为空" }
      }

      const id = crypto.randomUUID()
      await db
        .insert(RelationshipTable)
        .values({
          id,
          novel_id: novelId,
          char_a_id: a.id,
          char_b_id: b.id,
          type: args.type.trim(),
          description: (description ?? "").trim(),
        })
        .run()

      // 统一影响面：关系描述可能引用角色名/设定名，落库后重建引用并生成任务
      await scanReferences(db, novelId, "relationship", id, "description", (description ?? "").trim())
      const relIntent = {
        novelId,
        entityType: "relationship",
        entityId: id,
        field: "create",
        oldValue: "",
        newValue: `${args.char_a.trim()} — ${args.type.trim()} → ${args.char_b.trim()}：${(description ?? "").trim().slice(0, 80)}`,
        reason: `新建关系「${args.type.trim()}」`,
      }
      const relCreated = await applyImpact(db, relIntent)
      const impact = await buildImpactReport(db, relIntent, await planImpact(db, relIntent), relCreated)
      return {
        title: "create_relationship",
        output: `已建立关系 [${id.slice(0, 8)}] ${args.char_a.trim()} — ${args.type.trim()} → ${args.char_b.trim()}`,
        metadata: { relationship_id: id, impact },
      }
    },
  }),
  check_relationships: defineTool({
    description:
      "全局关系完整性检查（不绑定章节）。检测自指关系、悬空引用、重复关系、对称冗余、孤立角色、空类型、非标准类型、空描述、敌友矛盾等问题。仅报告不修改；如需修复请用 update_settings / delete_settings。这是结构性检查，不是叙事连续性；如需章节级连续性请用 check_continuity（其中包含关系类型一致 / 敌友转变有因 / 亲密度变化 / 信任度变化 4 维）。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)

      const characters = await db
        .select({ id: CharacterTable.id, name: CharacterTable.name })
        .from(CharacterTable)
        .where(eq(CharacterTable.novel_id, novelId))
        .all()
      const relationships = await db
        .select()
        .from(RelationshipTable)
        .where(eq(RelationshipTable.novel_id, novelId))
        .all()

      const charById = new Map(characters.map((c) => [c.id, c]))
      type Issue = {
        severity: "FAIL" | "WARN"
        dimension: string
        detail: string
        ids?: string[]
      }
      const issues: Issue[] = []

      if (relationships.length === 0 && characters.length > 0) {
        issues.push({
          severity: "WARN",
          dimension: "no_relationships",
          detail: "本小说尚无任何关系",
        })
      }

      const validTypes = new Set([
        "亲情",
        "友情",
        "爱情",
        "敌对",
        "师徒",
        "同门",
        "盟友",
        "仇敌",
        "主仆",
        "竞争",
        "合作",
        "陌生人",
        "同学",
        "同事",
        "邻居",
        "family",
        "friend",
        "romantic",
        "enemy",
        "mentor",
        "ally",
        "rival",
        "master_servant",
        "competition",
        "cooperation",
        "stranger",
        "classmate",
      ])

      const charRelCount = new Map<string, number>()
      for (const c of characters) charRelCount.set(c.id, 0)

      // 收集"对方向"关系列表：用于对称冗余和重复检测
      const forwardList = new Map<string, string[]>() // key = "a||b"，value = relationship id 列表（保持插入顺序）
      const reportedSymmetric = new Set<string>() // 已经报过对称冗余的对

      for (const rel of relationships) {
        charRelCount.set(rel.char_a_id, (charRelCount.get(rel.char_a_id) ?? 0) + 1)
        charRelCount.set(rel.char_b_id, (charRelCount.get(rel.char_b_id) ?? 0) + 1)

        // 1. 自指
        if (rel.char_a_id === rel.char_b_id) {
          const name = charById.get(rel.char_a_id)?.name ?? rel.char_a_id
          issues.push({
            severity: "FAIL",
            dimension: "self_loop",
            detail: `自指关系 [${rel.id.slice(0, 8)}]：「${name}」指向自身`,
            ids: [rel.id],
          })
        }

        // 2. 悬空引用
        if (!charById.has(rel.char_a_id)) {
          issues.push({
            severity: "FAIL",
            dimension: "dangling_reference",
            detail: `悬空引用 [${rel.id.slice(0, 8)}]：char_a_id "${rel.char_a_id.slice(0, 8)}…" 不在本小说角色列表中`,
            ids: [rel.id],
          })
        }
        if (!charById.has(rel.char_b_id)) {
          issues.push({
            severity: "FAIL",
            dimension: "dangling_reference",
            detail: `悬空引用 [${rel.id.slice(0, 8)}]：char_b_id "${rel.char_b_id.slice(0, 8)}…" 不在本小说角色列表中`,
            ids: [rel.id],
          })
        }

        // 3. 对称冗余（A→B 与 B→A 同时存在）
        if (rel.char_a_id !== rel.char_b_id) {
          const reverseKey = `${rel.char_b_id}||${rel.char_a_id}`
          const reverseIds = forwardList.get(reverseKey) ?? []
          const symmetricPair = [rel.char_a_id, rel.char_b_id].sort().join("||")
          if (reverseIds.length > 0 && !reportedSymmetric.has(symmetricPair)) {
            const aName = charById.get(rel.char_a_id)?.name ?? rel.char_a_id.slice(0, 8)
            const bName = charById.get(rel.char_b_id)?.name ?? rel.char_b_id.slice(0, 8)
            const allIds = [...reverseIds, rel.id]
            issues.push({
              severity: "WARN",
              dimension: "symmetric_redundancy",
              detail: `对称冗余：「${aName}」↔「${bName}」双向关系均存在 [${allIds.map((id) => id.slice(0, 8)).join(", ")}]，建议合并为单条或确认是否需要双向记录`,
              ids: allIds,
            })
            reportedSymmetric.add(symmetricPair)
          }
        }

        // 4. 重复（A→B 多次）
        const pairKey = `${rel.char_a_id}||${rel.char_b_id}`
        const list = forwardList.get(pairKey) ?? []
        list.push(rel.id)
        forwardList.set(pairKey, list)

        // 5. 空类型
        if (rel.type === "") {
          issues.push({
            severity: "FAIL",
            dimension: "empty_type",
            detail: `空类型 [${rel.id.slice(0, 8)}]：未指定关系类型`,
            ids: [rel.id],
          })
        } else if (!validTypes.has(rel.type)) {
          issues.push({
            severity: "WARN",
            dimension: "non_standard_type",
            detail: `非标准类型 [${rel.id.slice(0, 8)}]：「${rel.type}」不在常见关系类型白名单中`,
            ids: [rel.id],
          })
        }

        // 6. 空描述
        if (rel.description === "") {
          issues.push({
            severity: "WARN",
            dimension: "empty_description",
            detail: `空描述 [${rel.id.slice(0, 8)}]：type="${rel.type}" 缺少说明`,
            ids: [rel.id],
          })
        }
      }

      // 重复（同方向 A→B 出现多次）
      for (const [pairKey, ids] of forwardList) {
        if (ids.length > 1) {
          const [aId, bId] = pairKey.split("||")
          const aName = charById.get(aId!)?.name ?? aId!.slice(0, 8)
          const bName = charById.get(bId!)?.name ?? bId!.slice(0, 8)
          issues.push({
            severity: "FAIL",
            dimension: "duplicate",
            detail: `重复关系：「${aName}」→「${bName}」出现 ${ids.length} 次 [${ids.map((id) => id.slice(0, 8)).join(", ")}]`,
            ids,
          })
        }
      }

      // 孤立角色
      const orphans: string[] = []
      for (const [id, count] of charRelCount) {
        if (count === 0) {
          orphans.push(charById.get(id)?.name ?? id.slice(0, 8))
        }
      }
      if (orphans.length > 0) {
        issues.push({
          severity: "WARN",
          dimension: "orphan_character",
          detail: `${orphans.length} 个角色无任何关系：${orphans.slice(0, 10).join("、")}${orphans.length > 10 ? "…" : ""}`,
        })
      }

      // 敌友矛盾
      const hostileTypes = new Set(["敌对", "仇敌", "enemy"])
      const friendlyTypes = new Set([
        "亲情",
        "友情",
        "爱情",
        "师徒",
        "同门",
        "盟友",
        "family",
        "friend",
        "romantic",
        "mentor",
        "ally",
      ])
      const typeByPair = new Map<string, Set<string>>()
      for (const rel of relationships) {
        const key = [rel.char_a_id, rel.char_b_id].sort().join("||")
        const set = typeByPair.get(key) ?? new Set<string>()
        set.add(rel.type)
        typeByPair.set(key, set)
      }
      const conflicts: string[] = []
      for (const [key, types] of typeByPair) {
        const hasHostile = [...types].some((t) => hostileTypes.has(t))
        const hasFriendly = [...types].some((t) => friendlyTypes.has(t))
        if (hasHostile && hasFriendly) {
          const [aId, bId] = key.split("||")
          conflicts.push(`${charById.get(aId!)?.name ?? aId!.slice(0, 8)} ↔ ${charById.get(bId!)?.name ?? bId!.slice(0, 8)}`)
        }
      }
      if (conflicts.length > 0) {
        issues.push({
          severity: "WARN",
          dimension: "hostile_friendly_conflict",
          detail: `${conflicts.length} 对角色关系同时存在敌对与友好类型：${conflicts.slice(0, 5).join("；")}${conflicts.length > 5 ? "…" : ""}`,
        })
      }

      // 输出报告
      const fails = issues.filter((i) => i.severity === "FAIL")
      const warns = issues.filter((i) => i.severity === "WARN")
      const lines: string[] = []
      lines.push("## 关系完整性检查报告")
      lines.push("")
      lines.push(`- 角色数：${characters.length}`)
      lines.push(`- 关系数：${relationships.length}`)
      lines.push(`- FAIL：${fails.length}  WARN：${warns.length}`)
      lines.push("")
      if (issues.length === 0) {
        lines.push("未发现问题。")
      } else {
        if (fails.length > 0) {
          lines.push("### FAIL（需处理）")
          for (const i of fails) lines.push(`- **${i.dimension}**：${i.detail}`)
          lines.push("")
        }
        if (warns.length > 0) {
          lines.push("### WARN（建议处理）")
          for (const i of warns) lines.push(`- **${i.dimension}**：${i.detail}`)
          lines.push("")
        }
        lines.push("修复方式：用 list_settings 拿到 entity_id，再用 update_settings / delete_settings 修改或删除。")
      }

      return {
        title: "check_relationships",
        output: lines.join("\n"),
        metadata: {
          fail_count: fails.length,
          warn_count: warns.length,
          character_count: characters.length,
          relationship_count: relationships.length,
          issues: issues.map((i) => ({
            severity: i.severity,
            dimension: i.dimension,
            detail: i.detail,
            ids: i.ids ?? [],
          })),
        },
      }
    },
  }),
  deduplicate_relationships: defineTool({
    description:
      "检查并合并小说中重复关系（char_a_id + char_b_id + type 相同）。dry_run=true（默认）返回每组重复关系的完整描述全文；dry_run=false 执行机械合并：保留 description 最长的记录，拼接其余非重复描述，删除重复行。与 deduplicate_characters 类似，若描述差异大，director 应先阅读 dry_run 报告中的所有描述，生成合并描述后更新保留记录，再执行合并。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      dry_run: Schema.Boolean.annotate({ description: "true=仅检查不修改，返回完整描述（默认）；false=执行合并" }),
      force: Schema.Boolean.annotate({ description: "dry_run=false 时，跳过长度保护检查强制执行合并（默认 false）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await deduplicateRelationships(
        ctx.directory,
        novelId,
        args.dry_run ?? true,
        args.force ?? false,
      )

      const lines: string[] = []
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          lines.push(`⚠ ${w}`)
        }
        lines.push("")
      }
      if (result.duplicates.length === 0 && result.warnings.length === 0) {
        lines.push("未发现重复关系")
      } else if (result.duplicates.length > 0) {
        lines.push(
          `${result.dry_run ? "[检查]" : "[已执行]"} 发现 ${result.duplicates.length} 组重复关系，共 ${result.total_removed} 条待删除`,
        )
        for (const d of result.duplicates) {
          lines.push("")
          lines.push(
            `${d.char_a_id.slice(0, 8)} ↔ ${d.char_b_id.slice(0, 8)} [${d.type}] x${d.count}（保留 ${d.kept_id.slice(0, 8)}）`,
          )
          if (result.dry_run) {
            for (const r of d.records) {
              const tag = r.id === d.kept_id ? "保留" : "重复"
              lines.push(`  [${tag}] ${r.id.slice(0, 8)}`)
              lines.push(`    ${r.description || "(空描述)"}`)
            }
          } else {
            lines.push(`  已删除 ${d.removed_ids.length} 条`)
          }
        }
      }

      return {
        title: "deduplicate_relationships",
        output: lines.join("\n"),
        metadata: result,
      }
    },
  }),
  description_history: defineTool({
    description:
      "查看或恢复任意设定字段的修改历史。action=list（默认）列出指定实体的所有历史版本，显示字段名/新旧值长度/前 100 字预览；action=restore 恢复指定历史版本（将旧值写回当前记录，同时归档当前值）。覆盖 character / world_entry / plot_thread / foreshadowing / relationship 5 种实体，每种实体的可恢复字段由 update_setting 的 fields 决定（character.description, world_entry.{category|title|content}, plot_thread.{title|status|priority|description}, foreshadowing.{content|state}, relationship.{type|description}）。用于找回被误改/缩减/丢失的设定内容。",
    args: Schema.Struct({
      action: Schema.String.annotate({ description: "list=查看历史版本（默认）；restore=恢复指定版本" }),
      entity_type: Schema.String.annotate({
        description: "实体类型：character / world_entry / plot_thread / foreshadowing / relationship",
      }),
      entity_id: Schema.String.annotate({ description: "实体 ID" }),
      history_id: Schema.String.annotate({ description: "action=restore 时必填：要恢复的历史记录 ID" }),
    }),
    async execute(args, ctx) {
      const action = args.action ?? "list"

      if (action === "restore") {
        if (!args.history_id) {
          return { title: "description_history", output: "action=restore 时需要提供 history_id" }
        }
        const result = await restoreDescription(ctx.directory, args.history_id)
        if (!result) {
          return { title: "description_history", output: `历史记录不存在：${args.history_id}` }
        }
        return {
          title: "description_history（已恢复）",
          output: `已恢复 ${result.entity_type} ${result.entity_id.slice(0, 8)} 的 ${result.field} 到历史版本（${result.restored_value.length} 字）。当前值已自动归档，可再次恢复。`,
          metadata: result,
        }
      }

      const history = await listDescriptionHistory(ctx.directory, args.entity_type, args.entity_id)

      if (history.length === 0) {
        return {
          title: "description_history",
          output: `${args.entity_type} ${args.entity_id.slice(0, 8)} 暂无历史记录`,
        }
      }

      const lines: string[] = []
      lines.push(`${args.entity_type} ${args.entity_id.slice(0, 8)} 的历史记录（${history.length} 条）：`)
      for (const h of history) {
        lines.push("")
        lines.push(`  [${h.id.slice(0, 8)}] field=${h.field} | ${new Date(h.created_at).toLocaleString("zh-CN")}`)
        lines.push(`    旧: ${h.old_len} 字 | 新: ${h.new_len} 字${h.new_len < h.old_len ? " ⚠ 缩短" : ""}`)
        lines.push(`    旧值预览: ${h.old_value.slice(0, 100) || "(空)"}...`)
      }
      lines.push("")
      lines.push("要恢复某个版本，使用 action=restore 并传入对应的 history_id")

      return {
        title: "description_history",
        output: lines.join("\n"),
        metadata: { history, count: history.length },
      }
    },
  }),
}
