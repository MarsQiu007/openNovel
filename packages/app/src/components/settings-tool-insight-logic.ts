/**
 * 工具洞察设置的纯逻辑（组件在 settings-tool-insight.tsx）：日志目录草稿的提交判定。
 * 与服务端语义对齐：全局配置对 toolInsight 字段是深合并，清空目录必须显式发送
 * 空串（缺键会保留旧值）；空串经窄解析器归一为「使用项目内默认位置」。
 */

/** 绝对路径判定：POSIX 根、Windows 盘符或 UNC 共享 */
export function isAbsoluteDirectoryPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)
}

export type DirectoryCommit =
  | { action: "skip" }
  | { action: "invalid" }
  | { action: "save"; value: string }

/**
 * 目录草稿提交判定：未编辑跳过；非法绝对路径拒绝提交（行内提示可见，保留草稿
 * 供修改）；与已保存值相同跳过；其余按修剪后的值保存（空串 = 清空回默认）。
 */
export function resolveDirectoryCommit(input: { saved: string; draft: string | undefined }): DirectoryCommit {
  if (input.draft === undefined) return { action: "skip" }
  const value = input.draft.trim()
  if (value !== "" && !isAbsoluteDirectoryPath(value)) return { action: "invalid" }
  if (value === input.saved) return { action: "skip" }
  return { action: "save", value }
}
