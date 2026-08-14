import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opennovel-ai/sdk/v2/client"
import { Button } from "@opennovel-ai/ui/button"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { Dialog } from "@opennovel-ai/ui/dialog"
import { Icon } from "@opennovel-ai/ui/icon"
import { IconButton } from "@opennovel-ai/ui/icon-button"
import { List, type ListRef } from "@opennovel-ai/ui/list"
import { ProviderIcon } from "@opennovel-ai/ui/provider-icon"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { Tag } from "@opennovel-ai/ui/tag"
import { TextField } from "@opennovel-ai/ui/text-field"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@opennovel-ai/ui/v2/dialog-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { showToast } from "@/utils/toast"
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createResource,
  createUniqueId,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { CustomProviderForm } from "./dialog-custom-provider"

const CUSTOM_ID = "_custom"

export function useProviderConnectController(options: { onBack?: () => void } = {}) {
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const reset = () => setStore("selected", undefined)

  return {
    selected: () => store.selected,
    select: (provider?: string) => setStore("selected", provider),
    back: options.onBack ?? reset,
  }
}

export const DialogConnectProvider: Component<{
  directory?: Accessor<string | undefined>
  controller?: ReturnType<typeof useProviderConnectController>
}> = (props) => {
  const fallback = useProviderConnectController()
  const controller = props.controller ?? fallback
  const language = useLanguage()
  const settings = useSettings()
  const newLayout = settings.general.newLayoutDesigns
  const reset = controller.back
  const back = { current: reset }
  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })
  const select = (provider?: string) => {
    back.current = reset
    controller.select(provider)
  }

  function Content() {
    return (
      <Switch>
        <Match when={controller.selected() === CUSTOM_ID}>
          <CustomProviderForm autofocus={!newLayout()} />
        </Match>
        <Match when={controller.selected() && controller.selected() !== CUSTOM_ID ? controller.selected() : undefined}>
          {(provider) => (
            <ProviderConnection
              provider={provider()}
              directory={props.directory}
              onBack={reset}
              setBack={(handler) => (back.current = handler)}
            />
          )}
        </Match>
        <Match when={true}>
          <ProviderPicker
            directory={props.directory}
            onSelect={select}
            onPrepare={newLayout() ? holdFocus : undefined}
          />
        </Match>
      </Switch>
    )
  }

  return (
    <Show
      when={newLayout()}
      fallback={
        <Dialog
          class="h-full"
          transition
          title={
            <Show when={controller.selected()} fallback={language.t("command.provider.connect")}>
              <IconButton
                tabIndex={-1}
                icon="arrow-left"
                variant="ghost"
                onClick={() => back.current()}
                aria-label={language.t("common.goBack")}
              />
            </Show>
          }
        >
          <Content />
        </Dialog>
      }
    >
      <DialogV2
        containerClass="!h-[min(calc(100vh_-_16px),512px)] !w-[min(calc(100vw_-_16px),640px)]"
        class="[font-family:var(--v2-font-family-sans)] [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]"
      >
        <DialogHeader closeLabel={language.t("common.close")}>
          <Show
            when={controller.selected()}
            fallback={<DialogTitle>{language.t("command.provider.connect")}</DialogTitle>}
          >
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              onClick={() => back.current()}
              aria-label={language.t("common.goBack")}
            >
              <Icon name="arrow-left" size="small" />
            </button>
          </Show>
        </DialogHeader>
        <DialogBody class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
            <Content />
          </div>
        </DialogBody>
      </DialogV2>
    </Show>
  )
}

