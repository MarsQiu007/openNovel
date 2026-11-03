// V2 无 native 标志：内置 agent 以 category "internal" 标记（core agent 插件注册）。
export function isCustomAgent(item: { category?: string }) {
  return item.category !== "internal"
}

// 代理选择器显隐：可见的自定义（非 internal）主智能体 ≥ 2 才渲染，内置不参与计数。
export function showAgentSelector(items: Array<{ category?: string }>) {
  return items.filter(isCustomAgent).length >= 2
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}

// 会话当前智能体解析链：会话级持久化选择 → default_agent 配置 → 内存回退 → resolveAgent 兜底。
// 选择器隐藏与可见共用本链，不得在选择器隐藏时把解析结果硬改为内置 build。
export function resolveSessionAgent<T extends { name: string }>(
  items: T[],
  scope: string | undefined,
  configDefault: string | undefined,
  memory: string | undefined,
) {
  return resolveAgent(items, scope ?? configDefault ?? memory)
}
