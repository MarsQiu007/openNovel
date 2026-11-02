export * as PermissionPolicy from "./policy"

import { ConfigPermission } from "../config/permission"

export type Policy = "judge" | "allow" | "ask"

export type Mode = "ask" | "judge-shadow" | "judge"

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

// 解析顺序：agent 级配置 > 项目级配置 > 内置默认表 > ask。
export function resolve(action: string, agent?: ConfigPermission.Info, project?: ConfigPermission.Info): Policy {
  return agent?.policy?.[action] ?? project?.policy?.[action] ?? defaults[action] ?? "ask"
}

export function mode(agent?: ConfigPermission.Info, project?: ConfigPermission.Info): Mode {
  return agent?.mode ?? project?.mode ?? "ask"
}
