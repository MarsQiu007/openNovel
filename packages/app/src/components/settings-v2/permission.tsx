import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePermissionMode, PERMISSION_MODES, type PermissionMode } from "@/context/permission-mode"
import { defaults as policyDefaults, resolve as resolvePolicy, type Policy } from "@/context/permission-policy"
import { useServerSync } from "@/context/server-sync"
import { SettingsRowV2 } from "./parts/row"

// "跟随会话"哨兵选项的稳定 value key（与 agents.tsx 的裁判模型列共用同一约定）。
const FOLLOW_VALUE = "__follow__"

type ModeOption = { value: PermissionMode; label: string }

type JudgeModelOption = {
  value: string
  providerID: string
  modelID: string
  label: string
  follow: boolean
}

const modelKey = (providerID: string, modelID: string) => `${providerID}/${modelID}`

// 全局权限配置区：模式三档选择器 + 全局默认裁判模型选择器 + 生效策略表只读展示。
// 写通道只走全局配置（design D1）；项目级配置仅作来源标注（design D3/D7）。
export const SettingsPermissionV2: Component<{ directory: () => string | undefined }> = (props) => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const models = useModels()
  const mode = usePermissionMode(props.directory)

  const modeOptions = createMemo<ModeOption[]>(() =>
    PERMISSION_MODES.map((value) => ({ value, label: language.t(`permission.mode.${value}`) })),
  )

  const globalPermission = createMemo(() => {
    const permission = serverSync().data.config.permission
    return typeof permission === "object" && permission !== null ? permission : undefined
  })
  const judgeModel = createMemo(() => {
    const model = globalPermission()?.judge?.model
    // 空串是 UI 清除选择器时的持久化值（mergeDeep 无法删键），服务端按 falsy 视为未配置。
    return model ? model : undefined
  })
  const globalPolicy = createMemo(() => globalPermission()?.policy)
  const projectPolicy = createMemo(() => {
    const dir = props.directory()
    if (!dir) return undefined
    const permission = serverSync().child(dir, { bootstrap: false })[0].config.permission
    return typeof permission === "object" && permission !== null ? permission.policy : undefined
  })

  const judgeModelOptions = createMemo<JudgeModelOption[]>(() => {
    const options: JudgeModelOption[] = [
      {
        value: FOLLOW_VALUE,
        providerID: "",
        modelID: "",
        label: language.t("settings.permission.judgeModel.follow"),
        follow: true,
      },
    ]
    const seen = new Set([FOLLOW_VALUE])
    for (const m of models.list()) {
      const value = modelKey(m.provider.id, m.id)
      if (seen.has(value)) continue
      seen.add(value)
      options.push({
        value,
        providerID: m.provider.id,
        modelID: m.id,
        label: `${m.provider.name} / ${m.name}`,
        follow: false,
      })
    }
    const configured = judgeModel()
    if (configured && !seen.has(configured)) {
      const [providerID, ...rest] = configured.split("/")
      options.push({
        value: configured,
        providerID: providerID ?? "",
        modelID: rest.join("/"),
        label: configured,
        follow: false,
      })
    }
    return options
  })

  const judgeModelValue = () => judgeModel() ?? FOLLOW_VALUE

  const onSelectJudgeModel = (option: JudgeModelOption | null) => {
    const next = !option || option.follow ? "" : option.value
    if (next === (judgeModel() ?? "")) return
    void serverSync().updateConfig({ permission: { judge: { model: next } } })
  }

  const policyRows = createMemo(() => {
    const actions = [...new Set([...Object.keys(policyDefaults), ...Object.keys(globalPolicy() ?? {})])].sort()
    const project = projectPolicy()
    const global = globalPolicy()
    return actions.map((action) => ({ action, policy: resolvePolicy(action, project, global) }))
  })

  const policyLabel = (policy: Policy) => language.t(`settings.permission.policy.${policy}`)

  return (
    <>
      <SettingsRowV2
        title={language.t("settings.permission.mode.title")}
        description={language.t("settings.permission.mode.description")}
      >
        <div data-action="settings-permission-mode">
          <SelectV2
            appearance="inline"
            placement="bottom-end"
            gutter={6}
            options={modeOptions()}
            current={modeOptions().find((o) => o.value === mode.effective())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option || option.value === mode.effective()) return
              void mode.setMode(option.value)
            }}
          />
        </div>
      </SettingsRowV2>
      <Show when={mode.projectMode() !== undefined}>
        <div class="settings-v2-row-note" data-action="settings-permission-mode-project-note">
          {mode.ignoredProjectMode() !== undefined
            ? language.t("settings.permission.mode.projectIgnored", { mode: mode.describe(mode.ignoredProjectMode()!) })
            : language.t("settings.permission.mode.projectDefined", { mode: mode.describe(mode.projectMode()!) })}
        </div>
      </Show>

      <SettingsRowV2
        title={language.t("settings.permission.judgeModel.title")}
        description={language.t("settings.permission.judgeModel.description")}
      >
        <div data-action="settings-permission-judge-model">
          <SelectV2
            appearance="inline"
            placement="bottom-end"
            gutter={6}
            options={judgeModelOptions()}
            current={judgeModelOptions().find((o) => o.value === judgeModelValue())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={onSelectJudgeModel}
          />
        </div>
      </SettingsRowV2>

      <SettingsRowV2
        title={language.t("settings.permission.policy.title")}
        description={language.t("settings.permission.policy.description")}
      >
        <div data-action="settings-permission-policy" class="settings-permission-policy">
          <For each={policyRows()}>
            {(row) => (
              <div class="settings-permission-policy-row">
                <span class="settings-permission-policy-action">{row.action}</span>
                <span class="settings-permission-policy-value">{policyLabel(row.policy)}</span>
              </div>
            )}
          </For>
        </div>
      </SettingsRowV2>
    </>
  )
}
