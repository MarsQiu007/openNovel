import { createHash } from "node:crypto"
import { Layer } from "effect"
import {
  analyzeEntities,
  executeOrganizePlan,
  loadOrganizeContext,
  parseOrganizePlan,
  validateOrganizePlan,
  type OrganizePlan,
  type OrganizeValidationResult,
  type SettingIssue,
  generatePlanFromIssues,
} from "@opennovel-ai/plugin/novel-writer/setting-reorganization"
import { SettingOrganization, type SettingOrganizationService } from "@opennovel-ai/server/setting-organization"
import type {
  SettingOrganizationAnalyzeResult,
  SettingOrganizationApplyResult,
  SettingOrganizationDryRunResult,
  SettingOrganizationIssue,
  SettingOrganizationOperationResult,
  SettingOrganizationPreview,
  SettingOrganizationRemainingOperation,
} from "@opennovel-ai/schema/novel"

function mapIssue(issue: SettingIssue): SettingOrganizationIssue {
  return {
    issueId: issue.issue_id,
    type: issue.type,
    entityType: issue.entity_type,
    entryIds: issue.entry_ids,
    evidence: issue.evidence,
    suggestion: issue.suggestion,
  }
}

function mapPreview(preview: OrganizeValidationResult["previews"][number]): SettingOrganizationPreview {
  return {
    index: preview.index,
    action: preview.action,
    entityType: preview.entity_type,
    entryIds: preview.entry_ids,
    summary: preview.summary,
    fields: preview.fields,
  }
}

function mapResult(result: Awaited<ReturnType<typeof executeOrganizePlan>>["results"][number]): SettingOrganizationOperationResult {
  return {
    index: result.index,
    action: result.action,
    entityType: result.entity_type,
    status: result.status,
    entryIds: result.entry_ids,
    changedFields: result.changed_fields,
    historyCount: result.history_count,
    cascadeTasks: result.cascade_tasks,
    error: result.error,
  }
}

function mapRemaining(remaining: Awaited<ReturnType<typeof executeOrganizePlan>>["remaining"]): SettingOrganizationRemainingOperation[] {
  return remaining.map((item) => ({
    index: item.index,
    action: item.action,
    entityType: item.entity_type,
    entryIds: item.entry_ids,
  }))
}

function planDigest(plan: OrganizePlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex")
}

function rejectedApply(errors: string[]): SettingOrganizationApplyResult {
  return { ok: false, errors, results: [], remaining: [] }
}

export function createSettingOrganizationService(): SettingOrganizationService {
  return {
    async analyze(novelID, directory, input) {
      const scope = input.scope ?? "all"
      const context = await loadOrganizeContext(directory, novelID, scope)
      const rawIssues = analyzeEntities(context.entities)
      const issues = rawIssues.map(mapIssue)
      const suggested = generatePlanFromIssues(context.entities, rawIssues)
      const result: SettingOrganizationAnalyzeResult = {
        scope,
        issues,
        count: issues.length,
        suggestedPlanJson: suggested.operations.length > 0 ? JSON.stringify(suggested) : undefined,
      }
      return result
    },

    async dryRun(novelID, directory, input) {
      try {
        const parsed = parseOrganizePlan(input.planJson)
        if (parsed.errors.length > 0 || !parsed.plan) {
          const result: SettingOrganizationDryRunResult = {
            valid: false,
            planDigest: "",
            previews: [],
            errors: parsed.errors,
          }
          return result
        }

        const context = await loadOrganizeContext(directory, novelID, "all")
        const validation = validateOrganizePlan({
          plan: parsed.plan,
          entries: context.entities,
          referencedKeys: context.referencedKeys,
          relatedCharacterIds: context.relatedCharacterIds,
        })
        const result: SettingOrganizationDryRunResult = {
          valid: validation.ok,
          planDigest: planDigest(parsed.plan),
          previews: validation.previews.map(mapPreview),
          errors: validation.errors,
        }
        return result
      } catch (error) {
        console.error("[setting-organization dryRun] 服务端异常:", error)
        return {
          valid: false,
          planDigest: "",
          previews: [],
          errors: [`服务端 dry run 异常: ${error instanceof Error ? error.message : String(error)}`],
        }
      }
    },

    async apply(novelID, directory, input) {
      if (!input.confirmed) return rejectedApply(["UI 执行计划缺少显式确认"])
      if (!input.planDigest) return rejectedApply(["UI 执行计划缺少 dry run 摘要"])

      const parsed = parseOrganizePlan(input.planJson)
      if (parsed.errors.length > 0 || !parsed.plan) return rejectedApply(parsed.errors)

      const context = await loadOrganizeContext(directory, novelID, "all")
      const validation = validateOrganizePlan({
        plan: parsed.plan,
        entries: context.entities,
        referencedKeys: context.referencedKeys,
        relatedCharacterIds: context.relatedCharacterIds,
      })
      if (!validation.ok) return rejectedApply(validation.errors)

      const digest = planDigest(parsed.plan)
      if (input.planDigest !== digest) return rejectedApply(["整理计划摘要不匹配，请重新 dry run"])

      const execution = await executeOrganizePlan(parsed.plan, { directory, novelId: novelID })
      const errors = execution.results
        .filter((result) => result.status === "failed")
        .map((result) => `operations[${result.index}]：${result.error ?? "执行失败"}`)
      return {
        ok: execution.ok,
        errors,
        results: execution.results.map(mapResult),
        remaining: mapRemaining(execution.remaining),
      }
    },
  }
}

export const SettingOrganizationLayer = Layer.succeed(SettingOrganization, createSettingOrganizationService())
