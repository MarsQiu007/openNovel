/**
 * technique 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { LEVEL_CRITERIA } from "../technique.js"

export const techniqueTools = {
  record_technique_feedback: defineTool({
    description:
      "记录写作技法的使用反馈（auditor 专用）。对 shadow-mode 检索到的技法，评估其在本章是否被有效运用，并给出评分。library 必须与候选列表标注的来源库一致：全局库技法反馈跨书积累，本书库技法反馈留在本书。",
    args: Schema.Struct({
      technique_id: Schema.String.annotate({ description: "技法 ID" }),
      library: Schema.Literals(["book", "global"]).annotate({
        description: "技法来源库（与快照候选列表标注一致）：book=本书库；global=全局通用库",
      }),
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      score: Schema.Number.annotate({ description: "技法运用效果评分 0-1，1 为效果显著" }),
      was_used: Schema.Boolean.annotate({ description: "技法是否在正文中被实际运用" }),
      comment: Schema.String.annotate({ description: "评语（可为空字符串）" }),
    }),
    async execute(args, ctx) {
      const { recordFeedback, updateConfidenceFromFeedback } = await import("../technique-store.js")
      await recordFeedback(
        {
          techniqueId: args.technique_id,
          chapterId: args.chapter_id,
          score: Math.max(0, Math.min(1, args.score)),
          wasUsed: args.was_used,
          comment: args.comment,
          createdAt: Date.now(),
        },
        ctx.directory,
        args.library,
      )
      await updateConfidenceFromFeedback(args.technique_id, ctx.directory, args.library)
      return {
        title: "record_technique_feedback",
        output: `已记录技法 ${args.technique_id.slice(0, 8)} 反馈（score=${args.score}）`,
      }
    },
  }),

  save_technique: defineTool({
    description:
      "把提炼出的写作技法入库（对话学习流程专用）。自动执行质量过滤（模糊指令黑名单、指令长度、必须有原文证据）；与库中同名技法自动合并证据，或传 merge_target_id 显式合并到近似技法。合并只追加证据，不动已有技法的状态与置信度。scope 决定存储位置：general=通用写法入全局通用库（跨书共享），adult=成人内容留本书库——拿不准一律标 adult（宁紧勿松，错标 adult 只是少复用，错标 general 会泄漏进通用书）。",
    args: Schema.Struct({
      name: Schema.String.annotate({ description: "技法名称" }),
      principle: Schema.String.annotate({ description: "抽象原则：技法本质概括" }),
      instruction: Schema.String.annotate({ description: "操作指令：可直接给写作模型的具体指令" }),
      scene_types: Schema.mutable(Schema.Array(Schema.String)).annotate({
        description:
          "适用场景类型列表（规范词表：action/dialogue/description/suspense/emotion_shift/transition/general，可多选，不确定或跨场景用 general）",
      }),
      level: Schema.Literals(["paragraph", "sentence", "dialogue", "description", "transition"]).annotate({
        description: `技法作用层级，判定必须按以下判据：${LEVEL_CRITERIA}`,
      }),
      evidence: Schema.Array(
        Schema.Struct({
          source_title: Schema.String.annotate({ description: "来源书名" }),
          source_location: Schema.String.annotate({ description: "来源位置（章节号）" }),
          excerpt: Schema.String.annotate({ description: "原文片段（逐字引用）" }),
          annotation: Schema.String.annotate({ description: "技法标注说明" }),
        }),
      ).annotate({ description: "证据列表（至少一条）" }),
      common_misuse: Schema.String.annotate({ description: "常见误用方式" }),
      scope: Schema.Literals(["general", "adult"]).annotate({
        description:
          "内容性质判断（必填）：general=通用写法（对话节奏、悬念铺设、视角控制等，入全局库跨书共享）；adult=成人内容技法（留本书库）。拿不准一律 adult",
      }),
      merge_target_id: Schema.optional(Schema.String.annotate({ description: "显式合并目标技法 ID；不传时按同名自动合并" })),
    }),
    async execute(args, ctx) {
      const { saveTechnique } = await import("../technique-learn.js")
      const result = await saveTechnique(
        {
          name: args.name,
          principle: args.principle,
          instruction: args.instruction,
          sceneTypes: args.scene_types,
          level: args.level,
          evidence: args.evidence.map((e) => ({
            sourceTitle: e.source_title,
            sourceLocation: e.source_location,
            excerpt: e.excerpt,
            annotation: e.annotation,
          })),
          commonMisuse: args.common_misuse,
          scope: args.scope,
        },
        args.merge_target_id,
        ctx.directory,
      )
      if (result.action === "rejected") {
        const rejected = {
          title: "save_technique",
          output: `已拒绝入库：「${args.name}」${result.reason}，请给出具体可操作的指令并附原文证据`,
          action: "rejected",
          reason: result.reason,
        }
        return rejected
      }
      if (result.action === "merged") {
        const merged = {
          title: "save_technique",
          output: `已合并到技法 ${result.technique_id.slice(0, 8)}`,
          action: "merged",
          technique_id: result.technique_id,
        }
        return merged
      }
      const created = {
        title: "save_technique",
        output: `已入库技法「${args.name}」（unverified/0.5，id=${result.technique_id.slice(0, 8)}）`,
        action: "created",
        technique_id: result.technique_id,
      }
      return created
    },
  }),

  search_techniques: defineTool({
    description:
      "查询技法库现有技法（对话学习与召回评估共用）。可按名称关键词、场景类型、层级、状态过滤；返回每条技法的 id、名称、原则与指令摘要，供合并判断或多轮召回参考。状态过滤语义：缺省为全部；`verified` 需经反馈积累产生，新库条目常全部为 `unverified`。",
    args: Schema.Struct({
      keyword: Schema.optional(Schema.String.annotate({ description: "名称/原则/指令关键词（不区分大小写）" })),
      scene_type: Schema.optional(
        Schema.String.annotate({
          description: "场景类型过滤（规范词表：action/dialogue/description/suspense/emotion_shift/transition/general）",
        }),
      ),
      level: Schema.optional(
        Schema.Literals(["paragraph", "sentence", "dialogue", "description", "transition"]).annotate({
          description: `技法作用层级过滤，层级判定判据：${LEVEL_CRITERIA}`,
        }),
      ),
      status: Schema.optional(
        Schema.Literals(["unverified", "verified", "shadow", "archived"]).annotate({ description: "状态过滤" }),
      ),
      limit: Schema.optional(Schema.Number.annotate({ description: "返回条数上限，默认 10" })),
    }),
    async execute(args, ctx) {
      const { searchTechniques } = await import("../technique-learn.js")
      const { lines, count, total, unverified } = await searchTechniques(
        {
          keyword: args.keyword,
          sceneType: args.scene_type,
          level: args.level,
          status: args.status,
          limit: args.limit,
        },
        ctx.directory,
      )
      const result = {
        title: "search_techniques",
        output:
          count > 0
            ? lines.join("\n")
            : total === 0
              ? "技法库为空（本书库与全局库均无条目）"
              : `过滤条件命中 0 条（无匹配条目）：库内共 ${total} 条（未验证 ${unverified} 条），可移除或放宽过滤条件后重试`,
        count,
      }
      return result
    },
  }),

  confirm_techniques: defineTool({
    description:
      "确认本轮注入 writer prompt 的技法最终列表（pipeline 召回评估后调用）。逐个递增使用计数，按 1000 token 预算裁剪后返回『写作技法指导』段落文本——把返回文本原样放进 writer dispatch prompt。",
    args: Schema.Struct({
      ids: Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "确认注入的技法 ID 列表（默认不超过 3 条）" }),
    }),
    async execute(args, ctx) {
      const { confirmTechniques } = await import("../technique-learn.js")
      const { section, injected } = await confirmTechniques(args.ids, ctx.directory)
      const result = {
        title: "confirm_techniques",
        output: section === "" ? "（无有效技法 ID，本轮不注入写作技法指导）" : section,
        injected,
      }
      return result
    },
  }),
}
