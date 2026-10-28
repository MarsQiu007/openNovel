// @ts-nocheck
import { onCleanup, onMount, type ParentProps } from "solid-js"
import { Card } from "@opennovel-ai/ui/card"
import { Collapsible } from "@opennovel-ai/ui/collapsible"
import { markdown } from "@opennovel-ai/ui/storybook/fixtures"
import { BasicTool } from "./basic-tool"
import { Markdown } from "./markdown"
import { SessionRetry } from "./session-retry"

function ConversationPreview(props: ParentProps<{ narrow?: boolean }>) {
  const previous = document.body.getAttribute("data-new-layout")
  onMount(() => document.body.setAttribute("data-new-layout", ""))
  onCleanup(() => {
    if (previous === null) {
      document.body.removeAttribute("data-new-layout")
      return
    }
    document.body.setAttribute("data-new-layout", previous)
  })

  return (
    <div
      data-session-conversation="timeline"
      style={{
        width: "100%",
        "max-width": props.narrow ? "420px" : "832px",
        margin: "0 auto",
        padding: "24px 20px 64px",
      }}
    >
      {props.children}
    </div>
  )
}

function ReadingFlow() {
  return (
    <>
      <div data-timeline-row="UserMessage">
        <div data-component="user-message">
          <div data-slot="user-message-body">
            <div data-slot="user-message-text">请把这一段整理成可读性更好的章节说明，并保留代码示例。</div>
          </div>
        </div>
      </div>
      <div data-timeline-row="AssistantPart" style={{ "padding-top": "12px" }}>
        <div data-component="text-part">
          <div data-slot="text-part-body">
            <Markdown text={markdown} streaming={false} />
          </div>
          <div data-slot="text-part-copy-wrapper" style={{ opacity: 1, "pointer-events": "auto" }}>
            <span data-slot="text-part-meta">Build · Claude Sonnet · 12 seconds</span>
          </div>
        </div>
      </div>
    </>
  )
}

export default {
  title: "Session UI/Conversation Presentation",
  id: "session-ui-conversation-presentation",
}

export const LongMarkdown = {
  render: () => (
    <ConversationPreview>
      <ReadingFlow />
    </ConversationPreview>
  ),
}

export const NarrowReading = {
  render: () => (
    <ConversationPreview narrow>
      <ReadingFlow />
    </ConversationPreview>
  ),
}

function ToolsAndReasoningPreview() {
  return (
    <div style={{ display: "grid", gap: "12px", "padding-top": "12px" }}>
      <div data-component="tool-part-wrapper">
        <BasicTool icon="mcp" defaultOpen trigger={{ title: "Read", subtitle: "chapters/chapter-02.md" }}>
          <div data-component="tool-output">
            <pre>Chapter context and continuity notes loaded successfully.</pre>
          </div>
        </BasicTool>
      </div>
      <div data-component="tool-part-wrapper">
        <BasicTool icon="mcp" status="running" trigger={{ title: "Write", subtitle: "Drafting chapter 02" }} />
      </div>
      <div data-component="tool-part-wrapper">
        <BasicTool icon="mcp" trigger={{ title: "Search", subtitle: "foreshadowing", args: ["limit=5"] }}>
          <div data-component="tool-output">
            <pre>5 matching continuity records</pre>
          </div>
        </BasicTool>
      </div>
      <div data-component="reasoning-part">
        <Collapsible defaultOpen={false} variant="ghost" class="reasoning-collapsible">
          <Collapsible.Trigger>
            <span data-slot="reasoning-part-trigger-text">检查章节目标与承接关系</span>
            <Collapsible.Arrow />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Markdown
              text={"先核对上一章结尾的悬念，再确认本章的场景目标。\n\n保留已有伏笔，不在正文中提前揭示答案。"}
              streaming={false}
            />
          </Collapsible.Content>
        </Collapsible>
      </div>
    </div>
  )
}

export const ToolsAndCollapsedReasoning = {
  render: () => (
    <ConversationPreview>
      <ToolsAndReasoningPreview />
    </ConversationPreview>
  ),
}

export const RetryAndError = {
  render: () => (
    <ConversationPreview>
      <SessionRetry
        show
        status={{
          type: "retry",
          attempt: 2,
          message: "Upstream request temporarily unavailable",
          next: Date.now() + 8000,
        }}
      />
      <Card variant="error" class="error-card">
        {Array.from(
          { length: 40 },
          (_, index) => `Provider error detail ${index + 1}: the complete diagnostic remains readable while scrolling.`,
        ).join("\n")}
      </Card>
    </ConversationPreview>
  ),
}
