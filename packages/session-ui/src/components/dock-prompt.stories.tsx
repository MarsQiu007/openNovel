// @ts-nocheck
import * as mod from "./dock-prompt"
import { create } from "@opennovel-ai/ui/storybook/scaffold"

const docs = `### Overview
Docked prompt layout for questions and permission requests.

Use with form controls or confirmation buttons in the footer.

### API
- Required: \`kind\` (question | permission), \`header\`, \`children\`, \`footer\`.
- Optional: \`ref\` for measuring or focus management.

### Variants and states
- Question and permission layouts (data attributes).
- Judge annotation slot: \`judge={{ mode, effect, reason? }}\` renders the 裁判建议
  (judge-shadow) or 自动放行 (judge) row above the footer.

### Behavior
- Pure layout component; behavior handled by parent.

### Accessibility
- Ensure header and footer content provide clear context and actions.

### Theming/tokens
- Uses \`data-component="dock-prompt"\` with kind data attribute.

`

const story = create({
  title: "UI/DockPrompt",
  mod,
  args: {
    kind: "question",
    header: "Header",
    children: "Prompt content",
    footer: "Footer",
  },
})

export default {
  title: "UI/DockPrompt",
  id: "components-dock-prompt",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const Permission = {
  args: {
    kind: "permission",
    header: "Allow access?",
    children: "This action needs permission to proceed.",
    footer: "Approve or deny",
  },
}

export const JudgeSuggestion = {
  args: {
    kind: "permission",
    header: "Allow access?",
    children: "This action needs permission to proceed.",
    footer: "Approve or deny",
    judge: { mode: "judge-shadow", effect: "deny", reason: "会删除工程目录" },
  },
}

export const JudgeAutoAllow = {
  args: {
    kind: "permission",
    header: "Command finished",
    children: "rm -rf build",
    footer: "Done",
    judge: { mode: "judge", effect: "allow", reason: "清理构建产物" },
  },
}