function ProviderPicker(props: {
  directory?: Accessor<string | undefined>
  onSelect: (provider: string) => void
  onPrepare?: () => void
}) {
  const settings = useSettings()
  if (settings.general.newLayoutDesigns())
    return <ProviderPickerV2 directory={props.directory} onSelect={props.onSelect} onPrepare={props.onPrepare} />
  const providers = useProviders(props.directory)
  const language = useLanguage()
  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "opennovel-go") return language.t("dialog.provider.opennovelGo.tagline")
    return undefined
  }

  return (
    <List
      class="px-3"
      search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
      emptyMessage={language.t("dialog.provider.empty")}
      activeIcon="plus-small"
      key={(x) => x?.id}
      items={() => {
        language.locale()
        return [{ id: CUSTOM_ID, name: customLabel() }, ...providers.all().values()]
      }}
      filterKeys={["id", "name"]}
      groupBy={(x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
      sortBy={(a, b) => {
        if (a.id === CUSTOM_ID) return -1
        if (b.id === CUSTOM_ID) return 1
        if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
          return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
        return a.name.localeCompare(b.name)
      }}
      sortGroupsBy={(a, b) => {
        const popular = popularGroup()
        if (a.category === popular && b.category !== popular) return -1
        if (b.category === popular && a.category !== popular) return 1
        return 0
      }}
      onSelect={(x) => {
        if (!x) return
        props.onSelect(x.id)
      }}
    >
      {(i) => (
        <div class="px-1.25 w-full flex items-center gap-x-3">
          <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
          <span>{i.name}</span>
          <Show when={i.id === "opennovel"}>
            <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opennovel.tagline")}</div>
          </Show>
          <Show when={i.id === CUSTOM_ID}>
            <Tag>{language.t("settings.providers.tag.custom")}</Tag>
          </Show>
          <Show when={i.id === "opennovel"}>
            <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
          </Show>
          <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
          <Show when={i.id === "opennovel-go"}>
            <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

function ProviderPickerV2(props: {
  directory?: Accessor<string | undefined>
  onSelect: (provider: string) => void
  onPrepare?: () => void
}) {
  const providers = useProviders(props.directory)
  const language = useLanguage()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const [store, setStore] = createStore({
    filter: "",
    active: undefined as string | undefined,
    connecting: undefined as string | undefined,
  })
  const featured = ["opennovel", "opennovel-go", "anthropic", "openai", "google", "openrouter", "vercel"]
  const custom = () => ({ id: CUSTOM_ID, name: language.t("dialog.provider.custom.label") })
  const all = createMemo(() => {
    language.locale()
    const query = store.filter.trim().toLowerCase()
    const values = [custom(), ...providers.all().values()]
    if (!query) return values
    return values.filter((provider) => `${provider.id} ${provider.name}`.toLowerCase().includes(query))
  })
  const popular = createMemo(() =>
    all()
      .filter((provider) => featured.includes(provider.id))
      .sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id)),
  )
  const other = createMemo(() =>
    all()
      .filter((provider) => !featured.includes(provider.id))
      .sort((a, b) => {
        if (a.id === CUSTOM_ID) return -1
        if (b.id === CUSTOM_ID) return 1
        return a.name.localeCompare(b.name)
      }),
  )
  const rows = createMemo(() => [...popular(), ...other()])
  let picker: HTMLDivElement | undefined
  let search: HTMLInputElement | undefined

  onMount(() => search?.focus({ preventScroll: true }))

  const connect = (provider: string) => {
    props.onPrepare?.()
    if (provider === CUSTOM_ID || serverSync().data.provider_auth[provider]) {
      props.onSelect(provider)
      return
    }
    if (store.connecting) return
    setStore("connecting", provider)
    void serverSDK()
      .client.provider.auth()
      .then((response) => {
        serverSync().set("provider_auth", response.data ?? {})
        props.onSelect(provider)
      })
      .catch(() => props.onSelect(provider))
  }

  const move = (event: KeyboardEvent, direction: number) => {
    const items = rows()
    if (items.length === 0) return
    const index = items.findIndex((provider) => provider.id === store.active)
    const next = index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
    setStore("active", items[next].id)
    picker
      ?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(items[next].id)}"]`)
      ?.focus({ preventScroll: true })
    event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") return move(event, 1)
    if (event.key === "ArrowUp") return move(event, -1)
    if (event.key !== "Enter" || !store.active) return
    connect(store.active)
    event.preventDefault()
  }

  return (
    <div ref={picker} class="flex min-h-0 flex-1 flex-col gap-4" onKeyDown={handleKeyDown}>
      <div class="shrink-0 px-1 pt-px">
        <TextInputV2
          ref={search}
          type="search"
          class="!w-full [font-family:var(--v2-font-family-sans)]"
          leadingIcon={<Icon name="magnifying-glass" size="small" />}
          placeholder={language.t("dialog.provider.search.placeholder")}
          value={store.filter}
          onInput={(event) => {
            setStore({ filter: event.currentTarget.value, active: undefined })
          }}
        />
      </div>
      <div class="relative min-h-0 flex-1">
        <div class="flex size-full min-h-0 flex-col gap-4 overflow-y-auto pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For
            each={[
              { title: language.t("dialog.provider.group.popular"), items: popular },
              { title: language.t("dialog.provider.group.other"), items: other },
            ]}
          >
            {(group) => (
              <Show when={group.items().length > 0}>
                <section class="flex flex-col">
                  <div class="px-3 pb-2 text-[13px] font-[440] leading-none tracking-[-0.04px] text-v2-text-text-muted">
                    {group.title}
                  </div>
                  <For each={group.items()}>
                    {(provider) => (
                      <button
                        type="button"
                        data-provider-id={provider.id}
                        class="flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-[13px] leading-none tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-overlay-simple-overlay-hover focus:outline-none"
                        classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === provider.id }}
                        onMouseEnter={() => setStore("active", provider.id)}
                        disabled={store.connecting !== undefined}
                        aria-busy={store.connecting === provider.id}
                        onClick={() => connect(provider.id)}
                      >
                        <ProviderIcon id={provider.id} class="size-4 shrink-0 text-v2-icon-icon-base" />
                        <span class="min-w-0 truncate font-[530] text-v2-text-text-base">{provider.name}</span>
                        <Show when={provider.id === "opennovel" || provider.id === "opennovel-go"}>
                          <span class="min-w-0 truncate font-[440] text-v2-text-text-muted">
                            {language.t(
                              provider.id === "opennovel"
                                ? "dialog.provider.opennovel.tagline"
                                : "dialog.provider.opennovelGo.tagline",
                            )}
                          </span>
                          <span class="flex h-4 shrink-0 items-center rounded-xs border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-03 px-1 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-muted">
                            {language.t("dialog.provider.tag.recommended")}
                          </span>
                        </Show>
                        <Show when={provider.id === CUSTOM_ID}>
                          <span class="flex h-4 shrink-0 items-center rounded-xs border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-03 px-1 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-muted">
                            {language.t("settings.providers.tag.custom")}
                          </span>
                        </Show>
                        <Show when={store.connecting === provider.id}>
                          <Spinner class="ml-auto size-4 shrink-0 text-v2-icon-icon-muted" />
                        </Show>
                      </button>
                    )}
                  </For>
                </section>
              </Show>
            )}
          </For>
          <Show when={rows().length === 0}>
            <div class="flex h-24 items-center justify-center text-[13px] font-[440] text-v2-text-text-muted">
              {language.t("dialog.provider.empty")}
            </div>
          </Show>
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: "linear-gradient(to bottom, transparent, var(--v2-background-bg-layer-01))" }}
        />
      </div>
    </div>
  )
}

