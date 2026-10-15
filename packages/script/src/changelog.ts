// 发布说明仅收录用户可感知的新功能与修复：feat/fix（支持 scope 与破坏性标记），其余提交类型一律排除
export function releaseNoteType(message: string) {
  const type = message.match(/^(feat|fix)(?:\([^)]*\))?!?:/i)?.[1]?.toLowerCase()
  if (type === "feat" || type === "fix") return type
  return
}
