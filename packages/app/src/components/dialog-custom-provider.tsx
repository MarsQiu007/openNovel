import { Button } from "@opennovel-ai/ui/button"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { Dialog } from "@opennovel-ai/ui/dialog"
import { IconButton } from "@opennovel-ai/ui/icon-button"
import { ProviderIcon } from "@opennovel-ai/ui/provider-icon"
import { Select } from "@opennovel-ai/ui/select"
import { Switch } from "@opennovel-ai/ui/switch"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opennovel-ai/ui/text-field"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opennovel-ai/core/config/v1/provider"
import { showToast } from "@/utils/toast"
import { batch, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import {
  MODEL_STATUS,
  type FormMode,
  type FormState,
  type ModelDetail,
  headerRow,
  modelRow,
  prefillCustomProvider,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

type Props = {
  onBack: () => void
  providerID?: string
}

export function DialogCustomProvider(props: Props) {
  const language = useLanguage()

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <CustomProviderForm mode={props.providerID ? "edit" : "create"} providerID={props.providerID} />
    </Dialog>
  )
}

export function CustomProviderForm(
  props: { autofocus?: boolean; mode?: FormMode; providerID?: string } = {},
) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const mode: FormMode = props.mode ?? "create"

  const persisted = props.providerID ? serverSync().data.config.provider?.[props.providerID] : undefined
  const [form, setForm] = createStore<FormState>(
    mode === "edit" && props.providerID && persisted
      ? { ...prefillCustomProvider(props.providerID, persisted), err: {} }
      : {
          providerID: "",
          name: "",
          baseURL: "",
          apiKey: "",
          models: [modelRow()],
          headers: [headerRow()],
          err: {},
        },
  )

  // 模型行细节区展开态（本地信号，不进持久化表单状态）
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [confirmingDelete, setConfirmingDelete] = createSignal(false)

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setModelDetail = (index: number, key: keyof ModelDetail & string, value: string) => {
    batch(() => {
      setForm("models", index, "detail", key, value)
      setForm("models", index, "err", "detail", undefined)
    })
  }

  const setModelFlag = (index: number, key: keyof ModelDetail & string, value: boolean) => {
    setForm("models", index, "detail", key, value)
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      mode,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync().data.provider.all.keys()),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      // 经契约 schema 解码后再出网：既拿到类型又拦下与 ConfigProviderV1 不符的字段
      const providerConfig = Schema.decodeUnknownSync(ConfigProviderV1.Info)(result.config)
      await serverSDK().client.global.config.provider.set({
        providerID: result.providerID,
        providerConfig,
      })
      return result
    },
    onSuccess: (result) => {
      serverSync().refreshConfig()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const deleteMutation = useMutation(() => ({
    mutationFn: async (providerID: string) => {
      await serverSDK().client.global.config.provider.remove({ providerID })
    },
    onSuccess: (_data, providerID) => {
      serverSync().refreshConfig()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.custom.delete.toast.title", { provider: providerID }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  const remove = () => {
    if (!props.providerID) return
    if (!confirmingDelete()) {
      setConfirmingDelete(true)
      return
    }
    if (deleteMutation.isPending) return
    deleteMutation.mutate(props.providerID)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {language.t("provider.custom.description.prefix")}
          <Link href="https://opennovel.ai/docs/providers/#custom-provider" tabIndex={-1}>
            {language.t("provider.custom.description.link")}
          </Link>
          {language.t("provider.custom.description.suffix")}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
            disabled={mode === "edit"}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
          <TextField
            label={language.t("provider.custom.field.baseURL.label")}
            placeholder={language.t("provider.custom.field.baseURL.placeholder")}
            value={form.baseURL}
            onChange={(v) => setField("baseURL", v)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />
          <TextField
            label={language.t("provider.custom.field.apiKey.label")}
            placeholder={
              mode === "edit"
                ? language.t("provider.custom.field.apiKey.placeholderEdit")
                : language.t("provider.custom.field.apiKey.placeholder")
            }
            description={language.t("provider.custom.field.apiKey.description")}
            value={form.apiKey}
            onChange={(v) => setField("apiKey", v)}
          />
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex flex-col gap-2" data-row={m.row}>
                <div class="flex gap-2 items-start">
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setModel(i(), "name", v)}
                      validationState={m.err.name ? "invalid" : undefined}
                      error={m.err.name}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  class="self-start -mt-1"
                  onClick={() => setExpanded(m.row, !expanded[m.row])}
                >
                  {expanded[m.row]
                    ? language.t("provider.custom.models.detail.hide")
                    : language.t("provider.custom.models.detail.show")}
                </Button>
                <Show when={expanded[m.row]}>
                  <div class="flex flex-col gap-3 pl-2 border-l border-border-weak-base">
                    <div class="grid grid-cols-2 gap-3">
                      <TextField
                        label={language.t("provider.custom.models.detail.context.label")}
                        placeholder="131072"
                        value={m.detail.context}
                        onChange={(v) => setModelDetail(i(), "context", v)}
                      />
                      <TextField
                        label={language.t("provider.custom.models.detail.output.label")}
                        placeholder="8192"
                        value={m.detail.output}
                        onChange={(v) => setModelDetail(i(), "output", v)}
                      />
                      <TextField
                        label={language.t("provider.custom.models.detail.input.label")}
                        placeholder="65536"
                        value={m.detail.input}
                        onChange={(v) => setModelDetail(i(), "input", v)}
                      />
                      <TextField
                        label={language.t("provider.custom.models.detail.family.label")}
                        placeholder="gpt-5"
                        value={m.detail.family}
                        onChange={(v) => setModelDetail(i(), "family", v)}
                      />
                      <TextField
                        label={language.t("provider.custom.models.detail.costInput.label")}
                        placeholder="1.25"
                        value={m.detail.costInput}
                        onChange={(v) => setModelDetail(i(), "costInput", v)}
                      />
                      <TextField
                        label={language.t("provider.custom.models.detail.costOutput.label")}
                        placeholder="10"
                        value={m.detail.costOutput}
                        onChange={(v) => setModelDetail(i(), "costOutput", v)}
                      />
                      <Select
                        options={[...MODEL_STATUS]}
                        current={m.detail.status || undefined}
                        placeholder={language.t("provider.custom.models.detail.status.placeholder")}
                        onSelect={(value) => setModelDetail(i(), "status", value ?? "")}
                      >
                        {(item) =>
                          item ? (
                            <span>{language.t(`provider.custom.models.detail.status.${item}`)}</span>
                          ) : (
                            <span />
                          )
                        }
                      </Select>
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-2">
                      <Switch checked={m.detail.reasoning} onChange={(v) => setModelFlag(i(), "reasoning", v)}>
                        {language.t("provider.custom.models.detail.reasoning")}
                      </Switch>
                      <Switch checked={m.detail.interleaved} onChange={(v) => setModelFlag(i(), "interleaved", v)}>
                        {language.t("provider.custom.models.detail.interleaved")}
                      </Switch>
                      <Switch checked={m.detail.temperature} onChange={(v) => setModelFlag(i(), "temperature", v)}>
                        {language.t("provider.custom.models.detail.temperature")}
                      </Switch>
                      <Switch checked={m.detail.toolCall} onChange={(v) => setModelFlag(i(), "toolCall", v)}>
                        {language.t("provider.custom.models.detail.toolCall")}
                      </Switch>
                      <Switch checked={m.detail.attachment} onChange={(v) => setModelFlag(i(), "attachment", v)}>
                        {language.t("provider.custom.models.detail.attachment")}
                      </Switch>
                    </div>
                    <Show when={m.err.detail}>
                      <div class="text-12-regular text-on-critical-base">{m.err.detail}</div>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>

        <div class="flex items-center gap-3">
          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
          <Show when={mode === "edit" && props.providerID}>
            <Button
              type="button"
              size="large"
              variant="ghost"
              class="text-on-critical-base"
              disabled={saveMutation.isPending || deleteMutation.isPending}
              onClick={remove}
            >
              {confirmingDelete()
                ? language.t("provider.custom.delete.confirm")
                : language.t("provider.custom.delete.label")}
            </Button>
          </Show>
        </div>
      </form>
    </div>
  )
}
