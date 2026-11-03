import { createMemo, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"

export type PermissionMode = "ask" | "judge-shadow" | "judge"

export const PERMISSION_MODES: readonly PermissionMode[] = ["ask", "judge-shadow", "judge"]

// 与 core PermissionPolicy.modeRank 同序：ask > judge-shadow > judge 只能收紧不能放松。
// Client 侧不可 import core 的裁判策略实现（依赖方向约束），按 design D7 复刻排序表，
// 仅用于展示生效值与循环切换；真正判定以服务端解析为准。
const modeRank: Record<PermissionMode, number> = { ask: 0, "judge-shadow": 1, judge: 2 }

export function resolvePermissionMode(
  userMode: PermissionMode | undefined,
  projectMode: PermissionMode | undefined,
): PermissionMode {
  const user = userMode ?? "ask"
  if (projectMode !== undefined && modeRank[projectMode] < modeRank[user]) return projectMode
  return user
}

// Config.permission 是 V1 联合（字符串档位或规则对象），裁判字段只挂在对象分支上。
function modeOf(permission: unknown): PermissionMode | undefined {
  if (typeof permission !== "object" || permission === null) return undefined
  const mode = (permission as { mode?: unknown }).mode
  return mode === "ask" || mode === "judge-shadow" || mode === "judge" ? mode : undefined
}

// 全局（用户级）权限模式状态：读取全局与项目级配置的解析结果，写通道只走全局配置（design D1）。
export function usePermissionMode(directory: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const language = useLanguage()

  const userMode = createMemo(() => modeOf(serverSync().data.config.permission))
  const projectMode = createMemo(() => {
    const dir = directory()
    if (!dir) return undefined
    return modeOf(serverSync().child(dir, { bootstrap: false })[0].config.permission)
  })
  const effective = createMemo(() => resolvePermissionMode(userMode(), projectMode()))
  // 项目级定义了比全局更宽松的取值时被收紧忽略（core D2 同语义），供 UI 标注"未生效"。
  const ignoredProjectMode = createMemo(() => {
    const project = projectMode()
    if (project === undefined) return undefined
    return resolvePermissionMode(userMode(), project) === project ? undefined : project
  })

  const setMode = async (mode: PermissionMode) => {
    await serverSync().updateConfig({ permission: { mode } })
  }

  const cycle = async () => {
    const next = PERMISSION_MODES[(PERMISSION_MODES.indexOf(effective()) + 1) % PERMISSION_MODES.length]!
    await setMode(next)
    return next
  }

  const describe = (mode: PermissionMode) => language.t(`permission.mode.${mode}`)

  return { userMode, projectMode, effective, ignoredProjectMode, setMode, cycle, describe }
}
