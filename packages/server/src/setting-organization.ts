import { Context } from "effect"
import type {
  SettingOrganizationAnalyzeInput,
  SettingOrganizationAnalyzeResult,
  SettingOrganizationApplyInput,
  SettingOrganizationApplyResult,
  SettingOrganizationDryRunInput,
  SettingOrganizationDryRunResult,
} from "@opennovel-ai/schema/novel"

export type SettingOrganizationConfirmation = Pick<SettingOrganizationApplyInput, "planDigest" | "confirmed">

export interface SettingOrganizationService {
  analyze(novelID: string, directory: string, input: SettingOrganizationAnalyzeInput): Promise<SettingOrganizationAnalyzeResult>
  dryRun(novelID: string, directory: string, input: SettingOrganizationDryRunInput): Promise<SettingOrganizationDryRunResult>
  apply(novelID: string, directory: string, input: SettingOrganizationApplyInput): Promise<SettingOrganizationApplyResult>
}

export class SettingOrganization extends Context.Service<SettingOrganization, SettingOrganizationService>()(
  "@opennovel/server/SettingOrganization",
) {}
