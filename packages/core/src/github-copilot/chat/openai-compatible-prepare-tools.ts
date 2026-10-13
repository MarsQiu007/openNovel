import { type LanguageModelV3CallOptions, type SharedV3Warning, UnsupportedFunctionalityError } from "@ai-sdk/provider"

export function prepareTools({
  tools,
  toolChoice,
}: {
  tools: LanguageModelV3CallOptions["tools"]
  toolChoice?: LanguageModelV3CallOptions["toolChoice"]
}): {
  tools:
    | undefined
    | Array<{
        type: "function"
        function: {
          name: string
          description: string | undefined
          parameters: unknown
        }
      }>
  toolChoice: { type: "function"; function: { name: string } } | "auto" | "none" | "required" | undefined
  toolWarnings: SharedV3Warning[]
} {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined

  const toolWarnings: SharedV3Warning[] = []

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, toolWarnings }
  }

  const openaiCompatTools: Array<{
    type: "function"
    function: {
      name: string
      description: string | undefined
      parameters: unknown
    }
  }> = []

  for (const tool of tools) {
    if (tool.type === "provider") {
      toolWarnings.push({ type: "unsupported", feature: `tool type: ${tool.type}` })
    } else {
      openaiCompatTools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })
    }
  }

  if (toolChoice == null) {
    return { tools: openaiCompatTools, toolChoice: undefined, toolWarnings }
  }

  const type = toolChoice.type

  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiCompatTools, toolChoice: type, toolWarnings }
    case "tool": {
      // provider 型工具已在上面被过滤；若 toolChoice 指向不存在的函数，请求会被端点 400 拒绝，
      // 这里降级为 auto 并把不兼容情况回报给调用方。
      if (!openaiCompatTools.some((tool) => tool.function.name === toolChoice.toolName)) {
        toolWarnings.push({ type: "unsupported", feature: `tool choice for unsupported tool: ${toolChoice.toolName}` })
        return { tools: openaiCompatTools, toolChoice: "auto", toolWarnings }
      }
      return {
        tools: openaiCompatTools,
        toolChoice: {
          type: "function",
          function: { name: toolChoice.toolName },
        },
        toolWarnings,
      }
    }
    default: {
      const _exhaustiveCheck: never = type
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      })
    }
  }
}
