const migrationTargetVersion = "0.0.4"

export function buildProdReleaseNotes(input: { version: string; body: string }): string {
  if (input.version !== migrationTargetVersion) return input.body

  return [
    input.body.trimEnd(),
    "",
    "## v0.0.3 迁移提示",
    "",
    "曾安装错误构建的 v0.0.3 prod 包时，其应用身份实际是 Dev，无法被本次正式包原地覆盖。",
    "请先卸载该版本，再手动下载并安装本次 prod 安装包；应用数据不会自动迁移。",
    "",
  ].join("\n")
}
