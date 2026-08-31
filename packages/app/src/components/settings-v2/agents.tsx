import { useFilteredList } from "@opennovel-ai/ui/hooks"
import { Icon as IconV2 } from "@opennovel-ai/ui/v2/icon"
import { IconButtonV2 } from "@opennovel-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { normalizeAgentList } from "@/context/global-sync/utils"
import { showToast } from "@/utils/toast"
import type { Agent } from "@opennovel-ai/sdk/v2/client"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// “跟随主会话”哨兵选项的稳定 value key；同时用于乐观更新与无变化判断。
const FOLLOW_VALUE = "__follow__"

type ModelOption = {
  value: string
  providerID: string
  modelID: string
  name: string
  providerName: string
  follow: boolean
}

const modelKey = (providerID: string, modelID: string) => `${providerID}/${modelID}`

export const SettingsAgentsV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const models = useModels()
  const queryClient = useQueryClient()
  // 乐观选中的 value key（agent name -> option value），让下拉在服务器回环完成前就显示新值。
  const [pending, setPending] = createSignal<Record<string, string>>({})

  const agentsQuery = createQuery(() => ({
    queryKey: ["settings", serverSdk().url, "agents"],
    queryFn: async () => {
      const result = await serverSdk().client.app.agents()
      // 隐藏内置工具型 agent（compaction / summary / title），它们不暴露给用户配置。
      return normalizeAgentList(result.data).filter((agent) => !agent.hidden)
    },
  }))

  const list = useFilteredList<Agent>({
    items: () => agentsQuery.data ?? [],
    key: (x) => x.name,
    filterKeys: ["name", "description"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
  })

  const followOption = (): ModelOption => ({
    value: FOLLOW_VALUE,
    providerID: "",
    modelID: "",
    name: language.t("settings.agents.model.follow"),
    providerName: "",
    follow: true,
  })

  // 选项 = 跟随主会话 + 已连接模型 + 当前已配置（含乐观选中）的模型；
  // 始终包含已配置项，避免实例重建/模型列表重载期间受控值短暂失配而回弹。
  const modelOptions = createMemo<ModelOption[]>(() => {
    const options: ModelOption[] = [followOption()]
    const seen = new Set([FOLLOW_VALUE])
    const push = (value: string, providerID: string, modelID: string, name: string, providerName: string) => {
      if (seen.has(value)) return
      seen.add(value)
      options.push({ value, providerID, modelID, name, providerName, follow: false })
    }
    for (const m of models.list()) push(modelKey(m.provider.id, m.id), m.provider.id, m.id, m.name, m.provider.name)
    for (const agent of agentsQuery.data ?? []) {
      if (agent.model) {
        push(
          modelKey(agent.model.providerID, agent.model.modelID),
          agent.model.providerID,
          agent.model.modelID,
          agent.model.modelID,
          agent.model.providerID,
        )
      }
    }
    return options
  })

  // agent 当前生效的 value key：优先乐观选中值，否则取服务器返回的已配置模型。
  const agentValueKey = (agent: Agent) =>
    pending()[agent.name] ?? (agent.model ? modelKey(agent.model.providerID, agent.model.modelID) : FOLLOW_VALUE)

  const currentOption = (agent: Agent): ModelOption =>
    modelOptions().find((o) => o.value === agentValueKey(agent)) ?? followOption()

  const saveMutation = useMutation(() => ({
    mutationFn: async (input: { name: string; valueKey: string }) => {
      const follow = input.valueKey === FOLLOW_VALUE
      const [providerID, ...rest] = follow ? [] : input.valueKey.split("/")
      const model = follow ? undefined : { providerID: providerID!, modelID: rest.join("/") }
      await serverSync().updateConfig({
        agent: {
          [input.name]: {
            // 空字符串会随 JSON 发送并持久化，agent 服务以 falsy 判断 model，等同删除该覆盖项 → 回退到继承/父会话模型。
            model: model ? modelKey(model.providerID, model.modelID) : "",
          },
        },
      })
      // 全局 config 更新会异步销毁并重建实例；刷新智能体列表确认新值已落盘。
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      await agentsQuery.refetch()
    },
    onSuccess: (_data, variables) => {
      setPending((current) => {
        const next = { ...current }
        delete next[variables.name]
        return next
      })
    },
    onError: (error: unknown, variables) => {
      setPending((current) => {
        const next = { ...current }
        delete next[variables.name]
        return next
      })
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const onSelect = (agent: Agent, option: ModelOption | null) => {
    if (saveMutation.isPending) return
    const nextKey = !option || option.follow ? FOLLOW_VALUE : option.value
    // 无变化忽略：挡住刷新/重渲染过程中对已选中项的重复回调。
    if (nextKey === agentValueKey(agent)) return
    // 乐观更新显示值，避免等待服务器回环期间下拉回弹到“跟随主会话”。
    setPending((current) => ({ ...current, [agent.name]: nextKey }))
    saveMutation.mutate({ name: agent.name, valueKey: nextKey })
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.agents.title")}</h2>
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("settings.agents.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("settings.agents.search.placeholder")}
          />
          <Show when={list.filter()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="settings-v2-tab-search-clear"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              onClick={() => list.clear()}
            />
          </Show>
        </div>
      </div>

      <div class="settings-v2-tab-body">
        <Show
          when={agentsQuery.data && agentsQuery.data.length > 0}
          fallback={
            <div class="settings-v2-models-status">
              <span>
                {language.t("common.loading")}
                {language.t("common.loading.ellipsis")}
              </span>
            </div>
          }
        >
          <SettingsListV2>
            <For each={list.flat()}>
              {(agent) => (
                <SettingsRowV2
                  title={
                    <div class="flex items-center gap-2">
                      <span>{agent.name}</span>
                      <Show when={agent.mode === "subagent"}>
                        <span class="text-[10px] font-medium text-v2-text-text-muted">
                          {language.t("settings.agents.mode.subagent")}
                        </span>
                      </Show>
                      <Show when={agent.mode === "primary"}>
                        <span class="text-[10px] font-medium text-v2-text-text-muted">
                          {language.t("settings.agents.mode.primary")}
                        </span>
                      </Show>
                    </div>
                  }
                  description={agent.description || language.t("settings.agents.noDescription")}
                >
                  <SelectV2
                    appearance="inline"
                    placement="bottom-end"
                    gutter={6}
                    placeholder={language.t("settings.agents.model.follow")}
                    options={modelOptions()}
                    current={currentOption(agent)}
                    value={(o) => o.value}
                    label={(o) => (o.follow ? o.name : `${o.providerName} / ${o.name}`)}
                    groupBy={(o) => (o.follow ? "" : o.providerName)}
                    disabled={saveMutation.isPending}
                    onSelect={(o) => onSelect(agent, o)}
                  />
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}