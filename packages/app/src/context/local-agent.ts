// V2 无 native 标志：内置 agent 以 category "internal" 标记（core agent 插件注册）。
export function hasCustomAgent(items: Array<{ category?: string }>) {
  return items.some((item) => item.category !== "internal")
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}
