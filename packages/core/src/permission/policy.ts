export * as PermissionPolicy from "./policy"

export type Policy = "judge" | "allow" | "ask"

export type Mode = "ask" | "judge-shadow" | "judge"

// 内置默认策略表：执行/写/网络/编排族进裁判，只读族确定性放行，subagent 留人审。
// 本表为内置常量，不提供任何配置覆盖入口（配置面收敛见 permission-judge-slim）。
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

// 未列动作保守回落 ask。
export function resolve(action: string): Policy {
  return defaults[action] ?? "ask"
}

// 严格序：ask 最严，judge-shadow 居中，judge 最宽松。
const modeRank: Record<Mode, number> = { ask: 0, "judge-shadow": 1, judge: 2 }

// 项目级模式取值仅在比用户级更严时生效（非宽松化），防止恶意项目配置静默开启裁判档。
export function resolveMode(userMode: Mode | undefined, projectMode: Mode | undefined): Mode {
  const user = userMode ?? "ask"
  if (projectMode !== undefined && modeRank[projectMode] < modeRank[user]) return projectMode
  return user
}
