import type { ConfigHealthIssue } from "@opennovel-ai/sdk/v2/client"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { Dialog } from "@opennovel-ai/ui/dialog"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { createSignal, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

// 全局配置健康横幅：问题数 > 0 时出现在智能体/提供商页顶部；修复必须先经确认层预览，未确认不发写请求。
export const ConfigHealthBannerV2: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = createSignal(false)

  const issues = createQuery(() => ({
    queryKey: ["settings", serverSdk().url, "config-health"],
    queryFn: async () => {
      const response = await serverSdk().client.global.config.health()
      return response.data ?? []
    },
  }))

  const fixable = (): ConfigHealthIssue[] => (issues.data ?? []).filter((issue) => typeof issue.fixSummary === "string")

  const fixMutation = useMutation(() => ({
    mutationFn: async (ids: string[]) => {
      const response = await serverSdk().client.global.config.health2.fix({ ids })
      return response.data ?? []
    },
    onSuccess: () => {
      dialog.close()
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: (error: unknown) => {
      dialog.close()
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const openFixDialog = () => {
    const targets = fixable()
    void dialog.show(() => (
      <Dialog title={language.t("settings.configHealth.fix.title")}>
        <div class="settings-v2-health-dialog">
          <p class="settings-v2-health-dialog-warning">{language.t("settings.configHealth.fix.warning")}</p>
          <ul class="settings-v2-health-list">
            <For each={targets}>
              {(issue) => (
                <li class="settings-v2-health-item">
                  <div class="settings-v2-health-item-message">{issue.message}</div>
                  <div class="settings-v2-health-item-loc">{issue.fixSummary}</div>
                </li>
              )}
            </For>
          </ul>
          <div class="settings-v2-health-dialog-actions">
            <ButtonV2 size="normal" variant="ghost-muted" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2 size="normal" variant="neutral" disabled={fixMutation.isPending} onClick={() => fixMutation.mutate(targets.map((issue) => issue.id))}>
              {language.t("settings.configHealth.fix.confirm")}
            </ButtonV2>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <Show when={(issues.data ?? []).length > 0}>
      <div class="settings-v2-health" data-expanded={expanded()}>
        <div class="settings-v2-health-head">
          <div class="settings-v2-health-copy">
            <span class="settings-v2-health-title">
              {language.t("settings.configHealth.title", { count: (issues.data ?? []).length })}
            </span>
            <Show when={!expanded()}>
              <span class="settings-v2-health-summary">{language.t("settings.configHealth.summary")}</span>
            </Show>
          </div>
          <div class="settings-v2-health-actions">
            <Show when={fixable().length > 0}>
              <ButtonV2 size="normal" variant="neutral" disabled={fixMutation.isPending} onClick={openFixDialog}>
                {language.t("settings.configHealth.fix")}
              </ButtonV2>
            </Show>
            <ButtonV2 size="normal" variant="ghost-muted" onClick={() => setExpanded(!expanded())}>
              {language.t(expanded() ? "settings.configHealth.collapse" : "settings.configHealth.expand")}
            </ButtonV2>
          </div>
        </div>
        <Show when={expanded()}>
          <ul class="settings-v2-health-list">
            <For each={issues.data ?? []}>
              {(issue) => (
                <li class="settings-v2-health-item">
                  <div class="settings-v2-health-item-message">{issue.message}</div>
                  <div class="settings-v2-health-item-loc">
                    {issue.file}
                    <Show when={issue.keyPath}> · {issue.keyPath}</Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
