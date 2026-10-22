/**
 * characters 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { and, eq } from "drizzle-orm"
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { archiveDescription, deduplicateCharacters, scanReferences } from "../state-commit.js"
import { applyImpact, buildImpactReport, planImpact, type ImpactReport } from "../setting-impact.js"
import { normalizeSettingText, SETTING_TEXT_FORMAT_RULE, settingTextFormatError } from "../setting-text.js"
import { CharacterTable, getDb } from "../session-store.js"
import { resolveNovelId } from "./shared.js"

export const charactersTools = {
  manage_characters: defineTool({
    description:
      "管理小说角色信息。可新增或更新角色（name/role/description/status）。character_id 为空时新增。status 可设为 'active'（活跃）或 'departed'（退场）；退场后后续章节不再安排出场，但历史章节提及仍然有效。主角不能设为 departed。\n\n" + SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      character_id: Schema.String.annotate({ description: "角色 ID；传空字符串表示新增角色" }),
      update: Schema.String.annotate({ description: "角色更新内容 JSON：{name?,role?,description?,status?,novel_id?}" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      let patch: { name?: string; role?: string; description?: string; status?: string; novel_id?: string }
      try {
        patch = JSON.parse(args.update)
      } catch {
        return { title: "manage_characters", output: `update 不是合法 JSON：${args.update}` }
      }
      if (patch.novel_id) patch.novel_id = await resolveNovelId(db, patch.novel_id)
      if (typeof patch.description === "string") patch.description = normalizeSettingText(patch.description)
      const textError = settingTextFormatError(patch.description, "character", "description")
      if (textError) return { title: "manage_characters", output: `设定文本格式校验失败：${textError}` }

      // 新增角色
      if (args.character_id.length === 0) {
        if (!patch.novel_id) return { title: "manage_characters", output: "新增角色需提供 novel_id" }
        if (!patch.name) return { title: "manage_characters", output: "新增角色需提供 name" }

        const [dup] = await db
          .select({ id: CharacterTable.id })
          .from(CharacterTable)
          .where(and(eq(CharacterTable.novel_id, patch.novel_id), eq(CharacterTable.name, patch.name)))
          .limit(1)
          .all()
        if (dup) {
          await db
            .update(CharacterTable)
            .set({
              role: patch.role ?? "",
              description: patch.description ?? "",
            })
            .where(eq(CharacterTable.id, dup.id))
            .run()
          await scanReferences(db, patch.novel_id, "character", dup.id, "description", patch.description ?? "")
          return {
            title: "manage_characters（已合并重复）",
            output: `角色「${patch.name}」已存在，已更新描述：${dup.id}`,
            metadata: { character_id: dup.id, merged: true },
          }
        }

        const id = crypto.randomUUID()
        await db
          .insert(CharacterTable)
          .values({
            id,
            novel_id: patch.novel_id,
            name: patch.name,
            role: patch.role ?? "",
            description: patch.description ?? "",
          })
          .run()
        return {
          title: "manage_characters",
          output: `已新增角色「${patch.name}」：${id}`,
          metadata: { character_id: id },
        }
      }

      // 更新现有角色
      const [existing] = await db
        .select()
        .from(CharacterTable)
        .where(eq(CharacterTable.id, args.character_id))
        .all()
      if (!existing) return { title: "manage_characters", output: `角色不存在：${args.character_id}` }

      const oldDesc = existing.description
      const newDesc = patch.description ?? existing.description

      if (patch.description !== undefined && oldDesc.length > 0 && newDesc.length < oldDesc.length * 0.5) {
        return {
          title: "manage_characters（已拦截）",
          output: `⚠ 新描述(${newDesc.length}字)比旧描述(${oldDesc.length}字)短超过一半，可能丢失信息。\n\n旧描述全文：\n${oldDesc}\n\n如确认无误，请在 update 中保留旧描述的内容后再提交。`,
        }
      }

      if (patch.description !== undefined && oldDesc.length > 0 && newDesc.length < oldDesc.length) {
        await archiveDescription(ctx.directory, existing.novel_id, "character", args.character_id, oldDesc, newDesc)
      }

      // 主角保护：不能退场
      if (patch.status === "departed" && existing.role === "protagonist") {
        return {
          title: "manage_characters（已拦截）",
          output: `主角「${existing.name}」不能退场。如需更换主角，请先创建新主角并用 update 将旧主角的 role 改为非主角。`,
        }
      }

      await db
        .update(CharacterTable)
        .set({
          name: patch.name ?? existing.name,
          role: patch.role ?? existing.role,
          description: newDesc,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        })
        .where(eq(CharacterTable.id, args.character_id))
        .run()

      const changedFields: string[] = []
      if (patch.name !== undefined) changedFields.push("name")
      if (patch.role !== undefined) changedFields.push("role")
      if (patch.description !== undefined) changedFields.push("description")
      await scanReferences(db, existing.novel_id, "character", args.character_id, "description", newDesc)

      let impact: ImpactReport | undefined
      if (changedFields.length > 0) {
        const intent = {
          novelId: existing.novel_id,
          entityType: "character",
          entityId: args.character_id,
          field: changedFields.join(", "),
          oldValue: JSON.stringify({ name: existing.name, role: existing.role, description: existing.description }),
          newValue: JSON.stringify({
            name: patch.name ?? existing.name,
            role: patch.role ?? existing.role,
            description: newDesc,
          }),
          reason: `角色「${existing.name}」更新（${changedFields.join(", ")}）`,
        }
        const created = await applyImpact(db, intent)
        impact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
      }

      return {
        title: "manage_characters",
        output: `已更新角色「${patch.name ?? existing.name}」${impact && impact.task_count > 0 ? `（联动任务 ${impact.task_count} 个，待处理 ${impact.pending_count} 个）` : ""}`,
        metadata: { character_id: args.character_id, impact },
      }
    },
  }),

  deduplicate_characters: defineTool({
    description:
      "检查并合并小说中同名重复角色。dry_run=true（默认）返回每组重复角色的完整描述全文，供 director 判断合并策略；dry_run=false 执行机械合并：保留 description 最长的记录，拼接其余非重复描述，将 relationships/entity_refs/pending_updates 中的旧角色 ID 重新指向保留的角色，然后删除重复行。注意：机械合并不做语义去重，若各记录描述差异大或格式不同，director 应先在 dry_run 报告中阅读所有描述，自行生成合并后的统一描述并通过 manage_characters 更新保留角色，再执行 dry_run=false 清理重复行。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      dry_run: Schema.Boolean.annotate({ description: "true=仅检查不修改，返回完整描述（默认）；false=执行合并" }),
      force: Schema.Boolean.annotate({
        description:
          "dry_run=false 时，跳过长度保护检查强制执行合并（默认 false）。当保留描述比原始描述短时会触发警告并阻止合并，确认信息无丢失后可设 true 强制执行",
      }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await deduplicateCharacters(ctx.directory, novelId, args.dry_run ?? true, args.force ?? false)

      const lines: string[] = []
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          lines.push(`⚠ ${w}`)
        }
        lines.push("")
      }
      if (result.duplicates.length === 0 && result.warnings.length === 0) {
        lines.push("未发现重复角色")
      } else if (result.duplicates.length > 0) {
        lines.push(
          `${result.dry_run ? "[检查]" : "[已执行]"} 发现 ${result.duplicates.length} 组重复角色，共 ${result.total_removed} 条待删除`,
        )
        for (const d of result.duplicates) {
          lines.push("")
          lines.push(`「${d.name}」x${d.count}（保留 ${d.kept_id.slice(0, 8)}）`)
          if (result.dry_run) {
            for (const r of d.records) {
              const tag = r.id === d.kept_id ? "保留" : "重复"
              lines.push(`  [${tag}] ${r.id.slice(0, 8)} | role: ${r.role || "(空)"}`)
              lines.push(`    ${r.description || "(空描述)"}`)
            }
          } else {
            lines.push(`  已删除 ${d.removed_ids.length} 条${d.merged_description ? "（描述已合并）" : ""}`)
          }
        }
      }

      return {
        title: "deduplicate_characters",
        output: lines.join("\n"),
        metadata: result,
      }
    },
  }),
}
