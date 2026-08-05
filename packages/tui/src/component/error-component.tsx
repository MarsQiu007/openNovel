import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { getScrollAcceleration } from "../util/scroll"
import { useClipboard } from "../context/clipboard"
import { InstallationVersion } from "@opennovel-ai/core/installation/version"
import { useExit } from "../context/exit"
import { describeOS, describeTerminal } from "../util/system"

export function ErrorComponent(props: { error: Error; reset: () => void; mode?: "dark" | "light" }) {
  const term = useTerminalDimensions()
  const exit = useExit()
  const clipboard = useClipboard()
  const [copied, setCopied] = createSignal(false)

  // 按模式提供安全回退色板（参考 theme/assets/opennovel.json），因为主题上下文本身可能就是崩溃原因。
  const isLight = props.mode === "light"
  const colors = isLight
    ? {
        bg: "#ffffff",
        element: "#f5f5f5",
        borderSubtle: "#d4d4d4",
        text: "#1a1a1a",
        muted: "#8a8a8a",
        primary: "#3b7dd8",
        onPrimary: "#ffffff",
        error: "#d1383d",
        success: "#3d9a57",
      }
    : {
        bg: "#0a0a0a",
        element: "#1e1e1e",
        borderSubtle: "#3c3c3c",
        text: "#eeeeee",
        muted: "#808080",
        primary: "#fab283",
        onPrimary: "#0a0a0a",
        error: "#e06c75",
        success: "#7fd88f",
      }

  const message = props.error.message || "An unknown error occurred."
  const stack = props.error.stack || "No stack trace available."
  const issueURL = buildIssueURL(message, stack)

  const copyReport = () => {
    void clipboard.write?.(issueURL.toString()).then(() => setCopied(true))
  }

  const actions = [
    { key: "c", label: () => (copied() ? "✓ Copied" : "Copy report"), copy: true, onUse: copyReport },
    { key: "r", label: () => "Restart", onUse: props.reset },
    { key: "q", label: () => "Quit", onUse: () => exit() },
  ]
  const [selected, setSelected] = createSignal(0)
  const move = (delta: number) => setSelected((prev) => (prev + delta + actions.length) % actions.length)
  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") return exit()
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      return actions[selected()].onUse()
    }
    if (evt.name === "left") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(-1)
    }
    if (evt.name === "right") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(1)
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(evt.shift ? -1 : 1)
    }
    // Vertical keys scroll the stack trace; buttons navigate horizontally.
    if (evt.name === "up") return scroll?.scrollBy(-1)
    if (evt.name === "down") return scroll?.scrollBy(1)
    if (evt.name === "pageup" && scroll) return scroll.scrollBy(-scroll.height)
    if (evt.name === "pagedown" && scroll) return scroll.scrollBy(scroll.height)
    if (evt.name === "home" && scroll) return scroll.scrollTo(0)
    if (evt.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
    if (evt.name === "q") return exit()
    if (evt.name === "c") return copyReport()
    if (evt.name === "r") return props.reset()
  })

  // Responsive thresholds.
  const contentWidth = () => Math.min(84, Math.max(24, term().width - 4))
  const showSubtext = () => term().height >= 18
  const showFooter = () => term().height >= 20

  return (
    <box
      width={term().width}
      height={term().height}
      backgroundColor={colors.bg}
      flexDirection="column"
      alignItems="center"
    >
      <box width={contentWidth()} flexGrow={1} flexDirection="column" paddingTop={1} paddingBottom={1} gap={1}>
        {/* Headline */}
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text attributes={TextAttributes.BOLD} fg={colors.text}>
            OpenNovel 崩溃了
          </text>
          <Show when={showSubtext()}>
            <text fg={colors.muted}>发生了一个意外错误，会话已停止。</text>
          </Show>
        </box>

        {/* Error message panel */}
        <box
          flexShrink={0}
          border
          borderStyle="rounded"
          borderColor={colors.error}
          title=" Error "
          titleColor={colors.error}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={colors.text}>{message}</text>
        </box>

        {/* Actions */}
        <box flexDirection="row" flexWrap="wrap" justifyContent="center" gap={2} rowGap={1} flexShrink={0}>
          <For each={actions}>
            {(action, index) => {
              const isSelected = () => selected() === index()
              const isCopied = () => action.copy && copied()
              return (
                <box flexDirection="column" alignItems="center" flexShrink={0}>
                  <box
                    onMouseDown={() => setSelected(index())}
                    onMouseUp={() => action.onUse()}
                    backgroundColor={isCopied() ? colors.success : isSelected() ? colors.primary : colors.element}
                    minWidth={15}
                    alignItems="center"
                    paddingLeft={2}
                    paddingRight={2}
                  >
                    <text
                      attributes={TextAttributes.BOLD}
                      fg={isCopied() || isSelected() ? colors.onPrimary : colors.text}
                    >
                      {action.label()}
                    </text>
                  </box>
                  <text fg={isSelected() ? colors.primary : colors.muted}>{action.key}</text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Stack trace */}
        <box
          flexGrow={1}
          flexBasis={0}
          minHeight={3}
          border
          borderStyle="rounded"
          borderColor={colors.borderSubtle}
          title=" Stack trace "
          titleColor={colors.muted}
          bottomTitle=" ↑↓ scroll "
          bottomTitleAlignment="right"
          paddingLeft={1}
          paddingRight={1}
        >
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
            flexGrow={1}
            scrollAcceleration={getScrollAcceleration()}
          >
            <text fg={colors.muted}>{stack}</text>
          </scrollbox>
        </box>

        {/* Footer */}
        <Show when={showFooter()}>
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            <text fg={colors.muted}>
              {copied()
                ? "报告已复制 — 请粘贴到新的 GitHub Issue 中。"
                : "复制报告并打开 GitHub Issue 以帮助我们修复此问题。"}
            </text>
            <text fg={colors.muted}>OpenNovel {InstallationVersion}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}

function buildIssueURL(message: string, stack: string) {
  // 字段键与 .github/ISSUE_TEMPLATE/bug-report.yml 中的 id 匹配，以便表单预填充。
  // 填充 os/terminal/reproduce 可使报告通过贡献指南合规检查，该检查要求提供系统信息。
  const url = new URL("https://github.com/MarsQiu007/openNovel/issues/new?template=bug-report.yml")
  url.searchParams.set("title", `TUI 崩溃: ${message}`)
  url.searchParams.set("opennovel-version", InstallationVersion)
  url.searchParams.set("os", describeOS())
  url.searchParams.set("terminal", describeTerminal())
  url.searchParams.set("reproduce", "从 OpenNovel 崩溃屏幕自动报告。如果可以，请描述崩溃时您正在进行的操作。")

  // 根据完全 URL 编码后的长度（而非原始长度）来控制堆栈大小，
  // 使最终链接保持在 GitHub 实际限制内；用截断标记提示，以便明显看出跟踪被截断。
  // searchParams.set 可安全处理编码且不会抛出异常，因此测量 url.toString() 对任意输入都是正确且安全的。
  const MAX_URL_LENGTH = 6000
  const marker = "\n... (已截断)"
  const head = `OpenNovel TUI 因意外错误而崩溃。\n\n**错误:** ${message}\n\n**堆栈跟踪:**\n`
  const setBody = (body: string) => url.searchParams.set("description", head + "```\n" + body + "\n```")

  setBody(stack)
  if (url.toString().length <= MAX_URL_LENGTH) return url

  // Largest raw stack prefix whose encoded URL (with the marker) still fits.
  let lo = 0
  let hi = stack.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    setBody(stack.slice(0, mid) + marker)
    if (url.toString().length <= MAX_URL_LENGTH) lo = mid
    else hi = mid - 1
  }
  setBody(stack.slice(0, lo) + marker)
  return url
}
