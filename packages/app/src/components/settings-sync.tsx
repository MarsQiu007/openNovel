import { type Component, type JSX, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import type { ServerSyncResolveInput, ServerSyncRunOutput, ServerSyncStatusOutput } from "@opennovel-ai/client"
import { Button } from "@opennovel-ai/ui/button"
import { Icon } from "@opennovel-ai/ui/icon"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { Switch } from "@opennovel-ai/ui/switch"
import { TextField } from "@opennovel-ai/ui/text-field"
import { Tag } from "@opennovel-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import {
  DialogBody,
  DialogV2,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opennovel-ai/ui/v2/dialog-v2"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { novelKeys, useNovelClient } from "@/context/novel-queries"
import { cloudSyncAutoEnabled, cloudSyncKeys, setCloudSyncAutoEnabled } from "@/context/cloud-sync"
import { useServer } from "@/context/server"
import { useDirectoryPicker } from "@/components/directory-picker"
import { getRelativeTime } from "@/utils/time"
import { showToast } from "@/utils/toast"
import { SettingsList } from "./settings-list"
import { SettingsListV2 } from "./settings-v2/parts/list"
import { SettingsRowV2 } from "./settings-v2/parts/row"

type ConnectionFormValues = {
  url: string
  username: string
  password: string
}

type SyncProject = ServerSyncStatusOutput["projects"][number]
type SyncState = SyncProject["state"]
type Decision = ServerSyncRunOutput["decisions"][number]

const stateVariant: Record<SyncState, "success" | "warning" | "info" | "danger"> = {
  in_sync: "success",
  local_ahead: "warning",
  remote_ahead: "info",
  new_local: "warning",
  new_remote: "info",
  conflict: "danger",
  pending_delete: "danger",
}

// The generated client throws the raw parsed error body for declared statuses;
// sync endpoints answer 400 with { name: "SyncErrorResponse", data: { message } }.
function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const message = (error as { data?: { message?: unknown } }).data?.message
    if (typeof message === "string") return message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

export const SettingsSync: Component<{ v2?: boolean }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const server = useServer()
  const pickDirectory = useDirectoryPicker()

  const invalidate = () => queryClient.invalidateQueries({ queryKey: cloudSyncKeys.all })

  const status = createQuery(() => ({
    queryKey: cloudSyncKeys.status(),
    queryFn: () => client()["server.sync"].status(),
    refetchOnMount: "always",
  }))

  const [form, setForm] = createStore<ConnectionFormValues>({ url: "", username: "", password: "" })
  const [testResult, setTestResult] = createSignal<{ ok: boolean; error?: string }>()
  const [auto, setAuto] = createSignal(cloudSyncAutoEnabled())
  const [decisionQueue, setDecisionQueue] = createSignal<readonly Decision[]>([])

  const notifyError = (title: string, error: unknown) =>
    showToast({ variant: "error", title, description: errorMessage(error) })

  const testConnection = useMutation(() => ({
    mutationFn: (input: ConnectionFormValues) => client()["server.sync"].test(input),
    onSuccess: (result) => setTestResult(result),
    onError: (error) => setTestResult({ ok: false, error: errorMessage(error) }),
  }))

  const saveConnection = useMutation(() => ({
    mutationFn: (input: ConnectionFormValues) => client()["server.sync"].save(input),
    onSuccess: () => {
      setForm("password", "")
      setTestResult(undefined)
      void invalidate()
      showToast({ variant: "success", title: language.t("settings.sync.toast.saved") })
    },
    onError: (error) => notifyError(language.t("settings.sync.toast.saveFailed"), error),
  }))

  const disconnect = useMutation(() => ({
    mutationFn: () => client()["server.sync"].remove(),
    onSuccess: () => {
      void invalidate()
      showToast({ variant: "success", title: language.t("settings.sync.toast.disconnected") })
    },
    onError: (error) => notifyError(language.t("settings.sync.toast.disconnectFailed"), error),
  }))

  const setRoot = useMutation(() => ({
    mutationFn: (rootDir: string) => client()["server.sync"].set({ rootDir }),
    onSuccess: () => {
      void invalidate()
      showToast({ variant: "success", title: language.t("settings.sync.toast.rootSet") })
    },
    onError: (error) => notifyError(language.t("settings.sync.toast.rootFailed"), error),
  }))

  const syncNow = useMutation(() => ({
    mutationFn: () => client()["server.sync"].run(),
    onSuccess: (data) => {
      void invalidate()
      if (data.results.some((result) => result.action === "downloaded")) {
        void queryClient.invalidateQueries({ queryKey: novelKeys.all })
      }
      if (data.decisions.length > 0) {
        openDecisions(data.decisions)
        return
      }
      if (data.results.length === 0) {
        showToast({ variant: "success", title: language.t("settings.sync.toast.upToDate") })
        return
      }
      showToast({ variant: "success", title: language.t("settings.sync.toast.synced") })
    },
    onError: (error) => notifyError(language.t("settings.sync.toast.syncFailed"), error),
  }))

  const resolveDecision = useMutation(() => ({
    mutationFn: (input: ServerSyncResolveInput) => client()["server.sync"].resolve(input),
    onSuccess: () => {
      void invalidate()
      showToast({ variant: "success", title: language.t("settings.sync.toast.resolved") })
      advance()
    },
    onError: (error) => notifyError(language.t("settings.sync.toast.syncFailed"), error),
  }))

  // Unresolved conflicts come back as decisions on the next run(), so skipping
  // simply closes the dialog; nothing is recorded server-side.
  const advance = () => {
    const rest = decisionQueue().slice(1)
    setDecisionQueue(rest)
    const head = rest[0]
    if (!head) {
      dialog.close()
      // Resolutions may have downloaded over the local library
      void queryClient.invalidateQueries({ queryKey: novelKeys.all })
      return
    }
    void dialog.show(() => <DecisionDialog decision={head} />)
  }

  const openDecisions = (decisions: readonly Decision[]) => {
    setDecisionQueue(decisions)
    const head = decisions[0]
    if (!head) return
    void dialog.show(() => <DecisionDialog decision={head} />)
  }

  const canSubmit = createMemo(() => !!form.url.trim() && !!form.username.trim() && !!form.password.length)

  const formInput = () => ({
    url: form.url.trim(),
    username: form.username.trim(),
    password: form.password,
  })

  const formatTime = (value: number | string | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return language.t("settings.sync.lastSynced.never")
    return getRelativeTime(new Date(value).toISOString(), language.t)
  }

  const toggleAuto = (checked: boolean) => {
    setAuto(checked)
    setCloudSyncAutoEnabled(checked)
  }

  const chooseRoot = () => {
    const conn = server.current
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("settings.sync.root.choose"),
      multiple: false,
      onSelect: (result) => {
        const selected = Array.isArray(result) ? result[0] : result
        if (!selected) return
        setRoot.mutate(selected)
      },
    })
  }

  const confirmDisconnect = () => {
    void dialog.push(() => (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("settings.sync.disconnect.confirm.title")}
            description={language.t("settings.sync.disconnect.confirm.message")}
          />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              disconnect.mutate()
            }}
          >
            {language.t("settings.sync.action.disconnect")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    ))
  }

  const List = props.v2 ? SettingsListV2 : SettingsList

  const Section: Component<{ title?: JSX.Element; action?: JSX.Element; children: JSX.Element }> = (p) => (
    <div classList={{ "settings-v2-section": props.v2, "flex flex-col gap-1": !props.v2 }}>
      <Show when={p.title || p.action}>
        <div class="flex items-center justify-between gap-4">
          <h3
            classList={{
              "settings-v2-section-title": props.v2,
              "text-14-medium text-text-strong pb-2": !props.v2,
            }}
          >
            {p.title}
          </h3>
          <Show when={p.action}>{(action) => action()}</Show>
        </div>
      </Show>
      {p.children}
    </div>
  )

  const Row: Component<{ title: JSX.Element; description?: JSX.Element; children?: JSX.Element }> = (p) => {
    if (props.v2) {
      return (
        <SettingsRowV2 title={p.title} description={p.description ?? ""}>
          {p.children}
        </SettingsRowV2>
      )
    }
    return (
      <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-14-medium text-text-strong">{p.title}</span>
          <Show when={p.description}>
            <span class="text-12-regular text-text-weak">{p.description}</span>
          </Show>
        </div>
        <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{p.children}</div>
      </div>
    )
  }

  const ConnectionForm: Component = () => (
    <div
      classList={{
        "bg-surface-base rounded-lg p-5 flex flex-col gap-3": !props.v2,
        "flex flex-col gap-3 py-4": props.v2,
      }}
      data-component={props.v2 ? "settings-v2-list" : undefined}
    >
      <TextField
        type="text"
        label={language.t("settings.sync.field.url")}
        description={language.t("settings.sync.field.url.description")}
        placeholder={language.t("settings.sync.field.url.placeholder")}
        value={form.url}
        disabled={testConnection.isPending || saveConnection.isPending}
        onChange={(value) => setForm("url", value)}
        spellcheck={false}
        autocorrect="off"
        autocomplete="off"
        autocapitalize="off"
      />
      <TextField
        type="text"
        label={language.t("settings.sync.field.username")}
        placeholder={language.t("settings.sync.field.username.placeholder")}
        value={form.username}
        disabled={testConnection.isPending || saveConnection.isPending}
        onChange={(value) => setForm("username", value)}
        spellcheck={false}
        autocorrect="off"
        autocomplete="off"
        autocapitalize="off"
      />
      <TextField
        type="password"
        label={language.t("settings.sync.field.password")}
        description={language.t("settings.sync.field.password.description")}
        value={form.password}
        disabled={testConnection.isPending || saveConnection.isPending}
        onChange={(value) => setForm("password", value)}
        autocomplete="off"
      />
      <div class="flex flex-wrap items-center gap-3 pt-1">
        <Button
          variant="secondary"
          size="small"
          disabled={!canSubmit() || testConnection.isPending || saveConnection.isPending}
          onClick={() => testConnection.mutate(formInput())}
        >
          {testConnection.isPending
            ? language.t("settings.sync.action.testing")
            : language.t("settings.sync.action.test")}
        </Button>
        <Button
          variant="primary"
          size="small"
          disabled={!canSubmit() || testConnection.isPending || saveConnection.isPending}
          onClick={() => saveConnection.mutate(formInput())}
        >
          {saveConnection.isPending
            ? language.t("settings.sync.action.saving")
            : language.t("settings.sync.action.save")}
        </Button>
        <Show when={testResult()}>
          {(result) => (
            <Show
              when={result().ok}
              fallback={
                <span class="text-12-regular text-text-on-critical-base">
                  {language.t("settings.sync.test.failed")}
                  {result().error ? `: ${result().error}` : ""}
                </span>
              }
            >
              <span class="flex items-center gap-1 text-12-regular text-text-on-success-base">
                <Icon name="circle-check" size="small" />
                {language.t("settings.sync.test.success")}
              </span>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )

  const ConnectedCard: Component = () => (
    <List>
      <Row title={status.data?.connection?.url} description={status.data?.connection?.username}>
        <Button variant="secondary" size="small" disabled={disconnect.isPending} onClick={confirmDisconnect}>
          {language.t("settings.sync.action.disconnect")}
        </Button>
      </Row>
    </List>
  )

  const ProjectRow: Component<{ project: SyncProject }> = (p) => {
    const tag = (
      <Tag variant={stateVariant[p.project.state]}>{language.t(`settings.sync.state.${p.project.state}`)}</Tag>
    )
    const meta = (
      <>
        <Show when={(p.project.novels ?? []).length > 0}>
          <span class="min-w-0 truncate">{(p.project.novels ?? []).join(", ")}</span>
        </Show>
        <span>
          {language.t("settings.sync.lastSynced")}: {formatTime(p.project.lastSyncedAt)}
        </span>
      </>
    )
    const resolveButton = (
      <Show when={p.project.state === "conflict" || p.project.state === "pending_delete"}>
        <Button size="small" variant="secondary" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
          {language.t("settings.sync.projects.resolve")}
        </Button>
      </Show>
    )
    if (props.v2) {
      return (
        <SettingsRowV2
          title={
            <div class="flex items-center gap-2">
              <span class="min-w-0 truncate">{p.project.name}</span>
              {tag}
            </div>
          }
          description={<span class="flex flex-wrap items-center gap-x-3 gap-y-0.5">{meta}</span>}
        >
          {resolveButton}
        </SettingsRowV2>
      )
    }
    return (
      <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="min-w-0 truncate text-14-medium text-text-strong">{p.project.name}</span>
            {tag}
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-12-regular text-text-weak">{meta}</div>
        </div>
        <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{resolveButton}</div>
      </div>
    )
  }

  const DecisionDialog: Component<{ decision: Decision }> = (props) => {
    const decision = props.decision

    if (decision.kind === "delete_confirm") {
      return (
        <DialogV2 fit>
          <DialogHeader hideClose>
            <DialogTitleGroup
              title={language.t("settings.sync.decision.delete.title")}
              description={language.t("settings.sync.decision.delete.description", {
                names: decision.names.join(", "),
              })}
            />
          </DialogHeader>
          <DialogFooter>
            <ButtonV2 variant="ghost" disabled={resolveDecision.isPending} onClick={advance}>
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2
              variant="danger"
              disabled={resolveDecision.isPending}
              onClick={() => resolveDecision.mutate({ action: "confirm_delete", names: decision.names })}
            >
              {language.t("settings.sync.decision.confirmDelete")}
            </ButtonV2>
          </DialogFooter>
        </DialogV2>
      )
    }

    const decide = (action: "keep_local" | "keep_remote" | "keep_both") =>
      resolveDecision.mutate({ name: decision.name, action })

    if (decision.kind === "pair_conflict") {
      return (
        <DialogV2 fit>
          <DialogHeader hideClose>
            <DialogTitleGroup
              title={language.t("settings.sync.decision.pair.title")}
              description={language.t("settings.sync.decision.pair.description", {
                name: decision.name,
                device: decision.remote.device,
                time: formatTime(decision.remote.at),
              })}
            />
          </DialogHeader>
          <DialogBody class="px-4 pb-1">
            <span class="text-11-regular text-text-weak">{language.t("settings.sync.decision.backup.hint")}</span>
          </DialogBody>
          <DialogFooter>
            <ButtonV2 variant="ghost" disabled={resolveDecision.isPending} onClick={advance}>
              {language.t("settings.sync.decision.later")}
            </ButtonV2>
            <ButtonV2 variant="neutral" disabled={resolveDecision.isPending} onClick={() => decide("keep_both")}>
              {language.t("settings.sync.decision.keepBoth")}
            </ButtonV2>
            <ButtonV2 variant="neutral" disabled={resolveDecision.isPending} onClick={() => decide("keep_remote")}>
              {language.t("settings.sync.decision.keepRemote")}
            </ButtonV2>
            <ButtonV2 variant="contrast" disabled={resolveDecision.isPending} onClick={() => decide("keep_local")}>
              {language.t("settings.sync.decision.keepLocal")}
            </ButtonV2>
          </DialogFooter>
        </DialogV2>
      )
    }

    return (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("settings.sync.decision.tie.title")}
            description={language.t("settings.sync.decision.tie.description", {
              name: decision.name,
              localTime: formatTime(decision.localTime),
              remoteTime: formatTime(decision.remoteTime),
            })}
          />
        </DialogHeader>
        <DialogBody class="px-4 pb-1">
          <span class="text-11-regular text-text-weak">{language.t("settings.sync.decision.backup.hint")}</span>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="ghost" disabled={resolveDecision.isPending} onClick={advance}>
            {language.t("settings.sync.decision.later")}
          </ButtonV2>
          <ButtonV2 variant="neutral" disabled={resolveDecision.isPending} onClick={() => decide("keep_remote")}>
            {language.t("settings.sync.decision.keepRemote")}
          </ButtonV2>
          <ButtonV2 variant="contrast" disabled={resolveDecision.isPending} onClick={() => decide("keep_local")}>
            {language.t("settings.sync.decision.keepLocal")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    )
  }

  const syncButton = (
    <Button variant="primary" size="small" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
      {syncNow.isPending ? language.t("settings.sync.action.syncing") : language.t("settings.sync.action.sync")}
    </Button>
  )

  const content = (
    <>
      <Show when={status.isPending}>
        <div class="flex justify-center py-8">
          <Spinner class="w-6 h-6 text-text-weak" />
        </div>
      </Show>

      <Show when={status.isError}>
        <span class="text-12-regular text-text-on-critical-base">
          {language.t("common.requestFailed")}
          {status.error ? `: ${errorMessage(status.error)}` : ""}
        </span>
      </Show>

      <Show when={status.data}>
        {(data) => (
          <>
            <Section title={language.t("settings.sync.connection.section")}>
              <Show when={data().connection} fallback={<ConnectionForm />}>
                <ConnectedCard />
              </Show>
            </Section>

            <Show when={data().connection}>
              <Section title={language.t("settings.sync.root.section")}>
                <List>
                  <Row
                    title={data().rootDir ?? language.t("settings.sync.root.notSet")}
                    description={language.t("settings.sync.root.description")}
                  >
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={!server.current || setRoot.isPending}
                      onClick={chooseRoot}
                    >
                      {language.t("settings.sync.root.choose")}
                    </Button>
                  </Row>
                </List>
              </Section>

              <Show when={data().rootDir}>
                <Section title={language.t("settings.sync.projects.section")} action={syncButton}>
                  <Show
                    when={data().projects.length > 0}
                    fallback={
                      <span class="text-12-regular text-text-weak">{language.t("settings.sync.projects.empty")}</span>
                    }
                  >
                    <List>
                      <For each={data().projects}>{(project) => <ProjectRow project={project} />}</For>
                    </List>
                  </Show>
                </Section>
              </Show>

              <Section>
                <List>
                  <Row
                    title={language.t("settings.sync.auto.title")}
                    description={language.t("settings.sync.auto.description")}
                  >
                    <Switch checked={auto()} onChange={toggleAuto} />
                  </Row>
                </List>
              </Section>
            </Show>
          </>
        )}
      </Show>
    </>
  )

  return (
    <Show
      when={props.v2}
      fallback={
        <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
          <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
            <div class="flex flex-col gap-1 pt-6 pb-8">
              <h2 class="text-16-medium text-text-strong">{language.t("settings.sync.title")}</h2>
            </div>
          </div>
          <div class="flex flex-col gap-8 w-full max-w-[720px]">{content}</div>
        </div>
      }
    >
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.sync.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">{content}</div>
    </Show>
  )
}
