/**
 * settings 域写作工具（V2 版，操作半域）。从 novel-writer.ts 机械转换，
 * 窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { and, eq } from "drizzle-orm"
import {
  CharacterTable,
  deleteCharacter,
  deleteForeshadowing,
  deletePlotThread,
  deleteRelationship,
  deleteVolume,
  deleteWorldEntry,
  ForeshadowingTable,
  getDb,
  PlotThreadTable,
  RelationshipTable,
  updateForeshadowing,
  updatePlotThread,
  updateRelationship,
  updateWorldEntry,
  VolumeTable,
  WorldEntryTable,
} from "../session-store.js"
import { archiveDescription, cascadeCheck, scanReferences } from "../state-commit.js"
import { applyImpact, buildImpactReport, planImpact, type ImpactReport } from "../setting-impact.js"
import { analyzeEntities, executeOrganizePlan, loadOrganizeContext, parseOrganizePlan, validateOrganizePlan } from "../setting-reorganization.js"
import { runSettingReviewBatch } from "../setting-review-batch.js"
import { SETTING_TEXT_FIELDS } from "../setting-review-candidates.js"
import { createStagedChangesFromPlan } from "../setting-review-staged.js"
import { normalizeSettingText, SETTING_TEXT_FORMAT_RULE, settingTextFormatError } from "../setting-text.js"
import { validateWorldCategory, WORLD_ENTRY_CATEGORY_HINT } from "../world-category.js"
import { defineTool } from "../../v2/effect/tool.js"
import { resolveNovelId } from "./shared.js"

export const settingsOpsTools = {
  check_settings_consistency: defineTool({
    description:
      "扫描小说设定内部的自相矛盾（intra-setting consistency）。检查 worldEntries / characters / relationships 内部和跨条目的冲突，输出 WARN/FAIL 级别问题列表，供 director 在 save_novel_settings 后或人工审查设定时使用。**不是**审计章节与设定的对照（那个由 38 维审计/auditor 负责）。检查项：(1) 同 category 下标题完全重复的条目；(2) 同 category 下数字冲突（如一条说『12 神主』另一条说『10 神主』）；(3) 跨 category 引用但关键词冲突（如社会制度定义神主数量与势力定义神主数量不一致）。语义级矛盾需 LLM 审计最终判断。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const issues: Array<{ severity: "WARN" | "FAIL"; kind: string; message: string; entries: string[] }> = []

      // ── 1) 拉所有 worldEntries / characters / relationships ──
      const worldEntries = await db
        .select()
        .from(WorldEntryTable)
        .where(eq(WorldEntryTable.novel_id, novelId))
        .all()
      const characters = await db
        .select()
        .from(CharacterTable)
        .where(eq(CharacterTable.novel_id, novelId))
        .all()
      const relationships = await db
        .select()
        .from(RelationshipTable)
        .where(eq(RelationshipTable.novel_id, novelId))
        .all()

      // ── 2) 同 category 下标题完全重复 ──
      const titleCount = new Map<string, typeof worldEntries>()
      for (const w of worldEntries) {
        const key = `${w.category}::${w.title.trim()}`
        const arr = titleCount.get(key) ?? []
        arr.push(w)
        titleCount.set(key, arr)
      }
      for (const [key, dup] of titleCount) {
        if (dup.length > 1) {
          issues.push({
            severity: "FAIL",
            kind: "duplicate_title",
            message: `同 category 同标题存在 ${dup.length} 条重复条目：${key}`,
            entries: dup.map((d) => `[${d.id.slice(0, 8)}] ${d.title}`),
          })
        }
      }

      // ── 3) 数字冲突：扫描内容里的"X 个/位/名/条 + 名词"短语 ──
      // 只检测"明确量词"的定义型短语（如"12 位神主"），不检测"X万年""X万亿"
      // 这类"不同子项的不同数值"（如 5万年/10万年 是不同境界的寿元），不算冲突。
      // 判定逻辑：跨条目出现"X+量词+同一短主词"且数字不同 → 视为总量定义冲突
      //
      // 简化策略：只抽取"恰好 2 字"主词（最稳的实词头），
      // 并要求主词后必须是**非中文边界**（标点/空白/换行/英文/数字）以避免贪婪匹配吞字。
      // 3+ 字长词（如"元婴期探索者"）归一化困难，**先 drop**（避免误报）。
      // 这意味着当前实现只捕获最明显的冲突；语义级冲突需 LLM 审计。
      const numberPhraseMap = new Map<
        string,
        Array<{ entryId: string; title: string; phrase: string; number: number }>
      >()
      // 主词恰好 2 字，且后面必须是"非中文边界"（标点/空白/换行/英文/数字/结束）
      const numRegex = /(\d+)\s*(个|位|名|条|种|重|层)\s*([一-龥]{2})(?:[，。！？；：、\s()\[\]【】（）《》「」『』""''\n]|$)/g
      for (const w of worldEntries) {
        const text = w.title + "\n" + (w.content ?? "")
        let m: RegExpExecArray | null
        while ((m = numRegex.exec(text))) {
          const number = parseInt(m[1]!, 10)
          const noun = m[3]!
          if (number < 2 || number > 10000) continue
          const key = noun
          const arr = numberPhraseMap.get(key) ?? []
          arr.push({ entryId: w.id, title: w.title, phrase: m[0], number })
          numberPhraseMap.set(key, arr)
        }
      }
      // 同一短主词出现不同数字 → 提示（不直接 FAIL，因为可能不同语境）
      // 例：「12 位神主」vs「10 位神主在蓝星立国」可能是总数 vs 立国数，不一定冲突
      // 改标 WARN 并附 LLM 审计建议，避免启发式扫描的误报阻塞工作流
      for (const [noun, occurrences] of numberPhraseMap) {
        if (occurrences.length < 2) continue
        const uniqueNums = [...new Set(occurrences.map((o) => o.number))]
        if (uniqueNums.length > 1) {
          issues.push({
            severity: "WARN",
            kind: "number_inconsistency",
            message: `"${noun}"在不同条目中出现不同数字（${uniqueNums.join(" vs ")}）— 可能不同语境（如总数 vs 子集），建议 LLM 审计确认是否真有冲突`,
            entries: occurrences.map((o) => `[${o.entryId.slice(0, 8)}] ${o.title}: "${o.phrase}"`),
          })
        }
      }

      // ── 4) 角色表：同 name 不同 id（疑似重名） ──
      const nameCount = new Map<string, typeof characters>()
      for (const c of characters) {
        const arr = nameCount.get(c.name.trim()) ?? []
        arr.push(c)
        nameCount.set(c.name.trim(), arr)
      }
      for (const [name, dup] of nameCount) {
        if (dup.length > 1) {
          issues.push({
            severity: "WARN",
            kind: "duplicate_character_name",
            message: `同名称「${name}」存在 ${dup.length} 个角色记录，建议确认是否同人`,
            entries: dup.map((c) => `[${c.id.slice(0, 8)}] ${c.name}（${c.role}）`),
          })
        }
      }

      // ── 5) 关系表：自引用 (char_a == char_b) ──
      for (const r of relationships) {
        if (r.char_a_id === r.char_b_id) {
          issues.push({
            severity: "WARN",
            kind: "self_relationship",
            message: `关系记录自引用：char_a == char_b（${r.type}：${r.description}）`,
            entries: [`[${r.id.slice(0, 8)}]`],
          })
        }
      }

      // ── 汇总输出 ──
      if (issues.length === 0) {
        return {
          title: "check_settings_consistency",
          output: `设定自洽性检查通过（${worldEntries.length} worldEntries + ${characters.length} 角色 + ${relationships.length} 关系），未发现明显矛盾`,
          metadata: { novel_id: novelId, issue_count: 0 },
        }
      }
      const failCount = issues.filter((i) => i.severity === "FAIL").length
      const warnCount = issues.filter((i) => i.severity === "WARN").length
      const lines: string[] = []
      lines.push(`⚠️ 设定自洽性检查发现 ${issues.length} 个问题（FAIL ${failCount} / WARN ${warnCount}）：`)
      for (const i of issues) {
        lines.push(`\n[${i.severity}] ${i.kind}: ${i.message}`)
        for (const e of i.entries) lines.push(`  - ${e}`)
      }
      return {
        title: "check_settings_consistency",
        output: lines.join("\n"),
        metadata: { novel_id: novelId, issue_count: issues.length, fail_count: failCount, warn_count: warnCount, issues },
      }
    },
  }),
  lint_settings: defineTool({
    description:
      "设定体检（只读）。扫描小说的 world_entry/character/plot_thread/foreshadowing，报告不符合规范的结构问题：非标准分类、空字段、跨分类同标题，并给出分类统计与标准分类列表。存量设定整理的入口：先 lint_settings 拿报告，再用 rename_world_category 批量归类、update_setting 精修单条。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const entries = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelId)).all()
      const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
      const threads = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()
      const foreshadows = await db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all()

      const lines: string[] = []
      let issues = 0

      // 1) 非标准分类
      const badByCategory = new Map<string, { id: string; title: string }[]>()
      for (const e of entries) {
        if (validateWorldCategory(e.category) !== null) {
          const list = badByCategory.get(e.category) ?? []
          list.push({ id: e.id, title: e.title })
          badByCategory.set(e.category, list)
        }
      }
      if (badByCategory.size > 0) {
        lines.push("## 非标准分类（建议用 rename_world_category 批量归类）")
        for (const [cat, list] of badByCategory) {
          issues += list.length
          const sample = list.map((e) => `${e.title}[${e.id.slice(0, 8)}]`).join("、")
          lines.push(`- 「${cat || "（空）"}」× ${list.length}：${sample}`)
        }
        lines.push("")
      }

      // 2) 空字段条目
      const emptyItems: string[] = [
        ...entries.filter((e) => !e.title.trim() || !e.content.trim()).map((e) => `world_entry「${e.title || "（无标题）"}」[${e.id.slice(0, 8)}]`),
        ...characters.filter((c) => !c.name.trim() || !c.description.trim()).map((c) => `character「${c.name || "（无名）"}」[${c.id.slice(0, 8)}]`),
        ...threads.filter((t) => !t.title.trim()).map((t) => `plot_thread[${t.id.slice(0, 8)}]`),
        ...foreshadows.filter((f) => !f.content.trim()).map((f) => `foreshadowing[${f.id.slice(0, 8)}]`),
      ]
      if (emptyItems.length > 0) {
        issues += emptyItems.length
        lines.push("## 空字段条目（建议用 update_setting 补全或 delete_setting 清理）")
        for (const item of emptyItems) lines.push(`- ${item}`)
        lines.push("")
      }

      // 3) 跨分类同标题（同义重复的隐患）
      const catsByTitle = new Map<string, Set<string>>()
      for (const e of entries) {
        const cats = catsByTitle.get(e.title) ?? new Set<string>()
        cats.add(e.category)
        catsByTitle.set(e.title, cats)
      }
      const dupTitles = [...catsByTitle].filter(([, cats]) => cats.size > 1)
      if (dupTitles.length > 0) {
        issues += dupTitles.length
        lines.push("## 跨分类同标题（同一设定被拆到多个分类，建议合并）")
        for (const [title, cats] of dupTitles) lines.push(`- 「${title}」分布在：${[...cats].join(" / ")}`)
        lines.push("")
      }

      // 4) 分类统计总览
      if (entries.length > 0) {
        const countByCategory = new Map<string, number>()
        for (const e of entries) {
          countByCategory.set(e.category, (countByCategory.get(e.category) ?? 0) + 1)
        }
        lines.push("## 分类统计")
        for (const [cat, n] of [...countByCategory].sort((a, b) => b[1] - a[1])) {
          lines.push(`- ${cat || "（空）"}：${n} 条`)
        }
        lines.push("")
      }

      const header = issues === 0 ? "✅ 未发现结构问题。" : `发现 ${issues} 处结构问题。${WORLD_ENTRY_CATEGORY_HINT}。`
      lines.unshift(header, `共扫描：world_entry ${entries.length} 条 / character ${characters.length} 条 / plot_thread ${threads.length} 条 / foreshadowing ${foreshadows.length} 条`, "")
      return {
        title: "lint_settings",
        output: lines.join("\n"),
        metadata: { novel_id: novelId, issues, entries: entries.length },
      }
    },
  }),
  rename_world_category: defineTool({
    description:
      "批量归类：把小说中 category 完全等于 old_category 的所有世界观条目改为 new_category（精确匹配，含\"主分类/子分类\"形式）。new_category 默认必须在标准分类列表内，确需新分类传 allow_new_category=true。每条变更记录 description_history 可回溯。配合 lint_settings 使用：先看报告，再批量归类。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      old_category: Schema.String.annotate({ description: "要归类的旧分类（精确匹配）" }),
      new_category: Schema.String.annotate({ description: `目标分类。${WORLD_ENTRY_CATEGORY_HINT}` }),
      allow_new_category: Schema.optional(Schema.Boolean.annotate({ description: "允许使用标准列表之外的新分类" })),
    }),
    async execute(args, ctx) {
      const categoryError = validateWorldCategory(args.new_category)
      if (categoryError && !args.allow_new_category) {
        return { title: "rename_world_category", output: categoryError }
      }
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const rows = await db
        .select()
        .from(WorldEntryTable)
        .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.category, args.old_category)))
        .all()
      if (rows.length === 0) {
        return { title: "rename_world_category", output: `未找到分类为「${args.old_category}」的条目，未执行任何修改` }
      }
      // 单条批量 UPDATE：SQLite 单语句原子，避免逐条更新中途失败留下部分归类的中间态
      await db
        .update(WorldEntryTable)
        .set({ category: args.new_category })
        .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.category, args.old_category)))
        .run()
      // 历史记录逐条写入（仅审计追溯，失败不影响已完成的归类）
      for (const row of rows) {
        await archiveDescription(ctx.directory, novelId, "world_entry", row.id, row.category, args.new_category, "category")
      }
      return {
        title: "rename_world_category",
        output: `已将 ${rows.length} 条条目的分类由「${args.old_category}」改为「${args.new_category}」`,
        metadata: { novel_id: novelId, updated: rows.length },
      }
    },
  }),
  organize_settings: defineTool({
    description:
      "整理小说设定。action=analyze 跨实体扫描并支持 scope 过滤；action=dry_run 校验版本 1 或版本 2 plan_json 并输出影响预览；action=stage 对通过校验的计划产出待审暂存草案（不执行，进入设定收件箱等用户审阅，重复 stage 会替代同目标旧草案）；action=batch 提交批处理整理：纯格式修复与分类归一（白名单内）自动执行，其余操作写入设定收件箱待审，返回新增待审数量；action=apply 执行受控 update/merge/delete，执行前重新校验并请求用户确认。stage 与 apply 的分工：apply 走运行时确认直接生效，stage 只产出待审草案。会话内整理必须按 analyze → dry_run → 向用户说明并等待确认 → apply → analyze 复查执行；只使用 analyze 返回的真实条目 ID，不自动删除重复或相似条目，会话内 apply 不跳过确认，不写入 Markdown 或单个段落超过 600 字的长文本。",
    args: Schema.Struct({
      action: Schema.Literals(["analyze", "dry_run", "stage", "batch", "apply"]).annotate({
        description: "整理动作：analyze / dry_run / stage（产出待审草案）/ batch（批处理拆分执行）/ apply",
      }),
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      scope: Schema.optional(
        Schema.Literals(["all", "world_entry", "character", "relationship", "plot_thread", "foreshadowing"]).annotate({
          description: "analyze 扫描范围，默认 all",
        }),
      ),
      plan_json: Schema.optional(Schema.String.annotate({ description: "版本 1 或版本 2 的整理计划 JSON，dry_run 和 apply 必填" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const context = await loadOrganizeContext(ctx.directory, novelId, args.scope ?? "all")

      if (args.action === "analyze") {
        const issues = analyzeEntities(context.entities)
        const header = issues.length === 0 ? "✅ 未发现需要整理的设定问题" : `发现 ${issues.length} 个可整理问题`
        const lines = [header]
        for (const issue of issues) {
          lines.push("", `- [${issue.entity_type}/${issue.type}] ${issue.issue_id}`, `  证据：${issue.evidence}`, `  建议：${issue.suggestion}`)
        }
        if (issues.length === 0) lines.push("当前无需整理")
        return {
          title: "organize_settings",
          output: lines.join("\n"),
          metadata: { action: "analyze", novel_id: novelId, scope: args.scope ?? "all", issues, count: issues.length },
        }
      }

      if (!args.plan_json) {
        return { title: "organize_settings", output: `action=${args.action} 时必须提供 plan_json` }
      }
      const parsed = parseOrganizePlan(args.plan_json)
      if (parsed.errors.length > 0 || !parsed.plan) {
        return {
          title: "organize_settings",
          output: `整理计划解析失败：\n${parsed.errors.map((error) => `- ${error}`).join("\n")}`,
          metadata: { action: args.action, novel_id: novelId, valid: false, errors: parsed.errors },
        }
      }
      const validation = validateOrganizePlan({
        plan: parsed.plan,
        entries: context.entities,
        referencedKeys: context.referencedKeys,
        relatedCharacterIds: context.relatedCharacterIds,
      })
      if (!validation.ok) {
        return {
          title: "organize_settings",
          output: `整理计划校验失败，未修改数据：\n${validation.errors.map((error) => `- ${error}`).join("\n")}`,
          metadata: { action: args.action, novel_id: novelId, valid: false, errors: validation.errors, previews: validation.previews },
        }
      }

      if (args.action === "stage") {
        const staged = await createStagedChangesFromPlan(ctx.directory, novelId, parsed.plan, { source: "agent" })
        if (!staged.ok) {
          return {
            title: "organize_settings",
            output: `整理计划校验失败，未产出暂存：\n${staged.errors.map((error) => `- ${error}`).join("\n")}`,
            metadata: { action: "stage", novel_id: novelId, valid: false, errors: staged.errors },
          }
        }
        const lines = [`✅ 已产出 ${staged.staged_ids.length} 条待审暂存草案（未修改任何正式数据），可在设定收件箱审阅`]
        for (const preview of validation.previews) {
          lines.push(`- [${preview.index}] ${preview.summary}`)
        }
        if (staged.superseded_ids.length > 0) {
          lines.push(`已替代 ${staged.superseded_ids.length} 条同目标旧草案`)
        }
        return {
          title: "organize_settings",
          output: lines.join("\n"),
          metadata: {
            action: "stage",
            novel_id: novelId,
            valid: true,
            staged_ids: staged.staged_ids,
            superseded_ids: staged.superseded_ids,
            previews: validation.previews,
          },
        }
      }

      if (args.action === "batch") {
        const batch = await runSettingReviewBatch(ctx.directory, novelId, parsed.plan, { source: "agent" })
        if (!batch.ok) {
          return {
            title: "organize_settings",
            output: `批处理失败，未修改数据：\n${batch.errors.map((error) => `- ${error}`).join("\n")}`,
            metadata: { action: "batch", novel_id: novelId, ok: false, errors: batch.errors },
          }
        }
        const lines = [
          `✅ 批处理完成：白名单内自动执行 ${batch.auto_executed} 条，新增待审 ${batch.pending_added} 条`,
          "请到设定收件箱审阅新增待审条目",
        ]
        if (batch.superseded_ids.length > 0) {
          lines.push(`已替代 ${batch.superseded_ids.length} 条同目标旧草案`)
        }
        for (const result of batch.execution?.results ?? []) {
          if (result.status === "failed") {
            lines.push(`- [${result.index}] ${result.entity_type} ${result.action} 自动执行失败：${result.error}`)
            continue
          }
          lines.push(`- [${result.index}] 自动执行 ${result.entity_type} ${result.action} ${result.entry_ids.join("、")}`)
        }
        return {
          title: "organize_settings",
          output: lines.join("\n"),
          metadata: {
            action: "batch",
            novel_id: novelId,
            ok: true,
            auto_executed: batch.auto_executed,
            pending_added: batch.pending_added,
            staged_ids: batch.staged_ids,
            superseded_ids: batch.superseded_ids,
            execution: batch.execution,
          },
        }
      }

      if (args.action === "dry_run") {
        const lines = [`✅ 整理计划校验通过，未修改数据（${validation.previews.length} 个操作）`]
        for (const preview of validation.previews) {
          lines.push(`- [${preview.index}] ${preview.summary}`)
        }
        return {
          title: "organize_settings",
          output: lines.join("\n"),
          metadata: { action: "dry_run", novel_id: novelId, valid: true, previews: validation.previews, operations: parsed.plan.operations },
        }
      }

      try {
        await ctx.ask({
          permission: "organize_settings.apply",
          patterns: ["*"],
          always: [],
          metadata: {
            novel_id: novelId,
            operation_count: parsed.plan.operations.length,
            previews: validation.previews,
          },
        })
      } catch (error) {
        return {
          title: "organize_settings",
          output: "用户拒绝执行整理计划，未修改任何数据。",
          metadata: {
            action: "apply",
            novel_id: novelId,
            confirmed: false,
            executed: false,
            reason: error instanceof Error ? error.message : String(error),
          },
        }
      }

      const execution = await executeOrganizePlan(parsed.plan, { directory: ctx.directory, novelId })
      const successCount = execution.results.filter((result) => result.status === "success").length
      const lines = [`${execution.ok ? "✅ 整理计划执行完成" : "⚠️ 整理计划部分失败"}：成功 ${successCount} / ${parsed.plan.operations.length}`]
      for (const result of execution.results) {
        if (result.status === "failed") {
          lines.push(`- [${result.index}] ${result.entity_type} ${result.action} 失败：${result.error}`)
          continue
        }
        if (result.action === "update" || result.action === "merge") {
          const effect = `字段 ${result.changed_fields?.join("、") || "无变化"}；历史 ${result.history_count ?? 0}，级联 ${result.cascade_tasks ?? 0}`
          if (result.action === "update") lines.push(`- [${result.index}] 更新 ${result.entity_type} ${result.entry_ids[0]}：${effect}`)
          else lines.push(`- [${result.index}] 合并到 ${result.entity_type} ${result.entry_ids[0]}：${effect}`)
        } else {
          lines.push(`- [${result.index}] 删除 ${result.entity_type} ${result.entry_ids[0]}`)
        }
      }
      for (const item of execution.remaining) {
        lines.push(`- [${item.index}] 未执行：${item.entity_type} ${item.action} ${item.entry_ids.join("、")}`)
      }
      lines.push("请再次运行 action=analyze 复查剩余问题")
      return {
        title: "organize_settings",
        output: lines.join("\n"),
        metadata: {
          action: "apply",
          novel_id: novelId,
          confirmed: true,
          ok: execution.ok,
          results: execution.results,
          remaining: execution.remaining,
        },
      }
    },
  }),
  delete_setting: defineTool({
    description:
      "删除小说设定。支持删除 character/world_entry/plot_thread/foreshadowing/volume/relationship 类型的记录。删除前建议先用 list_settings 获取 entity_id，再用 cascade_check 检查影响范围。注意：角色（character）删除有保护--主角不能删除；已在章节正文中出场的角色不能硬删除（会破坏叙事连续性），应改用 update_setting 将 status 设为 'departed' 让角色退场。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_type: Schema.String.annotate({
        description: "实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship",
      }),
      entity_id: Schema.String.annotate({ description: "实体 ID（UUID）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      await resolveNovelId(db, args.novel_id)
      const type = args.entity_type
      const id = args.entity_id

      async function exists(): Promise<boolean> {
        if (type === "character")
          return !!(await db
            .select({ id: CharacterTable.id })
            .from(CharacterTable)
            .where(eq(CharacterTable.id, id))
            .get())
        if (type === "world_entry")
          return !!(await db
            .select({ id: WorldEntryTable.id })
            .from(WorldEntryTable)
            .where(eq(WorldEntryTable.id, id))
            .get())
        if (type === "plot_thread")
          return !!(await db
            .select({ id: PlotThreadTable.id })
            .from(PlotThreadTable)
            .where(eq(PlotThreadTable.id, id))
            .get())
        if (type === "foreshadowing")
          return !!(await db
            .select({ id: ForeshadowingTable.id })
            .from(ForeshadowingTable)
            .where(eq(ForeshadowingTable.id, id))
            .get())
        if (type === "volume")
          return !!(await db.select({ id: VolumeTable.id }).from(VolumeTable).where(eq(VolumeTable.id, id)).get())
        if (type === "relationship")
          return !!(await db
            .select({ id: RelationshipTable.id })
            .from(RelationshipTable)
            .where(eq(RelationshipTable.id, id))
            .get())
        return false
      }

      try {
        if (!(await exists())) {
          return { title: "delete_setting", output: `记录不存在：${type} ${id.slice(0, 8)}，未执行删除` }
        }
        if (type === "character") await deleteCharacter(id, ctx.directory)
        else if (type === "world_entry") await deleteWorldEntry(id, ctx.directory)
        else if (type === "plot_thread") await deletePlotThread(id, ctx.directory)
        else if (type === "foreshadowing") await deleteForeshadowing(id, ctx.directory)
        else if (type === "volume") await deleteVolume(id, ctx.directory)
        else if (type === "relationship") await deleteRelationship(id, ctx.directory)
        else return { title: "delete_setting", output: `不支持的实体类型：${type}` }
        return {
          title: "delete_setting",
          output: `已删除 ${type} ${id.slice(0, 8)}`,
          metadata: { entity_type: type, entity_id: id },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        let output = `删除失败：${msg}`
        if (msg === "PROTAGONIST_CANNOT_BE_DELETED") {
          output = `主角不能删除。如需更换主角，请先创建新主角并用 update_setting 将旧主角的 role 改为非主角，再退场或删除。`
        } else if (msg === "CHARACTER_APPEARED_IN_CHAPTERS") {
          output = `此角色已在章节正文中出场，不能硬删除（会破坏叙事连续性）。请改用 update_setting 将 status 设为 "departed" 让角色退场：退场后后续章节不再安排出场，但历史章节中的提及仍然有效。`
        }
        return { title: "delete_setting", output }
      }
    },
  }),
  update_setting: defineTool({
    description:
      "更新已有的小说设定记录。支持 world_entry（修改 category/title/content；content 必须用 \\n\\n 按主题分段，每段约 80–220 字，任一段超过 600 字必须继续分段）、plot_thread（修改 title/status/priority/description，status 设为 closed 会自动记录关闭时间）、foreshadowing（修改 content/state/resolved_chapter_id，state 可为 planted/hinted/resolved/abandoned）、relationship（修改 type/description）。用 list_settings 获取 entity_id 后再更新。\n\n" + SETTING_TEXT_FORMAT_RULE + "\n\n副作用（设定修改会级联到已写章节）：\n- world_entry.title 改名：自动重建 EntityRef 引用追踪；旧标题若已被章节正文引用，会在 PendingUpdate 表创建级联任务，提示 director/用户是否要统改这些章节的对应称谓。\n- world_entry.content 大改（如改爵位体系/境界名等关键定义）：同样会触发引用了该条目的章节的级联任务。\n- 其他类型修改不触发级联（仅引用关系可能变化，scanReferences 在下次 commit 时重建）。",
    args: Schema.Struct({
      entity_type: Schema.String.annotate({
        description: "实体类型：world_entry / plot_thread / foreshadowing / relationship",
      }),
      entity_id: Schema.String.annotate({ description: "要更新的记录 ID" }),
      fields_json: Schema.String.annotate({
        description: '要更新的字段 JSON，例如 {"state":"resolved","resolved_chapter_id":"uuid"} 或 {"status":"closed"}',
      }),
      allow_new_category: Schema.optional(
        Schema.Boolean.annotate({
          description: `world_entry 改 category 时专用：允许使用标准列表之外的分类。${WORLD_ENTRY_CATEGORY_HINT}`,
        }),
      ),
    }),
    async execute(args, ctx) {
      const type = args.entity_type
      const id = args.entity_id
      let fields: Record<string, unknown>
      try {
        fields = JSON.parse(args.fields_json) as Record<string, unknown>
      } catch {
        return { title: "update_setting", output: `fields_json 不是合法 JSON：${args.fields_json}` }
      }
      if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
        return { title: "update_setting", output: "fields_json 必须是非空对象" }
      }
      for (const field of SETTING_TEXT_FIELDS[type] ?? []) {
        if (typeof fields[field] === "string") fields[field] = normalizeSettingText(fields[field] as string)
      }
      const textErrors = (SETTING_TEXT_FIELDS[type] ?? []).flatMap((field) => {
        const error = settingTextFormatError(fields[field], type, field)
        return error ? [`${type}.${field}：${error}`] : []
      })
      if (textErrors.length > 0) {
        return {
          title: "update_setting",
          output: `设定文本格式校验失败：\n${textErrors.join("\n")}`,
          metadata: { entity_type: type, entity_id: id, errors: textErrors },
        }
      }
      const db = getDb(ctx.directory)
      // 引用追踪 + 级联副作用
      let cascadeSummary: { affected_chapters: number; tasks_created: number; old_title?: string; new_title?: string; old_content_head?: string; new_content_head?: string } | null = null
      let updateImpact: ImpactReport | undefined
      // 设定修改历史归档：每个真实变化的字段都记一条 description_history
      const historyEntries: Array<{ field: string; old_len: number; new_len: number }> = []
      try {
        if (type === "world_entry") {
          // 1) 拿旧值，用于比对 + 构造 cascade reason + 归档
          const oldRow = await db
            .select()
            .from(WorldEntryTable)
            .where(eq(WorldEntryTable.id, id))
            .get()
          if (!oldRow) {
            return { title: "update_setting", output: `world_entry 不存在：${id.slice(0, 8)}` }
          }
          const f: { category?: string; title?: string; content?: string } = {}
          if (typeof fields.category === "string") {
            const categoryError = validateWorldCategory(fields.category)
            if (categoryError && !args.allow_new_category) {
              return { title: "update_setting", output: categoryError }
            }
            f.category = fields.category
          }
          if (typeof fields.title === "string") f.title = fields.title
          if (typeof fields.content === "string") f.content = fields.content
          await updateWorldEntry(id, f, ctx.directory)

          // 2) 重建本 world_entry 在所有 chapter_versions.content 中的引用追踪
          //    新 title / 新 content 重新 scan（EntityRefTable 里本 world_entry 的旧引用作废）
          const newContent = (f.content ?? oldRow.content) ?? ""
          await scanReferences(db, oldRow.novel_id, "world_entry", id, "content", newContent)

          // 3) 每个真实变化的字段 → 归档到 description_history
          if (f.category !== undefined && f.category !== oldRow.category) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.category, f.category, "category")
            historyEntries.push({ field: "category", old_len: oldRow.category.length, new_len: f.category.length })
          }
          if (f.title !== undefined && f.title !== oldRow.title) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.title, f.title, "title")
            historyEntries.push({ field: "title", old_len: oldRow.title.length, new_len: f.title.length })
          }
          if (f.content !== undefined && f.content !== (oldRow.content ?? "")) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "world_entry", id, oldRow.content ?? "", f.content, "content")
            historyEntries.push({ field: "content", old_len: (oldRow.content ?? "").length, new_len: f.content.length })
          }

          // 4) title 或 content 变化 → 触发章节级联（影响已写正文的连贯性）
          const titleChanged = typeof f.title === "string" && f.title !== oldRow.title
          const contentChanged = typeof f.content === "string" && f.content !== oldRow.content
          if (titleChanged || contentChanged) {
            const oldVal = titleChanged ? oldRow.title : (oldRow.content ?? "").slice(0, 80)
            const newVal = titleChanged ? (f.title as string) : (f.content as string).slice(0, 80)
            const reason = titleChanged
              ? `world_entry 标题由「${oldRow.title}」改为「${f.title}」，可能影响已写章节中对该条目的称谓`
              : `world_entry「${oldRow.title}」内容有大幅修改，已写章节可能与新设定不一致`
            const intent = {
              novelId: oldRow.novel_id,
              entityType: "world_entry",
              entityId: id,
              field: titleChanged ? "title" : "content",
              oldValue: oldVal,
              newValue: newVal,
              reason,
            }
            const tasksCreated = await applyImpact(db, intent)
            const affectedRefs = await cascadeCheck(db, oldRow.novel_id, "world_entry", id)
            const affectedChapters = new Set(affectedRefs.filter((r) => r.source_type === "chapter").map((r) => r.source_id)).size
            cascadeSummary = {
              affected_chapters: affectedChapters,
              tasks_created: tasksCreated,
              old_title: titleChanged ? oldRow.title : undefined,
              new_title: titleChanged ? (f.title as string) : undefined,
              old_content_head: contentChanged ? (oldRow.content ?? "").slice(0, 40) : undefined,
              new_content_head: contentChanged ? (f.content as string).slice(0, 40) : undefined,
            }
            updateImpact = await buildImpactReport(db, intent, await planImpact(db, intent), tasksCreated)
          }
        } else if (type === "plot_thread") {
          const oldRow = await db
            .select()
            .from(PlotThreadTable)
            .where(eq(PlotThreadTable.id, id))
            .get()
          if (!oldRow) {
            return { title: "update_setting", output: `plot_thread 不存在：${id.slice(0, 8)}` }
          }
          const f: { title?: string; status?: string; priority?: string; description?: string } = {}
          if (typeof fields.title === "string") f.title = fields.title
          if (typeof fields.status === "string") f.status = fields.status
          if (typeof fields.priority === "string") f.priority = fields.priority
          if (typeof fields.description === "string") f.description = fields.description
          await updatePlotThread(id, f, ctx.directory)
          // 归档每个真实变化的字段
          for (const field of ["title", "status", "priority", "description"] as const) {
            if (f[field] === undefined) continue
            const newVal = f[field] as string
            const oldVal = (oldRow[field] ?? "") as string
            if (newVal === oldVal) continue
            await archiveDescription(ctx.directory, oldRow.novel_id, "plot_thread", id, oldVal, newVal, field)
            historyEntries.push({ field, old_len: oldVal.length, new_len: newVal.length })
          }
          if (historyEntries.length > 0) {
            const intent = {
              novelId: oldRow.novel_id,
              entityType: "plot_thread",
              entityId: id,
              field: historyEntries.map((h) => h.field).join(", "),
              oldValue: JSON.stringify({ title: oldRow.title, status: oldRow.status, priority: oldRow.priority, description: oldRow.description }),
              newValue: JSON.stringify(f),
              reason: `剧情线「${oldRow.title}」更新（${historyEntries.map((h) => h.field).join(", ")}）`,
            }
            const created = await applyImpact(db, intent)
            updateImpact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
          }
        } else if (type === "foreshadowing") {
          const oldRow = await db
            .select()
            .from(ForeshadowingTable)
            .where(eq(ForeshadowingTable.id, id))
            .get()
          if (!oldRow) {
            return { title: "update_setting", output: `foreshadowing 不存在：${id.slice(0, 8)}` }
          }
          const f: { content?: string; state?: string; resolvedChapterId?: string | null } = {}
          if (typeof fields.content === "string") f.content = fields.content
          if (typeof fields.state === "string") f.state = fields.state
          if ("resolved_chapter_id" in fields) {
            f.resolvedChapterId = fields.resolved_chapter_id == null ? null : String(fields.resolved_chapter_id)
          }
          await updateForeshadowing(id, f, ctx.directory)
          // 归档 content / state
          if (f.content !== undefined && f.content !== (oldRow.content ?? "")) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "foreshadowing", id, oldRow.content ?? "", f.content, "content")
            historyEntries.push({ field: "content", old_len: (oldRow.content ?? "").length, new_len: f.content.length })
          }
          if (f.state !== undefined && f.state !== oldRow.state) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "foreshadowing", id, oldRow.state, f.state, "state")
            historyEntries.push({ field: "state", old_len: oldRow.state.length, new_len: f.state.length })
          }
          if (historyEntries.length > 0) {
            const intent = {
              novelId: oldRow.novel_id,
              entityType: "foreshadow",
              entityId: id,
              field: historyEntries.map((h) => h.field).join(", "),
              oldValue: JSON.stringify({ content: oldRow.content, state: oldRow.state }),
              newValue: JSON.stringify(f),
              reason: `伏笔更新（${historyEntries.map((h) => h.field).join(", ")}）`,
            }
            const created = await applyImpact(db, intent)
            updateImpact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
          }
        } else if (type === "relationship") {
          const oldRow = await db
            .select()
            .from(RelationshipTable)
            .where(eq(RelationshipTable.id, id))
            .get()
          if (!oldRow) {
            return { title: "update_setting", output: `relationship 不存在：${id.slice(0, 8)}` }
          }
          const f: { type?: string; description?: string } = {}
          if (typeof fields.type === "string") f.type = fields.type
          if (typeof fields.description === "string") f.description = fields.description
          await updateRelationship(id, f, ctx.directory)
          // 归档 type / description
          if (f.type !== undefined && f.type !== (oldRow.type ?? "")) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "relationship", id, oldRow.type ?? "", f.type, "type")
            historyEntries.push({ field: "type", old_len: (oldRow.type ?? "").length, new_len: f.type.length })
          }
          if (f.description !== undefined && f.description !== (oldRow.description ?? "")) {
            await archiveDescription(ctx.directory, oldRow.novel_id, "relationship", id, oldRow.description ?? "", f.description, "description")
            historyEntries.push({ field: "description", old_len: (oldRow.description ?? "").length, new_len: f.description.length })
          }
          if (historyEntries.length > 0) {
            const intent = {
              novelId: oldRow.novel_id,
              entityType: "relationship",
              entityId: id,
              field: historyEntries.map((h) => h.field).join(", "),
              oldValue: JSON.stringify({ type: oldRow.type, description: oldRow.description }),
              newValue: JSON.stringify(f),
              reason: `关系「${oldRow.type}」更新（${historyEntries.map((h) => h.field).join(", ")}）`,
            }
            const created = await applyImpact(db, intent)
            updateImpact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
          }
        } else {
          return { title: "update_setting", output: `不支持的实体类型：${type}` }
        }
        // 拼接级联提示 + 历史归档提示
        let cascadeLine = ""
        if (cascadeSummary) {
          const parts: string[] = []
          if (cascadeSummary.tasks_created > 0) {
            parts.push(
              `已为 ${cascadeSummary.tasks_created} 个引用章节创建级联任务（在 cascade_list_pending 中可见）`,
            )
          } else if (cascadeSummary.affected_chapters > 0) {
            parts.push(
              `检测到 ${cascadeSummary.affected_chapters} 个章节引用此条目，但已存在同类级联任务，未重复创建`,
            )
          } else if (cascadeSummary.old_title || cascadeSummary.old_content_head) {
            parts.push(`暂无章节引用此条目，无级联任务`)
          }
          if (cascadeSummary.old_title && cascadeSummary.new_title) {
            parts.push(`称谓：${cascadeSummary.old_title} → ${cascadeSummary.new_title}`)
          }
          if (parts.length > 0) cascadeLine = `\n⚠️ 级联提醒：${parts.join("；")}`
        }
        let historyLine = ""
        if (historyEntries.length > 0) {
          historyLine = `\n📜 历史归档：${historyEntries.length} 个字段已记录（${historyEntries.map((h) => `${h.field}: ${h.old_len}→${h.new_len}字`).join("，")}）；用 description_history 工具查看/恢复历史版本`
        }
        return {
          title: "update_setting",
          output: `已更新 ${type} ${id.slice(0, 8)}：${Object.keys(fields).join(", ")}${cascadeLine}${historyLine}`,
          metadata: { entity_type: type, entity_id: id, updated: Object.keys(fields), cascade: cascadeSummary, history_archived: historyEntries, impact: updateImpact },
        }
      } catch (err) {
        return {
          title: "update_setting",
          output: `更新失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  }),
}
