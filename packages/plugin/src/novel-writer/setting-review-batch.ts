/**
 * 设定整理批处理编排 — setting-review-hub 任务 2.4 / design D6。
 *
 * 输入一份完整整理计划（由会话内 lint / 一致性检查 / 去重扫描 / analyze 结果汇成，
 * 或 generatePlanFromIssues 的机械修复计划），按分级自动化白名单拆分：
 * 白名单操作重校验通过后立即执行（落库 + description_history + 影响任务），
 * 其余操作逐条 stage 进收件箱；返回新增待审计数。计划整体校验失败则什么都不做。
 */

import {
  executeOrganizePlan,
  loadOrganizeContext,
  validateOrganizePlan,
  type OrganizeExecutionResult,
  type OrganizePlan,
} from "./setting-reorganization.js"
import { classifyAutoExecution } from "./setting-review-whitelist.js"
import { createStagedChangesFromPlan } from "./setting-review-staged.js"

export type RunSettingReviewBatchResult =
  | {
      ok: true
      /** 白名单内直接执行的操作数 */
      auto_executed: number
      /** 白名单部分执行结果（无白名单操作时为 null） */
      execution: OrganizeExecutionResult | null
      staged_ids: string[]
      superseded_ids: string[]
      /** 新增待审（stage 入箱）数量 */
      pending_added: number
    }
  | { ok: false; errors: string[] }

export async function runSettingReviewBatch(
  directory: string,
  novelId: string,
  plan: OrganizePlan,
  options: { source?: "agent" | "user"; evidence?: Record<string, unknown>; reason?: string } = {},
): Promise<RunSettingReviewBatchResult> {
  const context = await loadOrganizeContext(directory, novelId)
  const validation = validateOrganizePlan({
    plan,
    entries: context.entities,
    referencedKeys: context.referencedKeys,
    relatedCharacterIds: context.relatedCharacterIds,
  })
  if (!validation.ok) {
    return { ok: false, errors: validation.errors }
  }

  const entitiesByKey = new Map(context.entities.map((entity) => [`${entity.entity_type}:${entity.id}`, entity]))
  const isAuto = (operation: OrganizePlan["operations"][number]) => {
    const targetId = operation.action === "merge" ? operation.target_id : operation.id
    const entity = entitiesByKey.get(`${operation.entity_type}:${targetId}`)
    return entity !== undefined && classifyAutoExecution(operation, entity) !== null
  }
  const autoOperations = plan.operations.filter(isAuto)
  const reviewOperations = plan.operations.filter((operation) => !isAuto(operation))

  let execution: OrganizeExecutionResult | null = null
  if (autoOperations.length > 0) {
    execution = await executeOrganizePlan({ version: plan.version, operations: autoOperations }, { directory, novelId })
    const failed = execution.results.find((result) => result.status === "failed")
    if (failed) {
      return { ok: false, errors: [failed.error ?? "白名单自动执行失败"] }
    }
  }

  let stagedIds: string[] = []
  let supersededIds: string[] = []
  if (reviewOperations.length > 0) {
    const staged = await createStagedChangesFromPlan(
      directory,
      novelId,
      { version: plan.version, operations: reviewOperations },
      options,
    )
    if (!staged.ok) {
      return { ok: false, errors: staged.errors }
    }
    stagedIds = staged.staged_ids
    supersededIds = staged.superseded_ids
  }

  return {
    ok: true,
    auto_executed: autoOperations.length,
    execution,
    staged_ids: stagedIds,
    superseded_ids: supersededIds,
    pending_added: stagedIds.length,
  }
}
