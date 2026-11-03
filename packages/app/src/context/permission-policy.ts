// 生效策略档位与内置默认表的 UI 镜像。真正的判定以 core 的 PermissionPolicy
// （packages/core/src/permission/policy.ts）为准；此处因 Client 依赖方向约束
// （app 不可把 core 的 node 配置图拖进浏览器包，core/src/config.ts → FSUtil → node fs）
// 按 design D7 复刻只读数据，改动任一侧必须同步另一侧。

export type Policy = "judge" | "allow" | "ask"

// 内置默认策略表：执行/写/网络/编排族进裁判，只读族确定性放行，subagent 留人审。
export const defaults: Record<string, Policy> = {
  bash: "judge",
  edit: "judge",
  write: "judge",
  apply_patch: "judge",
  webfetch: "judge",
  websearch: "judge",
  browser: "judge",
  skill: "judge",
  codemode: "judge",
  read: "allow",
  glob: "allow",
  grep: "allow",
  question: "allow",
  todowrite: "allow",
  subagent: "ask",
}

// 与 core PermissionPolicy.resolve 同序：agent 级 > 项目级 > 全局级 > 内置默认表 > ask。
// 设置页无 agent 上下文，agent 级留空；项目级未配置时回落全局级。
export function resolve(action: string, project?: Record<string, Policy>, global?: Record<string, Policy>): Policy {
  return project?.[action] ?? global?.[action] ?? defaults[action] ?? "ask"
}
