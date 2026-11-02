import { Show, type JSX } from "solid-js"
import { useI18n } from "@opennovel-ai/ui/context/i18n"
import { DockShell, DockTray } from "@opennovel-ai/ui/dock-surface"

export interface JudgeAnnotation {
  readonly mode: "judge-shadow" | "judge"
  readonly effect: "allow" | "deny"
  readonly reason?: string
}

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  /** 裁判标注：shadow 模式展示裁判建议，judge 模式展示自动放行（design D9） */
  judge?: JudgeAnnotation
  ref?: (el: HTMLDivElement) => void
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
}) {
  const i18n = useI18n()
  const slot = (name: string) => `${props.kind}-${name}`
  const judgeLabel = (judge: JudgeAnnotation) =>
    judge.mode === "judge"
      ? i18n.t("ui.dockPrompt.judgeAutoAllow")
      : i18n.t(judge.effect === "allow" ? "ui.dockPrompt.judgeSuggestionAllow" : "ui.dockPrompt.judgeSuggestionDeny")

  return (
    <div data-component="dock-prompt" data-kind={props.kind} ref={props.ref} onKeyDown={props.onKeyDown}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>{props.header}</div>
        <div data-slot={slot("content")}>{props.children}</div>
        <Show when={props.judge}>
          {(judge) => (
            <div data-slot={slot("judge")} data-mode={judge().mode} data-effect={judge().effect}>
              <span data-slot={slot("judge-label")}>{judgeLabel(judge())}</span>
              <Show when={judge().reason}>
                {(reason) => <span data-slot={slot("judge-reason")}>（{reason()}）</span>}
              </Show>
            </div>
          )}
        </Show>
      </DockShell>
      <DockTray data-slot={slot("footer")}>{props.footer}</DockTray>
    </div>
  )
}
