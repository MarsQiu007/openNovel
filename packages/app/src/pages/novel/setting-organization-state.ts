export type SettingOrganizationAction = "update" | "merge" | "delete"

export type SettingOrganizationPreview = {
  action: SettingOrganizationAction
}

export type SettingOrganizationDryRun = {
  valid: boolean
  planDigest: string
  previews: readonly SettingOrganizationPreview[]
  errors: readonly string[]
}

export type SettingOrganizationApplyResult = {
  ok: boolean
  errors: readonly string[]
  results: ReadonlyArray<{ status: "success" | "failed" }>
}

export type SettingOrganizationPlanState = {
  planJson: string
  submittedPlanJson: string
  dryRun: SettingOrganizationDryRun | null
}

export type SettingOrganizationActionCounts = Record<SettingOrganizationAction, number>

export function isPlanCurrent(state: Pick<SettingOrganizationPlanState, "planJson" | "submittedPlanJson">): boolean {
  return state.planJson.trim().length > 0 && state.planJson === state.submittedPlanJson
}

export function isApplyReady(input: SettingOrganizationPlanState): boolean {
  return isPlanCurrent(input) && input.dryRun?.valid === true && input.dryRun.previews.length > 0
}

export function countActions(previews: readonly SettingOrganizationPreview[]): SettingOrganizationActionCounts {
  return previews.reduce(
    (counts, preview) => ({ ...counts, [preview.action]: counts[preview.action] + 1 }),
    { update: 0, merge: 0, delete: 0 },
  )
}

export function hasAppliedChanges(result: SettingOrganizationApplyResult): boolean {
  return result.results.some((item) => item.status === "success")
}

export type SettingOrganizationApplyRequest = {
  planJson: string
  planDigest: string
}

export function prepareApplyRequest(
  input: SettingOrganizationPlanState,
  confirmed: boolean,
): SettingOrganizationApplyRequest | null {
  if (!confirmed || !isApplyReady(input) || !input.dryRun) return null
  return { planJson: input.submittedPlanJson, planDigest: input.dryRun.planDigest }
}