function ProviderConnection(props: {
  provider: string
  directory?: Accessor<string | undefined>
  onBack: () => void
  setBack: (handler: () => void) => void
}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const settings = useSettings()
  const newLayout = settings.general.newLayoutDesigns
  const providers = useProviders(props.directory)

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    alive.value = false
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const provider = createMemo(
    () => providers.all().get(props.provider) ?? serverSync().data.provider.all.get(props.provider)!,
  )
  const fallback = createMemo<ProviderAuthMethod[]>(() => [
    {
      type: "api" as const,
      label: language.t("provider.connect.method.apiKey"),
    },
  ])
  const [auth] = createResource(
    () => props.provider,
    async () => {
      const cached = serverSync().data.provider_auth[props.provider]
      if (cached) return cached
      const res = await serverSDK().client.provider.auth()
      if (!alive.value) return fallback()
      serverSync().set("provider_auth", res.data ?? {})
      return res.data?.[props.provider] ?? fallback()
    },
  )
  const loading = createMemo(() => auth.loading && !serverSync().data.provider_auth[props.provider])
  const methods = createMemo(() => auth.latest ?? serverSync().data.provider_auth[props.provider] ?? fallback())
  const cachedMethods = serverSync().data.provider_auth[props.provider]
  const directMethod =
    cachedMethods?.length === 1 && cachedMethods[0].type === "api" && !cachedMethods[0].prompts?.length ? 0 : undefined
  const [store, setStore] = createStore({
    methodIndex: directMethod as undefined | number,
    authorization: undefined as undefined | ProviderAuthAuthorization,
    promptInputs: undefined as undefined | Record<string, string>,
    state: (directMethod === undefined ? "pending" : undefined) as
      | undefined
      | "pending"
      | "complete"
      | "error"
      | "prompt",
    error: undefined as string | undefined,
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.prompt" }
    | { type: "auth.inputs"; inputs: Record<string, string> }
    | { type: "auth.pending" }
    | { type: "auth.complete"; authorization: ProviderAuthAuthorization }
    | { type: "auth.error"; error: string }

  function dispatch(action: Action) {
    setStore(
      produce((draft) => {
        if (action.type === "method.select") {
          draft.methodIndex = action.index
          draft.authorization = undefined
          draft.promptInputs = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.reset") {
          draft.methodIndex = undefined
          draft.authorization = undefined
          draft.promptInputs = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "auth.prompt") {
          draft.state = "prompt"
          draft.error = undefined
          return
        }
        if (action.type === "auth.inputs") {
          draft.promptInputs = action.inputs
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined
          return
        }
        if (action.type === "auth.complete") {
          draft.state = "complete"
          draft.authorization = action.authorization
          draft.error = undefined
          return
        }
        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const method = createMemo(() => (store.methodIndex !== undefined ? methods().at(store.methodIndex!) : undefined))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  const methodDetails = (value?: { type?: string; label?: string }) => {
    const label = methodLabel(value)
    const suffix = value?.label?.match(/\s+\((browser|headless)\)$/i)
    const hint = suffix?.[1]
    return {
      label: suffix ? label.slice(0, -suffix[0].length) : label,
      hint: hint ? hint[0].toUpperCase() + hint.slice(1) : value?.type === "api" ? "Browser" : undefined,
    }
  }

  function formatError(value: unknown, fallback: string): string {
    if (value && typeof value === "object" && "data" in value) {
      const data = (value as { data?: { message?: unknown } }).data
      if (typeof data?.message === "string" && data.message) return data.message
    }
    if (value && typeof value === "object" && "error" in value) {
      const nested = formatError((value as { error?: unknown }).error, "")
      if (nested) return nested
    }
    if (value && typeof value === "object" && "message" in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === "string" && message) return message
    }
    if (value instanceof Error && value.message) return value.message
    if (typeof value === "string" && value) return value
    return fallback
  }

  async function selectMethod(index: number, inputs?: Record<string, string>) {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    const method = methods()[index]
    dispatch({ type: "method.select", index })

    if (method.type === "api" && method.prompts?.length) {
      if (!inputs) {
        dispatch({ type: "auth.prompt" })
        return
      }
      dispatch({ type: "auth.inputs", inputs })
      return
    }

    if (method.type === "oauth") {
      if (method.prompts?.length && !inputs) {
        dispatch({ type: "auth.prompt" })
        return
      }
      dispatch({ type: "auth.pending" })
      const start = Date.now()
      await serverSDK()
        .client.provider.oauth.authorize(
          {
            providerID: props.provider,
            method: index,
            inputs,
          },
          { throwOnError: true },
        )
        .then((x) => {
          if (!alive.value) return
          const elapsed = Date.now() - start
          const delay = 1000 - elapsed

          if (delay > 0) {
            if (timer.current !== undefined) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              timer.current = undefined
              if (!alive.value) return
              dispatch({ type: "auth.complete", authorization: x.data! })
            }, delay)
            return
          }
          dispatch({ type: "auth.complete", authorization: x.data! })
        })
        .catch((e) => {
          if (!alive.value) return
          dispatch({ type: "auth.error", error: formatError(e, language.t("common.requestFailed")) })
        })
    }
  }

  function AuthPromptsView() {
    const [formStore, setFormStore] = createStore({
      value: {} as Record<string, string>,
      index: 0,
    })

    const prompts = createMemo<NonNullable<ProviderAuthMethod["prompts"]>>(() => {
      const value = method()
      return value?.prompts ?? []
    })
    const matches = (prompt: NonNullable<ReturnType<typeof prompts>[number]>, value: Record<string, string>) => {
      if (!prompt.when) return true
      const actual = value[prompt.when.key]
      if (actual === undefined) return false
      return prompt.when.op === "eq" ? actual === prompt.when.value : actual !== prompt.when.value
    }
    const current = createMemo(() => {
      const all = prompts()
      const index = all.findIndex((prompt, index) => index >= formStore.index && matches(prompt, formStore.value))
      if (index === -1) return
      return {
        index,
        prompt: all[index],
      }
    })
    const valid = createMemo(() => {
      const item = current()
      if (!item || item.prompt.type !== "text") return false
      const value = formStore.value[item.prompt.key] ?? ""
      return value.trim().length > 0
    })

    async function next(index: number, value: Record<string, string>) {
      if (store.methodIndex === undefined) return
      const next = prompts().findIndex((prompt, i) => i > index && matches(prompt, value))
      if (next !== -1) {
        setFormStore("index", next)
        return
      }
      if (method()?.type === "api") {
        dispatch({ type: "auth.inputs", inputs: value })
        return
      }
      await selectMethod(store.methodIndex, value)
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()
      const item = current()
      if (!item || item.prompt.type !== "text") return
      if (!valid()) return
      await next(item.index, formStore.value)
    }

    const item = () => current()
    const text = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "text") return
      return prompt
    })
    const select = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "select") return
      return prompt
    })

    return (
      <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
        <Switch>
          <Match when={item()?.prompt.type === "text"}>
            <TextField
              type="text"
              label={text()?.message ?? ""}
              placeholder={text()?.placeholder}
              value={text() ? (formStore.value[text()!.key] ?? "") : ""}
              onChange={(value) => {
                const prompt = text()
                if (!prompt) return
                setFormStore("value", prompt.key, value)
              }}
            />
            <Button class="w-auto" type="submit" size="large" variant="primary" disabled={!valid()}>
              {language.t("common.continue")}
            </Button>
          </Match>
          <Match when={item()?.prompt.type === "select"}>
            <div class="w-full flex flex-col gap-1.5">
              <div class="text-14-regular text-text-base">{select()?.message}</div>
              <div>
                <List
                  class="px-3"
                  items={select()?.options ?? []}
                  key={(x) => x.value}
                  current={select()?.options.find((x) => x.value === formStore.value[select()!.key])}
                  onSelect={(value) => {
                    if (!value) return
                    const prompt = select()
                    if (!prompt) return
                    const nextValue = {
                      ...formStore.value,
                      [prompt.key]: value.value,
                    }
                    setFormStore("value", prompt.key, value.value)
                    void next(item()!.index, nextValue)
                  }}
                >
                  {(option) => (
                    <div class="w-full flex items-center gap-x-2">
                      <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                        <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                      </div>
                      <span>{option.label}</span>
                      <span class="text-14-regular text-text-weak">{option.hint}</span>
                    </div>
                  )}
                </List>
              </div>
            </div>
          </Match>
        </Switch>
      </form>
    )
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  let auto = false
  createEffect(() => {
    if (auto) return
    if (loading()) return
    if (methods().length === 1) {
      auto = true
      void selectMethod(0)
    }
  })

  async function complete() {
    await serverSDK().client.global.dispose()
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })
  }

  function goBack() {
    if (methods().length > 1 && store.methodIndex !== undefined) {
      dispatch({ type: "method.reset" })
      return
    }
    props.onBack()
  }

  props.setBack(goBack)

  function MethodSelection() {
    if (newLayout())
      return (
        <div class="flex flex-col gap-2">
          <div class="px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
            {language.t("provider.connect.selectMethod", { provider: provider().name })}
          </div>
          <div class="flex flex-col">
            <For each={methods()}>
              {(item, index) => {
                const details = () => methodDetails(item)
                return (
                  <button
                    type="button"
                    class="group flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                    onClick={() => void selectMethod(index())}
                  >
                    <span class="flex h-2 w-4 shrink-0 items-center justify-center rounded-[1px] bg-v2-background-bg-base shadow-[var(--v2-elevation-button-neutral)]">
                      <span class="hidden h-0.5 w-2.5 bg-v2-icon-icon-base group-hover:block group-focus-visible:block" />
                    </span>
                    <span class="font-[530] text-v2-text-text-base">{details().label}</span>
                    <Show when={details().hint}>
                      {(hint) => <span class="font-[440] text-v2-text-text-muted">{hint()}</span>}
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      )

    return (
      <>
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div>
          <List
            class="px-3"
            ref={(ref) => {
              listRef = ref
            }}
            items={methods}
            key={(m) => m?.label}
            onSelect={async (selected, index) => {
              if (!selected) return
              void selectMethod(index)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2">
                <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                  <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                </div>
                <span>{methodLabel(i)}</span>
              </div>
            )}
          </List>
        </div>
      </>
    )
  }

  function ApiAuthView() {
    let apiKey: HTMLInputElement | undefined
    const errorID = createUniqueId()
    const [formStore, setFormStore] = createStore({
      value: "",
      baseURL: "",
      modelName: "",
      modelOptions: [] as string[],
      // fetch 状态机四态由三字段组合：
      //   idle:    fetchedCount=undefined, fetchError=undefined, fetchingModels=false
      //   fetching: fetchingModels=true
      //   fetched:  fetchedCount=N, fetchError=undefined, fetchingModels=false
      //   failed:   fetchError=string, fetchedCount=undefined, fetchingModels=false
      fetchedCount: undefined as number | undefined,
      fetchError: undefined as string | undefined,
      fetchingModels: false,
      error: undefined as string | undefined,
      baseURLError: undefined as string | undefined,
      modelError: undefined as string | undefined,
    })
    // 本地服务（Ollama、LM Studio 等用户自托管的 openai-compatible）通常不需要 API key，
    // apiKey 留空也允许提交；描述与 placeholder 切换为「无需 key」文案避免误导。
    const isOptionalApiKey = () => {
      const id = provider().id
      return id === "ollama" || id === "lmstudio"
    }

    // 从 serverSync 拿该 provider 的已持久化配置（如果之前连过），做表单预填
    onMount(() => {
      if (newLayout()) apiKey?.focus({ preventScroll: true })
      const cfg = serverSync().data.config.provider?.[props.provider]
      if (cfg && newLayout()) {
        const persistedBaseURL = (cfg.options as { baseURL?: string } | undefined)?.baseURL
        const persistedModel = cfg.models
          ? Object.keys(cfg.models).find((id) => id !== "custom")
          : undefined
        if (persistedBaseURL && !formStore.baseURL) setFormStore("baseURL", persistedBaseURL)
        if (persistedModel && !formStore.modelName) setFormStore("modelName", persistedModel)
      }
      // 拉一次本地模型列表（Ollama 等本地服务的核心体验）
      // 两套 layout 都触发 —— 旧 layout 之前完全跳过 onMount，导致用户看不到任何反馈
      if (isOptionalApiKey()) void refreshLocalModels(false)
    })

    /**
     * 调 `${baseURL origin}/api/tags` 拉取本地已下载模型列表，填到 formStore.modelOptions。
     * 失败：toast 提示 + formStore.fetchError 写入（供状态行渲染），但仍允许用户手填。
     * showToastOnError: 失败时弹 toast（默认 true）；onMount 静默调用时传 false。
     */
    async function refreshLocalModels(showToastOnError = true) {
      const baseURL = formStore.baseURL.trim()
      if (!baseURL) return
      const origin = baseURL.replace(/\/v1\/?$/, "")
      const url = `${origin}/api/tags`
      setFormStore("fetchingModels", true)
      // 进入 fetching 时清掉旧状态
      setFormStore("fetchedCount", undefined)
      setFormStore("fetchError", undefined)
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { models?: Array<{ name: string }> }
        const names = (body.models ?? []).map((m) => m.name).filter(Boolean)
        setFormStore("modelOptions", names)
        setFormStore("fetchedCount", names.length)
        if (!formStore.modelName && names.length > 0) {
          setFormStore("modelName", names[0]!)
        }
      } catch {
        setFormStore(
          "fetchError",
          language.t("provider.connect.field.fetchStatus.failed"),
        )
        if (showToastOnError) {
          showToast({
            variant: "error",
            icon: "warning",
            title: language.t("provider.connect.toast.fetchModelsFailed.title"),
            description: language.t("provider.connect.toast.fetchModelsFailed.description"),
          })
        }
      } finally {
        setFormStore("fetchingModels", false)
      }
    }

    /**
     * 「导入全部已下载模型」按钮回调。
     * 把 fetch 拉到的所有 modelOptions + 当前 modelName 一起写进 config，弹 toast 提示 N 个已导入。
     * 不调 dialog.close / complete —— 让用户继续操作或自己点提交关闭。
     */
    async function importAllLocalModels() {
      const baseURL = formStore.baseURL.trim()
      const modelName = formStore.modelName.trim() || formStore.modelOptions[0] || ""
      if (!baseURL || !modelName) return
      await persistLocalProviderConfig(baseURL, modelName, formStore.modelOptions)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.importAllSuccess.title", {
          count: formStore.modelOptions.length,
        }),
        description: language.t("provider.connect.toast.importAllSuccess.description", {
          provider: provider().name,
        }),
      })
    }

    function validateLocalFields(): boolean {
      const baseURL = formStore.baseURL.trim()
      const modelName = formStore.modelName.trim()
      let ok = true
      if (!baseURL) {
        setFormStore("baseURLError", language.t("provider.connect.error.baseURL.required"))
        ok = false
      } else if (!/^https?:\/\//.test(baseURL)) {
        setFormStore("baseURLError", language.t("provider.connect.error.baseURL.format"))
        ok = false
      } else {
        setFormStore("baseURLError", undefined)
      }
      if (!modelName) {
        setFormStore("modelError", language.t("provider.connect.error.modelName.required"))
        ok = false
      } else {
        setFormStore("modelError", undefined)
      }
      return ok
    }

    /**
     * 把 baseURL + modelName 持久化进 opennovel.json，server 端 Provider.list() 流程会自动 merge。
     * 不依赖 server 端 OllamaModels service 也能用 —— 这是「用户感知」路径。
     *
     * @param additionalModels 「导入全部」时传入 fetch 拉到的所有 model names；
     *   会作为 spread 写进 models dict。userModelName 放在最后，保证用户自填的名字不被覆盖。
     */
    async function persistLocalProviderConfig(baseURL: string, modelName: string, additionalModels: string[] = []) {
      const next = structuredClone(serverSync().data.config)
      const existing = next.provider?.[props.provider]
      const fetchedModels = Object.fromEntries(
        additionalModels.filter((n) => n && n !== modelName).map((n) => [n, { name: n }]),
      )
      next.provider = {
        ...next.provider,
        [props.provider]: {
          ...(existing ?? {}),
          npm: "@ai-sdk/openai-compatible",
          name: existing?.name ?? provider().name,
          options: { ...(existing?.options ?? {}), baseURL },
          models: {
            ...(existing?.models ?? {}),
            ...fetchedModels,
            // userModelName 最后写，保证用户在 ApiAuthView 自填的名字不丢
            [modelName]: { name: modelName },
          },
        },
      }
      await serverSync().updateConfig(next)
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const apiKey = formData.get("apiKey") as string

      if (!isOptionalApiKey() && !apiKey?.trim()) {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      if (isOptionalApiKey() && !validateLocalFields()) return

      setFormStore("error", undefined)
      await serverSDK().client.auth.set({
        providerID: props.provider,
        auth: {
          type: "api",
          // 本地服务（Ollama / LM Studio 等）无需 key：传空串满足 SDK required，
          // 运行时 Auth.bearer 退化为空 bearer，对未鉴权的本地服务无副作用。
          key: apiKey?.trim() ?? "",
          ...(store.promptInputs ? { metadata: store.promptInputs } : {}),
        },
      })
      // 本地 provider：把 baseURL + modelName 写入 config.json，下次启动仍可用
      if (isOptionalApiKey()) {
        await persistLocalProviderConfig(formStore.baseURL.trim(), formStore.modelName.trim())
      }
      await complete()
    }

    if (newLayout())
      return (
        <div class="flex flex-col gap-5 px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          <Show
            when={provider().id === "opennovel"}
            fallback={
              isOptionalApiKey()
                ? language.t("provider.connect.apiKey.optionalDescription", { provider: provider().name })
                : language.t("provider.connect.apiKey.description", { provider: provider().name })
            }
          >
            <div class="flex flex-col gap-5">
              <div>{language.t("provider.connect.opennovelZen.line1")}</div>
              <div>{language.t("provider.connect.opennovelZen.line2")}</div>
              <div>
                {language.t("provider.connect.opennovelZen.visit.prefix")}
                <Link
                  href="https://opennovel.ai/zen"
                  class="text-v2-text-text-base focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                >
                  {language.t("provider.connect.opennovelZen.visit.link")}
                </Link>
                {language.t("provider.connect.opennovelZen.visit.suffix")}
              </div>
            </div>
          </Show>
          <form onSubmit={handleSubmit} class="flex flex-col items-start gap-5 self-stretch">
            <label class="flex w-full flex-col gap-1 font-[530] leading-4 text-v2-text-text-base">
              {language.t("provider.connect.apiKey.label", { provider: provider().name })}
              <TextInputV2
                ref={apiKey}
                class="!w-full"
                name="apiKey"
                placeholder={
                  isOptionalApiKey()
                    ? language.t("provider.connect.apiKey.optionalPlaceholder")
                    : language.t("provider.connect.apiKey.placeholder")
                }
                value={formStore.value}
                invalid={formStore.error !== undefined}
                aria-describedby={formStore.error ? errorID : undefined}
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setFormStore("value", event.currentTarget.value)}
              />
            </label>
            <Show when={isOptionalApiKey()}>
              <label class="flex w-full flex-col gap-1 font-[530] leading-4 text-v2-text-text-base">
                {language.t("provider.connect.field.baseURL.label")}
                <TextInputV2
                  class="!w-full"
                  name="baseURL"
                  placeholder={language.t("provider.connect.field.baseURL.placeholder")}
                  value={formStore.baseURL}
                  invalid={formStore.baseURLError !== undefined}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => setFormStore("baseURL", event.currentTarget.value)}
                />
                <span class="font-[440] text-[12px] leading-4 text-v2-text-text-weaker">
                  {language.t("provider.connect.field.baseURL.description")}
                </span>
                <Show when={formStore.baseURLError}>
                  {(err) => (
                    <div role="alert" class="text-xs text-v2-state-fg-danger">
                      {err()}
                    </div>
                  )}
                </Show>
              </label>
              <label class="flex w-full flex-col gap-1 font-[530] leading-4 text-v2-text-text-base">
                {language.t("provider.connect.field.modelName.label")}
                <div class="flex w-full items-center gap-2">
                  <TextInputV2
                    class="!w-full"
                    name="modelName"
                    placeholder={language.t("provider.connect.field.modelName.placeholder")}
                    value={formStore.modelName}
                    invalid={formStore.modelError !== undefined}
                    list={formStore.modelOptions.length > 0 ? "ollama-models-list" : undefined}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setFormStore("modelName", event.currentTarget.value)}
                  />
                  <ButtonV2
                    type="button"
                    variant="outline"
                    class="shrink-0"
                    disabled={formStore.fetchingModels}
                    aria-label={language.t("provider.connect.field.refreshModels")}
                    onClick={() => void refreshLocalModels(true)}
                  >
                    <Show when={formStore.fetchingModels} fallback={language.t("provider.connect.field.refreshModels")}>
                      <Spinner class="size-3" />
                    </Show>
                  </ButtonV2>
                </div>
                <datalist id="ollama-models-list">
                  <For each={formStore.modelOptions}>{(name) => <option value={name} />}</For>
                </datalist>
                {/* fetch 状态行 + 「导入全部」按钮 —— 让用户清楚知道自动获取发生了什么 */}
                <Show when={formStore.fetchingModels}>
                  <div class="flex items-center gap-2 text-[12px] leading-4 text-v2-text-text-weaker">
                    <Spinner class="size-3 text-v2-icon-icon-muted" />
                    <span>{language.t("provider.connect.field.fetchStatus.fetching")}</span>
                  </div>
                </Show>
                <Show
                  when={
                    !formStore.fetchingModels &&
                    formStore.fetchedCount !== undefined &&
                    formStore.fetchError === undefined
                  }
                >
                  <div class="flex flex-wrap items-center gap-2 text-[12px] leading-4">
                    <div class="flex items-center gap-1.5 text-v2-state-fg-success">
                      <Icon name="circle-check" class="size-3" />
                      <span>
                        {language.t("provider.connect.field.fetchStatus.fetched", {
                          count: formStore.fetchedCount!,
                        })}
                      </span>
                    </div>
                    <Show when={formStore.modelOptions.length > 0}>
                      <ButtonV2
                        type="button"
                        variant="ghost"
                        onClick={() => void importAllLocalModels()}
                      >
                        {language.t("provider.connect.field.importAll")} ({formStore.modelOptions.length})
                      </ButtonV2>
                    </Show>
                  </div>
                </Show>
                <Show when={!formStore.fetchingModels && formStore.fetchError !== undefined}>
                  <div class="flex items-center gap-1.5 text-[12px] leading-4 text-v2-state-fg-danger">
                    <Icon name="circle-x" class="size-3" />
                    <span>{formStore.fetchError}</span>
                  </div>
                </Show>
                <span class="font-[440] text-[12px] leading-4 text-v2-text-text-weaker">
                  {language.t("provider.connect.field.modelName.description")}
                </span>
                <Show when={formStore.modelError}>
                  {(err) => (
                    <div role="alert" class="text-xs text-v2-state-fg-danger">
                      {err()}
                    </div>
                  )}
                </Show>
              </label>
            </Show>
            <Show when={formStore.error}>
              {(error) => (
                <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                  {error()}
                </div>
              )}
            </Show>
            <ButtonV2 type="submit" variant="contrast">
              {language.t("common.continue")}
            </ButtonV2>
          </form>
        </div>
      )

    return (
      <div class="flex flex-col gap-6">
        <Switch>
          <Match when={provider().id === "opennovel"}>
            <div class="flex flex-col gap-4">
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opennovelZen.line1")}</div>
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opennovelZen.line2")}</div>
              <div class="text-14-regular text-text-base">
                {language.t("provider.connect.opennovelZen.visit.prefix")}
                <Link href="https://opennovel.ai/zen" tabIndex={-1}>
                  {language.t("provider.connect.opennovelZen.visit.link")}
                </Link>
                {language.t("provider.connect.opennovelZen.visit.suffix")}
              </div>
            </div>
          </Match>
          <Match when={true}>
            <div class="text-14-regular text-text-base">
              {isOptionalApiKey()
                ? language.t("provider.connect.apiKey.optionalDescription", { provider: provider().name })
                : language.t("provider.connect.apiKey.description", { provider: provider().name })}
            </div>
          </Match>
        </Switch>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus={!newLayout()}
            ref={apiKey}
            type="text"
            label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
            placeholder={
              isOptionalApiKey()
                ? language.t("provider.connect.apiKey.optionalPlaceholder")
                : language.t("provider.connect.apiKey.placeholder")
            }
            name="apiKey"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Show when={isOptionalApiKey()}>
            <TextField
              label={language.t("provider.connect.field.baseURL.label")}
              placeholder={language.t("provider.connect.field.baseURL.placeholder")}
              description={language.t("provider.connect.field.baseURL.description")}
              name="baseURL"
              value={formStore.baseURL}
              onChange={(v) => setFormStore("baseURL", v)}
              validationState={formStore.baseURLError ? "invalid" : undefined}
              error={formStore.baseURLError}
            />
            <div class="flex w-full flex-col gap-1">
              <div class="flex items-end gap-2">
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.connect.field.modelName.label")}
                    placeholder={language.t("provider.connect.field.modelName.placeholder")}
                    description={language.t("provider.connect.field.modelName.description")}
                    name="modelName"
                    value={formStore.modelName}
                    onChange={(v) => setFormStore("modelName", v)}
                    validationState={formStore.modelError ? "invalid" : undefined}
                    error={formStore.modelError}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="large"
                  disabled={formStore.fetchingModels}
                  onClick={() => void refreshLocalModels(true)}
                >
                  {formStore.fetchingModels ? <Spinner class="size-3" /> : language.t("provider.connect.field.refreshModels")}
                </Button>
              </div>
              {/* fetch 状态行 + 「导入全部」按钮 —— 旧 layout 也补上自动获取反馈 */}
              <Show when={formStore.fetchingModels}>
                <div class="flex items-center gap-2 text-12-regular text-text-weaker">
                  <Spinner class="size-3" />
                  <span>{language.t("provider.connect.field.fetchStatus.fetching")}</span>
                </div>
              </Show>
              <Show
                when={
                  !formStore.fetchingModels &&
                  formStore.fetchedCount !== undefined &&
                  formStore.fetchError === undefined
                }
              >
                <div class="flex flex-wrap items-center gap-2 text-12-regular">
                  <div class="flex items-center gap-1.5 text-state-fg-success">
                    <Icon name="circle-check" class="size-3" />
                    <span>
                      {language.t("provider.connect.field.fetchStatus.fetched", {
                        count: formStore.fetchedCount!,
                      })}
                    </span>
                  </div>
                  <Show when={formStore.modelOptions.length > 0}>
                    <button
                      type="button"
                      class="rounded-md border border-border-base px-2 py-0.5 text-12-regular text-text-base hover:bg-surface-base"
                      onClick={() => void importAllLocalModels()}
                    >
                      {language.t("provider.connect.field.importAll")} ({formStore.modelOptions.length})
                    </button>
                  </Show>
                </div>
              </Show>
              <Show when={!formStore.fetchingModels && formStore.fetchError !== undefined}>
                <div class="flex items-center gap-1.5 text-12-regular text-state-fg-danger">
                  <Icon name="circle-x" class="size-3" />
                  <span>{formStore.fetchError}</span>
                </div>
              </Show>
              <Show when={formStore.modelOptions.length > 0}>
                <div class="flex flex-wrap gap-1.5 pt-1">
                  <For each={formStore.modelOptions}>
                    {(name) => (
                      <button
                        type="button"
                        class="rounded-md border border-border-base px-2 py-0.5 text-12-regular text-text-base hover:bg-surface-base"
                        onClick={() => setFormStore("modelName", name)}
                      >
                        {name}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    let codeInput: HTMLInputElement | undefined
    const errorID = createUniqueId()
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    onMount(() => {
      if (!newLayout()) return
      codeInput?.focus({ preventScroll: true })
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const code = formData.get("code") as string

      if (!code?.trim()) {
        setFormStore("error", language.t("provider.connect.oauth.code.required"))
        return
      }

      setFormStore("error", undefined)
      const result = await serverSDK()
        .client.provider.oauth.callback({
          providerID: props.provider,
          method: store.methodIndex,
          code,
        })
        .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))
      if (result.ok) {
        await complete()
        return
      }
      setFormStore("error", formatError(result.error, language.t("provider.connect.oauth.code.invalid")))
    }

    if (newLayout())
      return (
        <div class="flex flex-col gap-5 px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          <div>
            {language.t("provider.connect.oauth.code.visit.prefix")}
            <Link href={store.authorization!.url} class="text-v2-text-text-base">
              {language.t("provider.connect.oauth.code.visit.link")}
            </Link>
            {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
          </div>
          <form onSubmit={handleSubmit} class="flex flex-col items-start gap-5 self-stretch">
            <label class="flex w-full flex-col gap-1 font-[530] leading-4 text-v2-text-text-base">
              {language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
              <TextInputV2
                ref={codeInput}
                class="!w-full"
                name="code"
                placeholder={language.t("provider.connect.oauth.code.placeholder")}
                value={formStore.value}
                invalid={formStore.error !== undefined}
                aria-describedby={formStore.error ? errorID : undefined}
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setFormStore("value", event.currentTarget.value)}
              />
            </label>
            <Show when={formStore.error}>
              {(error) => (
                <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                  {error()}
                </div>
              )}
            </Show>
            <ButtonV2 type="submit" variant="contrast">
              {language.t("common.continue")}
            </ButtonV2>
          </form>
        </div>
      )

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.code.visit.link")}</Link>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus={!newLayout()}
            ref={codeInput}
            type="text"
            label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
            placeholder={language.t("provider.connect.oauth.code.placeholder")}
            name="code"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    const code = createMemo(() => {
      const instructions = store.authorization?.instructions
      if (instructions?.includes(":")) {
        return instructions.split(":").pop()?.trim()
      }
      return instructions
    })

    onMount(() => {
      void (async () => {
        const result = await serverSDK()
          .client.provider.oauth.callback({
            providerID: props.provider,
            method: store.methodIndex,
          })
          .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
          .catch((error) => ({ ok: false as const, error }))

        if (!alive.value) return

        if (!result.ok) {
          const message = formatError(result.error, language.t("common.requestFailed"))
          dispatch({ type: "auth.error", error: message })
          return
        }

        await complete()
      })()
    })

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.auto.visit.link")}</Link>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
        </div>
        <TextField
          label={language.t("provider.connect.oauth.auto.confirmationCode")}
          class="font-mono"
          value={code()}
          readOnly
          copyable
        />
        <div class="text-14-regular text-text-base flex items-center gap-4">
          <Spinner />
          <span>{language.t("provider.connect.status.waiting")}</span>
        </div>
      </div>
    )
  }

  return (
    <div class={newLayout() ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-6 px-2.5 pb-3"}>
      <div class={newLayout() ? "flex h-10 shrink-0 items-start gap-2 px-3" : "flex items-center gap-4 px-2.5"}>
        <ProviderIcon
          id={props.provider}
          class={newLayout() ? "mt-0.5 size-4 shrink-0 text-v2-icon-icon-base" : "size-5 shrink-0 icon-strong-base"}
        />
        <div
          class={
            newLayout()
              ? "text-[15px] font-[530] leading-5 tracking-[-0.13px] text-v2-text-text-base"
              : "text-16-medium text-text-strong"
          }
        >
          <Switch>
            <Match when={props.provider === "anthropic" && method()?.label?.toLowerCase().includes("max")}>
              {language.t("provider.connect.title.anthropicProMax")}
            </Match>
            <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
          </Switch>
        </div>
      </div>
      <div class={newLayout() ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-6 px-2.5 pb-10"}>
        <div
          onKeyDown={handleKey}
          tabIndex={newLayout() ? undefined : 0}
          autofocus={!newLayout() && store.methodIndex === undefined ? true : undefined}
        >
          <Switch>
            <Match when={loading()}>
              <div class="text-14-regular text-text-base">
                <div class="flex items-center gap-x-2">
                  <Spinner />
                  <span>{language.t("provider.connect.status.inProgress")}</span>
                </div>
              </div>
            </Match>
            <Match when={store.methodIndex === undefined}>
              <MethodSelection />
            </Match>
            <Match when={store.state === "pending"}>
              <div class="text-14-regular text-text-base">
                <div class="flex items-center gap-x-2">
                  <Spinner />
                  <span>{language.t("provider.connect.status.inProgress")}</span>
                </div>
              </div>
            </Match>
            <Match when={store.state === "prompt"}>
              <AuthPromptsView />
            </Match>
            <Match when={store.state === "error"}>
              <div class="text-14-regular text-text-base">
                <div class="flex items-center gap-x-2">
                  <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                  <span>{language.t("provider.connect.status.failed", { error: store.error ?? "" })}</span>
                </div>
              </div>
            </Match>
            <Match when={method()?.type === "api"}>
              <ApiAuthView />
            </Match>
            <Match when={method()?.type === "oauth"}>
              <Switch>
                <Match when={store.authorization?.method === "code"}>
                  <OAuthCodeView />
                </Match>
                <Match when={store.authorization?.method === "auto"}>
                  <OAuthAutoView />
                </Match>
              </Switch>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}
