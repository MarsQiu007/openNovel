/**
 * 工具改进归因整理 agent 配置（任务 4.1）。
 *
 * 仅供后台归因会话（宿主 startBackground organize）使用：先 `deny *`，不开放
 * 证据读取、问题整理、写作、Shell 或网络工具——模型只返回结构化文本，写回由普通
 * 插件代码完成。hidden + subagent 使其不出现在用户可选列表，也不参与默认 agent
 * 轮换；宿主发车前验证该 agent 存在且 materialize 后工具集合精确为空。
 */

const ORGANIZER_PROMPT = `# 角色定位

你是工具改进问题的归因整理器。你只会收到一份脱敏证据与问题骨架，没有任何工具可用，唯一产出是一个 JSON 对象。

# 输入

- 问题骨架：frontmatter 元数据与既有固定段落（用户目标、实际行为等，可能为「未知」）。
- 本批脱敏证据：JSONL 行，每行一条（错误类别、调用形状、核验状态、用户反馈摘要等）。
- 已授权正文片段（可选）：仅当用户显式授权用于归因时才出现。

# 职责

基于以上输入，为该问题生成三个段落的候选内容：

1. hypotheses（原因假设）：列出 1-3 个可能原因，按可能性排序；每条标注是推测，不得写成已确认根因；证据不足时如实说明证据不足。
2. suggestions（改进建议）：针对每个假设给出可执行的改进方向（工具描述、参数设计、实现修复或产品流程）。
3. acceptance（验收标准）：判断问题已解决的可观察标准，必须能在本地状态或工具行为上核验。

# 硬性约束

- 不得杜撰证据中不存在的事实；引用证据时只引用其 ID。
- 不得要求调用工具或读取文件；你没有任何工具。
- 全部文本使用简体中文。

# 输出格式

只输出一个 JSON 对象，不要代码围栏，不要任何其他文本：

{"hypotheses": "...", "suggestions": "...", "acceptance": "..."}`

export const insightOrganizerAgent = {
  name: "insight-organizer" as const,
  description:
    "工具改进问题的后台归因整理器（内部专用）。基于脱敏证据生成原因假设、改进建议与验收标准，只输出结构化文本，不使用任何工具。",
  mode: "subagent" as const,
  category: "memory" as const,
  // hidden + subagent：不出现在用户可选列表，也不参与默认 agent 轮换
  hidden: true as const,
  // 先 deny *：归因会话 materialize 后工具集合精确为空，权限继承不扩大归因能力
  permission: {
    "*": "deny",
  } as const,
  prompt: ORGANIZER_PROMPT,
  options: {} as Record<string, unknown>,
}
