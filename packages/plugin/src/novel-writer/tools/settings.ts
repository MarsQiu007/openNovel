/**
 * settings 域写作工具（V2 版，查询半域）。从 novel-writer.ts 机械转换，
 * 窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { and, asc, eq, like, or } from "drizzle-orm"
import { Schema } from "effect"
import { parseStyleRules } from "../context.js"
import {
  getDb,
  CHARACTER_PROFILE_DIMENSIONS,
  CharacterTable,
  ForeshadowingTable,
  normalizeStyleRules,
  parseCharacterProfile,
  PlotThreadTable,
  RelationshipTable,
  serializeCharacterProfile,
  STYLE_RULES_FORMAT_HINT,
  StyleGuideTable,
  VolumeTable,
  WorldEntryTable,
  type CharacterProfile,
} from "../session-store.js"
import { archiveDescription, normalizeStyleGuideData, scanReferences } from "../state-commit.js"
import { CHARACTER_PROFILE_DIMENSION_LABELS, profileShapeError } from "../profile-ops.js"
import { applyImpact, buildImpactReport, planImpact, type ImpactReport } from "../setting-impact.js"
import { SETTING_TEXT_FIELDS } from "../setting-review-candidates.js"
import { normalizeSettingText, SETTING_TEXT_FORMAT_RULE, settingTextFormatError } from "../setting-text.js"
import { validateWorldCategory, WORLD_ENTRY_CATEGORY_HINT } from "../world-category.js"
import { defineTool } from "../../v2/effect/tool.js"
import { SETTING_ENTITY_TYPES, resolveCharRef, resolveNovelId, searchSnippet } from "./shared.js"

export const settingsTools = {
  save_novel_settings: defineTool({
    description:
      '批量保存小说设定到数据库。architect agent 专用：将世界观/伏笔/剧情线索/风格指南/角色/卷/关系等设定持久化。settings_json 为 JSON 数组，每项形如 {"type":"world_entry","data":{"title":"...","content":"..."}}。支持类型：character/world_entry/plot_thread/foreshadowing/style_guide/volume/relationship。style_guide 为单条覆盖写入（已存在则更新，否则插入）。character 先于 relationship 处理：character 可带 ref 字段（本地引用键），relationship 通过 char_a_ref/char_b_ref 引用已插入角色；也兼容 char_a_id/char_b_id 传 UUID 或姓名（同名歧义时需用 ref）。各类型 data 字段：style_guide={tone 基调,pov 视角,tense 时态,rules 写作规则（扁平字符串映射：值需为标量，嵌套对象按 父.子 展平、数组按索引展平）}；character={name,role,description,profile 可选档案对象（{appearance 身体特征,speech 说话习惯,tone 语气,personality 个性,mannerism 习惯动作,extensions 自定义KV}，值限字符串，整包替换语义）}；world_entry={category,title,content}；content 必须用 \\n\\n 按主题分段，每段约 80–220 字，任一段超过 600 字必须继续分段；plot_thread={title,description,status,priority}；foreshadowing={content,state,planted_chapter_id}；volume={title,summary,order}；relationship={char_a_ref/char_a_id,char_b_ref/char_b_id,type,description}。\n\n' + SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      settings_json: Schema.String.annotate({
        description:
          '设定 JSON 数组，如 [{"type":"character","data":{"ref":"protagonist","name":"陆沉","role":"主角"}},{"type":"relationship","data":{"char_a_ref":"protagonist","char_b_ref":"antagonist","type":"宿敌","description":"..."}}]',
      }),
      allow_new_category: Schema.optional(
        Schema.Boolean.annotate({
          description: `world_entry 专用：允许使用标准列表之外的分类。${WORLD_ENTRY_CATEGORY_HINT}`,
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      let settings: Array<{ type: string; data: Record<string, unknown> }>
      try {
        settings = JSON.parse(args.settings_json)
      } catch {
        return { title: "save_novel_settings", output: "settings_json 不是合法 JSON" }
      }
      for (const setting of settings) {
        for (const field of SETTING_TEXT_FIELDS[setting.type] ?? []) {
          if (typeof setting.data?.[field] === "string") {
            setting.data[field] = normalizeSettingText(setting.data[field] as string)
          }
        }
      }
      const textErrors = settings.flatMap((setting, index) =>
        (SETTING_TEXT_FIELDS[setting.type] ?? []).flatMap((field) => {
          const error = settingTextFormatError(setting.data?.[field], setting.type, field)
          return error ? [`第${index}条（${setting.type}.${field}）：${error}`] : []
        }),
      )
      if (textErrors.length > 0) {
        return {
          title: "save_novel_settings",
          output: `设定文本格式校验失败：\n${textErrors.join("\n")}`,
          metadata: { count: 0, errors: textErrors },
        }
      }
      // Phase 1: 先插入所有 character，构建 ref->id 和 name->id[] 映射。
      // relationship 依赖这些映射来解析角色引用，所以 character 必须先落库。
      const refToId = new Map<string, string>()
      const nameToIds = new Map<string, string[]>()
      let count = 0
      const errors: string[] = []
      const impactIntents: { entityType: string; entityId: string; field: string; oldValue: string; newValue: string; reason: string }[] = []

      for (const [i, s] of settings.entries()) {
        if (s.type !== "character") continue
        try {
          const d = s.data
          const name = String(d.name ?? "")
          // 档案（character-profile）：data.profile 结构化对象，写入边界序列化一次；
          // 校验失败报错该条但不带档案落库，不阻断同批其余设定
          let profileJson: string | undefined
          if (d.profile !== undefined) {
            const profileError = profileShapeError(d.profile, "profile")
            if (profileError) {
              errors.push(`第${i}条（character「${name}」）：${profileError}`)
            } else {
              profileJson = serializeCharacterProfile(d.profile as CharacterProfile)
            }
          }
          const [existing] = await db
            .select({ id: CharacterTable.id, description: CharacterTable.description })
            .from(CharacterTable)
            .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, name)))
            .limit(1)
            .all()

          let id: string
          const requestedDesc = String(d.description ?? "")
          // 落库生效的描述：更新分支 description 缺省时保留原描述，
          // 批量建档可能只补档案，不该把描述抹空并误触压缩拦截
          const effectiveDesc = existing && d.description === undefined ? existing.description : requestedDesc
          if (existing) {
            id = existing.id
            const oldDesc = existing.description
            if (oldDesc !== effectiveDesc) impactIntents.push({ entityType: "character", entityId: id, field: "description", oldValue: oldDesc, newValue: effectiveDesc, reason: `角色「${name}」描述批量更新` })
            if (oldDesc.length > 0 && effectiveDesc.length < oldDesc.length * 0.5) {
              errors.push(
                `角色「${name}」新描述(${effectiveDesc.length}字)比旧描述(${oldDesc.length}字)短超过一半，已跳过更新保留原文`,
              )
              count++
              const ref = d.ref ? String(d.ref) : ""
              if (ref) refToId.set(ref, id)
              if (name) nameToIds.set(name, [...(nameToIds.get(name) ?? []), id])
              continue
            }
            if (oldDesc.length > 0 && effectiveDesc.length < oldDesc.length) {
              await archiveDescription(ctx.directory, novelId, "character", id, oldDesc, effectiveDesc)
            }
            await db
              .update(CharacterTable)
              .set({
                role: String(d.role ?? ""),
                description: effectiveDesc,
                ...(profileJson !== undefined ? { profile: profileJson } : {}),
              })
              .where(eq(CharacterTable.id, id))
              .run()
          } else {
            id = crypto.randomUUID()
            await db
              .insert(CharacterTable)
              .values({
                id,
                novel_id: novelId,
                name,
                role: String(d.role ?? ""),
                description: effectiveDesc,
                ...(profileJson !== undefined ? { profile: profileJson } : {}),
              })
              .run()
          }
          count++
          const ref = d.ref ? String(d.ref) : ""
          if (ref) refToId.set(ref, id)
          if (name) nameToIds.set(name, [...(nameToIds.get(name) ?? []), id])
          await scanReferences(db, novelId, "character", id, "description", effectiveDesc)
        } catch (err) {
          errors.push(`第${i}条：${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Phase 2: 插入其余类型；relationship 通过 resolveCharRef 解析角色引用
      for (const [i, s] of settings.entries()) {
        if (s.type === "character") continue
        try {
          const d = s.data
          switch (s.type) {
            case "world_entry": {
              const category = String(d.category ?? "")
              const categoryError = validateWorldCategory(category)
              if (categoryError && !args.allow_new_category) {
                errors.push(`第${i}条（world_entry「${String(d.title ?? "")}」）：${categoryError}`)
                break
              }
              await db
                .insert(WorldEntryTable)
                .values({
                  id: crypto.randomUUID(),
                  novel_id: novelId,
                  category,
                  title: String(d.title ?? ""),
                  content: String(d.content ?? ""),
                })
                .run()
              count++
              break
            }
            case "plot_thread":
              await db
                .insert(PlotThreadTable)
                .values({
                  id: crypto.randomUUID(),
                  novel_id: novelId,
                  title: String(d.title ?? ""),
                  status: String(d.status ?? "open"),
                  priority: String(d.priority ?? "medium"),
                  description: String(d.description ?? ""),
                })
                .run()
              count++
              break
            case "foreshadowing":
              await db
                .insert(ForeshadowingTable)
                .values({
                  id: crypto.randomUUID(),
                  novel_id: novelId,
                  content: String(d.content ?? ""),
                  state: String(d.state ?? "planted"),
                  planted_chapter_id: d.planted_chapter_id ? String(d.planted_chapter_id) : null,
                })
                .run()
              count++
              break
            case "style_guide": {
              // 兼容中英文键名：agent 可能从 check 输出的中文展示反推格式
              const normalized = normalizeStyleGuideData(d)
              if (!normalized) {
                errors.push(`第${i}条：style_guide 数据中未找到任何有效字段（支持 tone/基调, pov/视角, tense/时态, rules/规则）`)
                break
              }
              // 非空规则无法归一化时整体拒绝该条（tone/pov/tense 也不写入，不产生部分成功）
              let rules: Record<string, string> = {}
              if (normalized.rules !== undefined) {
                const result = normalizeStyleRules(normalized.rules)
                if (result.unnormalizable) {
                  errors.push(`第${i}条：规则无法归一化（${STYLE_RULES_FORMAT_HINT}）`)
                  break
                }
                rules = result.rules
              }
              // 单条覆盖语义用 update-if-exists / insert-if-not 实现：单条 SQL 原子，
              // 失败时旧数据仍在；不允许先删后插（insert 失败会丢失原有风格指南）
              const [existingSg] = await db
                .select({ id: StyleGuideTable.id })
                .from(StyleGuideTable)
                .where(eq(StyleGuideTable.novel_id, novelId))
                .limit(1)
                .all()
              if (existingSg) {
                impactIntents.push({ entityType: "style", entityId: novelId, field: "style_guide", oldValue: "", newValue: JSON.stringify(normalized), reason: "文风指南更新" })
                await db
                  .update(StyleGuideTable)
                  .set({
                    rules,
                    tone: normalized.tone,
                    pov: normalized.pov,
                    tense: normalized.tense,
                  })
                  .where(eq(StyleGuideTable.id, existingSg.id))
                  .run()
              } else {
                await db
                  .insert(StyleGuideTable)
                  .values({
                    id: crypto.randomUUID(),
                    novel_id: novelId,
                    rules,
                    tone: normalized.tone,
                    pov: normalized.pov,
                    tense: normalized.tense,
                  })
                  .run()
              }
              count++
              break
            }
            case "volume":
              await db
                .insert(VolumeTable)
                .values({
                  id: crypto.randomUUID(),
                  novel_id: novelId,
                  title: String(d.title ?? ""),
                  summary: String(d.summary ?? ""),
                  order: Number(d.order ?? 1),
                })
                .run()
              count++
              break
            case "relationship": {
              const a = resolveCharRef(d, "char_a", refToId, nameToIds)
              const b = resolveCharRef(d, "char_b", refToId, nameToIds)
              if ("error" in a) {
                errors.push(`第${i}条：char_a ${a.error}`)
                break
              }
              if ("error" in b) {
                errors.push(`第${i}条：char_b ${b.error}`)
                break
              }
              await db
                .insert(RelationshipTable)
                .values({
                  id: crypto.randomUUID(),
                  novel_id: novelId,
                  char_a_id: a.id,
                  char_b_id: b.id,
                  type: String(d.type ?? ""),
                  description: String(d.description ?? ""),
                })
                .run()
              count++
              break
            }
            default:
              errors.push(`第${i}条：未知类型 "${s.type}"`)
          }
        } catch (err) {
          errors.push(`第${i}条：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // 统一影响面：批量保存中对既有设定（角色描述/文风）的修改同样生成任务
      let totalCreated = 0
      let lastReport: ImpactReport | undefined
      for (const it of impactIntents) {
        const intent = { novelId, ...it }
        const created = await applyImpact(db, intent)
        totalCreated += created
        lastReport = await buildImpactReport(db, intent, await planImpact(db, intent), created)
      }
      return {
        title: "save_novel_settings",
        output:
          `已保存 ${count} 条设定${errors.length > 0 ? "，错误：" + errors.join("; ") : ""}\n` +
          (totalCreated > 0 ? `⚠ 已生成 ${totalCreated} 个联动任务（待处理 ${lastReport?.pending_count ?? 0} 个），用 cascade_list_pending 查看\n` : "") +
          `💡 建议：保存设定后调用 check_settings_consistency 验证设定内部自洽性（避免不同条目定义同一概念但数字/术语不一致）`,
        metadata: { count, errors, impact: lastReport },
      }
    },
  }),

  check_novel_settings: defineTool({
    description:
      "一键拉取小说所有设定（角色/世界观/伏笔/剧情线索/关系/卷/风格指南）的概览 + 完整内容 + 状态摘要，供 director 做'检查设定/审查设定/审一遍设定'类指令使用。可选 scope 限定范围。仅查询不修改，是审计设定类指令的入口工具。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      scope: Schema.optional(
        Schema.Literals(["all", "world", "characters", "relationships", "threads", "foreshadowing", "style_guide"]).annotate({
          description:
            "限定范围：all=全部（默认）；world=世界观条目；characters=角色；relationships=关系；threads=剧情线索；foreshadowing=伏笔；style_guide=风格指南",
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const scope = args.scope ?? "all"
      const lines: string[] = []
      const counts: Record<string, number> = {}

      if (scope === "all" || scope === "world") {
        const rows = await db
          .select()
          .from(WorldEntryTable)
          .where(eq(WorldEntryTable.novel_id, novelId))
          .all()
        counts.world = rows.length
        if (rows.length > 0) {
          lines.push(`## 世界观条目（${rows.length}）`)
          for (const r of rows) {
            lines.push(`- [${r.id.slice(0, 8)}] ${r.category}: ${r.title}`)
            if (r.content) lines.push(`  ${r.content}`)
          }
          lines.push("")
        }
      }

      if (scope === "all" || scope === "characters") {
        const rows = await db
          .select()
          .from(CharacterTable)
          .where(eq(CharacterTable.novel_id, novelId))
          .orderBy(CharacterTable.name)
          .all()
        counts.characters = rows.length
        if (rows.length > 0) {
          lines.push(`## 角色（${rows.length}）`)
          for (const r of rows) {
            lines.push(`- [${r.id.slice(0, 8)}] ${r.name}（${r.role || "无角色"}）`)
            if (r.description) lines.push(`  ${r.description}`)
            // 档案维度行（character-profile）：有档案才渲染，塑造闭环对 agent 可见
            const profile = parseCharacterProfile(r.profile)
            const dimTexts = CHARACTER_PROFILE_DIMENSIONS.flatMap((dim) =>
              profile[dim] ? [`${CHARACTER_PROFILE_DIMENSION_LABELS[dim]}：${profile[dim]}`] : [],
            )
            if (dimTexts.length > 0) lines.push(`  档案：${dimTexts.join("；")}`)
            const extTexts = Object.entries(profile.extensions ?? {}).map(([key, value]) => `${key}=${value}`)
            if (extTexts.length > 0) lines.push(`  档案扩展：${extTexts.join("；")}`)
          }
          lines.push("")
        }
      }

      if (scope === "all" || scope === "relationships") {
        const rows = await db
          .select()
          .from(RelationshipTable)
          .where(eq(RelationshipTable.novel_id, novelId))
          .all()
        counts.relationships = rows.length
        if (rows.length > 0) {
          lines.push(`## 关系（${rows.length}）`)
          for (const r of rows) {
            lines.push(`- [${r.id.slice(0, 8)}] ${r.type || "未分类"}`)
            if (r.description) lines.push(`  ${r.description}`)
          }
          lines.push("")
        }
      }

      if (scope === "all" || scope === "threads") {
        const rows = await db
          .select()
          .from(PlotThreadTable)
          .where(eq(PlotThreadTable.novel_id, novelId))
          .orderBy(PlotThreadTable.title)
          .all()
        counts.threads = rows.length
        if (rows.length > 0) {
          lines.push(`## 剧情线索（${rows.length}）`)
          for (const r of rows) {
            lines.push(`- [${r.id.slice(0, 8)}] ${r.title}（${r.status}，优先级=${r.priority}）`)
            if (r.description) lines.push(`  ${r.description}`)
          }
          lines.push("")
        }
      }

      if (scope === "all" || scope === "foreshadowing") {
        const rows = await db
          .select()
          .from(ForeshadowingTable)
          .where(eq(ForeshadowingTable.novel_id, novelId))
          .orderBy(asc(ForeshadowingTable.created_at))
          .all()
        counts.foreshadowing = rows.length
        if (rows.length > 0) {
          lines.push(`## 伏笔（${rows.length}）`)
          for (const r of rows) {
            const planted = r.planted_chapter_id ? `埋于第${r.planted_chapter_id.slice(0, 8)}章` : ""
            const resolved = r.resolved_chapter_id ? `，收于第${r.resolved_chapter_id.slice(0, 8)}章` : ""
            lines.push(`- [${r.id.slice(0, 8)}] ${r.content}（${r.state}${planted}${resolved}）`)
          }
          lines.push("")
        }
      }

      if (scope === "all" || scope === "style_guide") {
        const [sg] = await db
          .select()
          .from(StyleGuideTable)
          .where(eq(StyleGuideTable.novel_id, novelId))
          .all()
        counts.style_guide = sg ? 1 : 0
        if (sg) {
          lines.push(`## 风格指南`)
          if (sg.tone) lines.push(`- 基调：${sg.tone}`)
          if (sg.pov) lines.push(`- 视角：${sg.pov}`)
          if (sg.tense) lines.push(`- 时态：${sg.tense}`)
          for (const [key, value] of Object.entries(parseStyleRules(sg.rules))) {
            lines.push(`- ${key}: ${value}`)
          }
          lines.push("")
        }
      }

      if (lines.length === 0) {
        return { title: "check_novel_settings", output: "小说暂无任何设定记录" }
      }

      const header = `小说设定概览（${novelId.slice(0, 8)}）\n范围：${scope} | 统计：${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}\n`
      return {
        title: "check_novel_settings",
        output: header + "\n" + lines.join("\n"),
        metadata: { novel_id: novelId, scope, counts },
      }
    },
  }),

  list_settings: defineTool({
    description:
      "列出小说设定。返回 character/world_entry/plot_thread/foreshadowing/volume/relationship 类型记录的 ID、名称/内容摘要、状态等，供 agent 在删除或修改前定位 entity_id。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_type: Schema.String.annotate({
        description: "实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship",
      }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const type = args.entity_type
      let lines: string[] = []
      let count = 0
      if (type === "character") {
        const rows = await db
          .select({ id: CharacterTable.id, name: CharacterTable.name, role: CharacterTable.role })
          .from(CharacterTable)
          .where(eq(CharacterTable.novel_id, novelId))
          .orderBy(CharacterTable.name)
          .all()
        count = rows.length
        lines = rows.map((r) => `- [${r.id}] ${r.name}（${r.role}）`)
      } else if (type === "world_entry") {
        const rows = await db
          .select({ id: WorldEntryTable.id, category: WorldEntryTable.category, title: WorldEntryTable.title })
          .from(WorldEntryTable)
          .where(eq(WorldEntryTable.novel_id, novelId))
          .orderBy(WorldEntryTable.category, WorldEntryTable.title)
          .all()
        count = rows.length
        lines = rows.map((r) => `- [${r.id}] ${r.category}: ${r.title}`)
      } else if (type === "plot_thread") {
        const rows = await db
          .select({ id: PlotThreadTable.id, title: PlotThreadTable.title, status: PlotThreadTable.status })
          .from(PlotThreadTable)
          .where(eq(PlotThreadTable.novel_id, novelId))
          .orderBy(PlotThreadTable.title)
          .all()
        count = rows.length
        lines = rows.map((r) => `- [${r.id}] ${r.title}（${r.status}）`)
      } else if (type === "foreshadowing") {
        const rows = await db
          .select({
            id: ForeshadowingTable.id,
            content: ForeshadowingTable.content,
            state: ForeshadowingTable.state,
          })
          .from(ForeshadowingTable)
          .where(eq(ForeshadowingTable.novel_id, novelId))
          .orderBy(ForeshadowingTable.created_at)
          .all()
        count = rows.length
        lines = rows.map(
          (r) => `- [${r.id}] ${r.content.slice(0, 60)}${r.content.length > 60 ? "..." : ""}（${r.state}）`,
        )
      } else if (type === "volume") {
        const rows = await db
          .select({ id: VolumeTable.id, title: VolumeTable.title, order: VolumeTable.order })
          .from(VolumeTable)
          .where(eq(VolumeTable.novel_id, novelId))
          .orderBy(VolumeTable.order)
          .all()
        count = rows.length
        lines = rows.map((r) => `- [${r.id}] 第${r.order}卷 ${r.title}`)
      } else if (type === "relationship") {
        const rows = await db
          .select({
            id: RelationshipTable.id,
            type: RelationshipTable.type,
            description: RelationshipTable.description,
          })
          .from(RelationshipTable)
          .where(eq(RelationshipTable.novel_id, novelId))
          .orderBy(RelationshipTable.type)
          .all()
        count = rows.length
        lines = rows.map(
          (r) => `- [${r.id}] ${r.type}: ${r.description.slice(0, 60)}${r.description.length > 60 ? "..." : ""}`,
        )
      } else {
        return { title: "list_settings", output: `不支持的实体类型：${type}` }
      }
      if (count === 0) return { title: "list_settings", output: `${type} 暂无记录` }
      return {
        title: "list_settings",
        output: lines.join("\n"),
        metadata: { entity_type: type, count, items: lines },
      }
    },
  }),

  read_setting: defineTool({
    description:
      "读取单条小说设定的完整字段内容（不截断 content/description）。先用 list_settings 定位 entity_id；支持 character/world_entry/plot_thread/foreshadowing/volume/relationship。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_type: Schema.String.annotate({
        description: "实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship",
      }),
      entity_id: Schema.String.annotate({ description: "设定记录 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const type = args.entity_type
      const id = args.entity_id
      const unsupported = `不支持的实体类型：${type}。支持：${SETTING_ENTITY_TYPES.join("/")}`
      if (type === "character") {
        const [row] = await db
          .select()
          .from(CharacterTable)
          .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `character 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      if (type === "world_entry") {
        const [row] = await db
          .select()
          .from(WorldEntryTable)
          .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `world_entry 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      if (type === "plot_thread") {
        const [row] = await db
          .select()
          .from(PlotThreadTable)
          .where(and(eq(PlotThreadTable.novel_id, novelId), eq(PlotThreadTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `plot_thread 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      if (type === "foreshadowing") {
        const [row] = await db
          .select()
          .from(ForeshadowingTable)
          .where(and(eq(ForeshadowingTable.novel_id, novelId), eq(ForeshadowingTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `foreshadowing 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      if (type === "volume") {
        const [row] = await db
          .select()
          .from(VolumeTable)
          .where(and(eq(VolumeTable.novel_id, novelId), eq(VolumeTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `volume 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      if (type === "relationship") {
        const [row] = await db
          .select()
          .from(RelationshipTable)
          .where(and(eq(RelationshipTable.novel_id, novelId), eq(RelationshipTable.id, id)))
          .all()
        if (!row) return { title: "read_setting", output: `relationship 记录不存在：${id.slice(0, 8)}` }
        return {
          title: "read_setting",
          output: JSON.stringify(row, null, 2),
          metadata: { entity_type: type, entity_id: id, row },
        }
      }
      return { title: "read_setting", output: unsupported }
    },
  }),

  search_settings: defineTool({
    description:
      "按关键词搜索小说设定的标题或内容。支持 character/world_entry/plot_thread/foreshadowing/volume/relationship；不传 entity_type 时搜索全部类型，返回记录 ID、类型、标题和关键词上下文片段。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "搜索关键词（不能为空）" }),
      entity_type: Schema.optional(
        Schema.String.annotate({
          description: "可选实体类型：character/world_entry/plot_thread/foreshadowing/volume/relationship",
        }),
      ),
    }),
    async execute(args, ctx) {
      const query = args.query.trim()
      if (!query) return { title: "search_settings", output: "query 不能为空" }
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const type = args.entity_type
      if (type && !SETTING_ENTITY_TYPES.includes(type)) {
        return { title: "search_settings", output: `不支持的实体类型：${type}。支持：${SETTING_ENTITY_TYPES.join("/")}` }
      }
      const types = type ? [type] : SETTING_ENTITY_TYPES
      const results: Array<{ id: string; entity_type: string; title: string; matched_field: string; snippet: string }> = []
      const addResult = (entityType: string, id: string, title: string, fields: Record<string, string>) => {
        const matched = Object.entries(fields).find(([, value]) => value.toLowerCase().includes(query.toLowerCase()))
        if (!matched) return
        results.push({
          id,
          entity_type: entityType,
          title,
          matched_field: matched[0],
          snippet: searchSnippet(matched[1], query),
        })
      }

      if (types.includes("character")) {
        const rows = await db
          .select()
          .from(CharacterTable)
          .where(
            and(
              eq(CharacterTable.novel_id, novelId),
              or(
                like(CharacterTable.name, `%${query}%`),
                like(CharacterTable.role, `%${query}%`),
                like(CharacterTable.description, `%${query}%`),
              ),
            ),
          )
          .orderBy(CharacterTable.name)
          .all()
        rows.forEach((row) =>
          addResult("character", row.id, row.name, { name: row.name, role: row.role, description: row.description }),
        )
      }
      if (types.includes("world_entry")) {
        const rows = await db
          .select()
          .from(WorldEntryTable)
          .where(
            and(
              eq(WorldEntryTable.novel_id, novelId),
              or(
                like(WorldEntryTable.category, `%${query}%`),
                like(WorldEntryTable.title, `%${query}%`),
                like(WorldEntryTable.content, `%${query}%`),
              ),
            ),
          )
          .orderBy(WorldEntryTable.category, WorldEntryTable.title)
          .all()
        rows.forEach((row) =>
          addResult("world_entry", row.id, row.title, { category: row.category, title: row.title, content: row.content }),
        )
      }
      if (types.includes("plot_thread")) {
        const rows = await db
          .select()
          .from(PlotThreadTable)
          .where(
            and(
              eq(PlotThreadTable.novel_id, novelId),
              or(
                like(PlotThreadTable.title, `%${query}%`),
                like(PlotThreadTable.description, `%${query}%`),
              ),
            ),
          )
          .orderBy(PlotThreadTable.title)
          .all()
        rows.forEach((row) => addResult("plot_thread", row.id, row.title, { title: row.title, description: row.description }))
      }
      if (types.includes("foreshadowing")) {
        const rows = await db
          .select()
          .from(ForeshadowingTable)
          .where(and(eq(ForeshadowingTable.novel_id, novelId), like(ForeshadowingTable.content, `%${query}%`)))
          .orderBy(ForeshadowingTable.created_at)
          .all()
        rows.forEach((row) => {
          const title = row.content.length > 40 ? `${row.content.slice(0, 40)}...` : row.content
          addResult("foreshadowing", row.id, title, { content: row.content })
        })
      }
      if (types.includes("volume")) {
        const rows = await db
          .select()
          .from(VolumeTable)
          .where(and(eq(VolumeTable.novel_id, novelId), or(like(VolumeTable.title, `%${query}%`), like(VolumeTable.summary, `%${query}%`))))
          .orderBy(VolumeTable.order)
          .all()
        rows.forEach((row) => addResult("volume", row.id, row.title, { title: row.title, summary: row.summary }))
      }
      if (types.includes("relationship")) {
        const rows = await db
          .select()
          .from(RelationshipTable)
          .where(
            and(
              eq(RelationshipTable.novel_id, novelId),
              or(like(RelationshipTable.type, `%${query}%`), like(RelationshipTable.description, `%${query}%`)),
            ),
          )
          .orderBy(RelationshipTable.type)
          .all()
        rows.forEach((row) => addResult("relationship", row.id, row.type, { type: row.type, description: row.description }))
      }

      if (results.length === 0) return { title: "search_settings", output: `未找到与「${query}」匹配的设定。` }
      return {
        title: "search_settings",
        output: JSON.stringify(results, null, 2),
        metadata: { query, entity_type: type, count: results.length, items: results },
      }
    },
  }),
}
