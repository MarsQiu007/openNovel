// part ID 不保证跨消息唯一（流水线会产出索引式 ID），流式增量桶与基线表一律以「消息 + part」复合键寻址。
export function partAccumKey(messageID: string, partID: string) {
  return `${messageID}:${partID}`
}

export function readPartText(
  accum: Record<string, string> | undefined,
  part: { messageID: string; id: string; text?: string },
): string {
  return (accum?.[partAccumKey(part.messageID, part.id)] ?? part.text ?? "").trim()
}

function cleanMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

// 思考标题四级回退（html 标题 → atx → setext → strong），无标题形状返回 undefined。
// 流式「思考中」微光依赖该 undefined 语义：不渲染文本，避免把思考正文提前暴露在标题位。
export function reasoningHeadingText(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = cleanMarkdown(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = cleanMarkdown(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = cleanMarkdown(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = cleanMarkdown(strong[1])
    if (value) return value
  }

  return undefined
}

// 折叠块触发器文案：标题缺失时回退为剥离 markdown 标记后的截断首行（触发器不允许空文案）。
export function reasoningTriggerText(text: string) {
  const heading = reasoningHeadingText(text)
  if (heading) return heading

  const firstLine = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .find((line) => line.trim())
  if (!firstLine) return undefined

  const value = cleanMarkdown(firstLine.replace(/^#{1,6}[ \t]+/, ""))
  if (!value) return undefined
  return value.length > 80 ? `${value.slice(0, 80)}…` : value
}

// 块级展开状态解析：受控 toolOpen 优先，其次 defaultOpen，未受控时取本地信号（默认收起）。
export function resolveCollapsibleOpen(input: { toolOpen?: boolean; defaultOpen?: boolean; local?: boolean }) {
  if (input.toolOpen !== undefined) return input.toolOpen
  if (input.defaultOpen !== undefined) return input.defaultOpen
  return input.local ?? false
}

const HIDDEN_TOOLS = new Set(["todowrite"])

// part 是否可渲染的类型级判定（纯策略）；组件注册表的查询由调用方注入。
export function renderablePart(
  part: { type: string; tool?: string; state?: { status: string }; text?: string },
  hasPartComponent: (type: string) => boolean,
) {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool ?? "")) return false
    if (part.tool === "question") return part.state?.status !== "pending" && part.state?.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return !!part.text?.trim()
  return hasPartComponent(part.type)
}
