/**
 * 工具洞察（工具改进日志）设置：经典与 V2 设置页复用同一组件（v2 属性切换
 * 区块与行原语，同 SettingsSync 的双版本复用方式）。只提供启用开关与日志目录：
 * 经既有全局配置通道读写（payload 只含 toolInsight 字段，服务端仅此字段变化时
 * 跳过全局 dispose，项目不重开）；目录选择复用 useDirectoryPicker，取消保持
 * 原值，桌面/网页桥接不可用时在输入框手动填写。清空目录发送空串——服务端对
 * toolInsight 是深合并，缺键会保留旧值，空串经窄解析器归一为「使用默认位置」。
 * 组件文案按仓库约束使用内联简体中文，不改动 i18n locale 文件。
 */
import { type Component, type JSX, createMemo, createSignal } from "solid-js"
import { Switch } from "@opennovel-ai/ui/switch"
import { TextField } from "@opennovel-ai/ui/text-field"
import { Button } from "@opennovel-ai/ui/button"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { useDirectoryPicker } from "./directory-picker"
import { isAbsoluteDirectoryPath, resolveDirectoryCommit } from "./settings-tool-insight-logic"
import { SettingsList } from "./settings-list"
import { SettingsListV2 } from "./settings-v2/parts/list"
import { SettingsRowV2 } from "./settings-v2/parts/row"

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "data")
    if (typeof message === "object" && message !== null) {
      const text = Reflect.get(message, "message")
      if (typeof text === "string") return text
    }
  }
  if (error instanceof Error) return error.message
  return String(error)
}

export const SettingsToolInsight: Component<{ v2?: boolean }> = (props) => {
  const serverSync = useServerSync()
  const server = useServer()
  const pickDirectory = useDirectoryPicker()

  const setting = createMemo(() => serverSync().data.config.toolInsight)
  const directory = createMemo(() => setting()?.directory ?? "")

  // 手动输入草稿：undefined 表示未编辑，显示已保存值；失焦或回车提交
  const [directoryDraft, setDirectoryDraft] = createSignal<string>()
  const shownDirectory = () => directoryDraft() ?? directory()
  const directoryInvalid = createMemo(() => shownDirectory().trim() !== "" && !isAbsoluteDirectoryPath(shownDirectory().trim()))

  const save = (input: { enabled: boolean; directory: string }) =>
    serverSync()
      .updateConfig({ toolInsight: { enabled: input.enabled, directory: input.directory } })
      .catch((error) => showToast({ variant: "error", title: "工具改进日志设置保存失败", description: describeError(error) }))

  const onToggle = (checked: boolean) => void save({ enabled: checked, directory: directory() })

  const commitDirectory = () => {
    const outcome = resolveDirectoryCommit({ saved: directory(), draft: directoryDraft() })
    if (outcome.action === "invalid") return // 行内错误提示已可见，保留草稿供修改
    setDirectoryDraft(undefined)
    if (outcome.action === "save") void save({ enabled: setting()?.enabled ?? false, directory: outcome.value })
  }

  const chooseDirectory = () => {
    const conn = server.current
    if (!conn) return
    pickDirectory({
      server: conn,
      title: "选择工具改进日志目录",
      multiple: false,
      onSelect: (result) => {
        const selected = Array.isArray(result) ? result[0] : result
        if (!selected) return // 取消或空选择：保持原值
        setDirectoryDraft(undefined)
        void save({ enabled: setting()?.enabled ?? false, directory: selected })
      },
    })
  }

  const PickButton = () =>
    props.v2 ? (
      <ButtonV2 variant="neutral" onClick={chooseDirectory}>
        选择…
      </ButtonV2>
    ) : (
      <Button variant="secondary" size="small" onClick={chooseDirectory}>
        选择…
      </Button>
    )

  const List = props.v2 ? SettingsListV2 : SettingsList

  const Section: Component<{ children: JSX.Element }> = (p) => (
    <div classList={{ "settings-v2-section": props.v2, "flex flex-col gap-1": !props.v2 }}>
      <h3 classList={{ "settings-v2-section-title": props.v2, "text-14-medium text-text-strong pb-2": !props.v2 }}>
        工具改进日志
      </h3>
      {p.children}
    </div>
  )

  const Row: Component<{ title: string; description: string; children: JSX.Element }> = (p) => {
    if (props.v2) {
      return (
        <SettingsRowV2 title={p.title} description={p.description}>
          {p.children}
        </SettingsRowV2>
      )
    }
    return (
      <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-14-medium text-text-strong">{p.title}</span>
          <span class="text-12-regular text-text-weak">{p.description}</span>
        </div>
        <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{p.children}</div>
      </div>
    )
  }

  return (
    <Section>
      <List>
        <Row
          title="启用工具改进日志"
          description="记录写作过程中的工具问题，并支持在隔离临时项目中自动复测；默认关闭，不产生模型请求，日志只保存在本机。"
        >
          <div data-action="settings-tool-insight-enabled">
            <Switch checked={setting()?.enabled ?? false} onChange={onToggle} />
          </div>
        </Row>
        <Row title="日志目录" description="留空使用默认位置（项目自评价目录下的 tool-insight 子目录）。">
          <div class="flex items-center gap-2" data-action="settings-tool-insight-directory">
            <TextField
              value={shownDirectory()}
              placeholder="留空使用默认位置"
              spellcheck={false}
              onChange={(value) => setDirectoryDraft(value)}
              onBlur={commitDirectory}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") commitDirectory()
              }}
              validationState={directoryInvalid() ? "invalid" : undefined}
              error={directoryInvalid() ? "请输入绝对路径，或留空使用默认位置" : undefined}
              class="w-64"
            />
            <PickButton />
          </div>
        </Row>
      </List>
    </Section>
  )
}
