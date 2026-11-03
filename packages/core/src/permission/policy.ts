export * as PermissionPolicy from "./policy"

import { AgentV2 } from "../agent"
import { Config } from "../config"
import { ConfigPermission } from "../config/permission"

export type Policy = "judge" | "allow" | "ask"

export type Mode = "ask" | "judge-shadow" | "judge"

// 内置默认策略表：执行/写/网络/编排族进裁判，只读族确定性放行，subagent 留人审。
// 注意：packages/app/src/context/permission-policy.ts 有本表的 UI 只读镜像（依赖方向约束，
// app 不可 import 本模块），改动本表必须同步镜像。
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

// agent 级裁判配置查找：最高优先级文档中该 agent 的 permission 段。
export function agentConfig(
  entries: readonly Config.Entry[],
  agentID: AgentV2.ID,
): ConfigPermission.Info | undefined {
  const document = entries.findLast(
    (entry): entry is Config.Document =>
      entry.type === "document" && entry.info.agents?.[agentID] !== undefined,
  )
  return document?.info.agents?.[agentID]?.permission
}

// 严格序：ask 最严，judge-shadow 居中，judge 最宽松。
const modeRank: Record<Mode, number> = { ask: 0, "judge-shadow": 1, judge: 2 }

// 项目级模式取值仅在比用户级更严时生效（非宽松化），防止恶意项目配置静默开启裁判档。
export function resolveMode(userMode: Mode | undefined, projectMode: Mode | undefined): Mode {
  const user = userMode ?? "ask"
  if (projectMode !== undefined && modeRank[projectMode] < modeRank[user]) return projectMode
  return user
}
