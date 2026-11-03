import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { createMemo, type Component, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePermissionMode, PERMISSION_MODES, type PermissionMode } from "@/context/permission-mode"
import { SettingsRowV2 } from "./parts/row"

type ModeOption = { value: PermissionMode; label: string }

// 全局权限配置区：模式三档选择器 + 项目级来源标注。
// 裁判模型选择器收敛到智能体面板的内置"权限裁判"行；策略表已退为内置常量，不再展示。
// 写通道只走全局配置；项目级配置仅作来源标注。
export const SettingsPermissionV2: Component<{ directory: () => string | undefined }> = (props) => {
  const language = useLanguage()
  const mode = usePermissionMode(props.directory)

  const modeOptions = createMemo<ModeOption[]>(() =>
    PERMISSION_MODES.map((value) => ({ value, label: language.t(`permission.mode.${value}`) })),
  )

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
    </>
  )
}
