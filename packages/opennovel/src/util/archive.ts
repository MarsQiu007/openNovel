import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    // PowerShell 单引号字符串里唯一的转义是 ''，路径含单引号（O'Brien 类合法目录）时必须翻倍；
    // -LiteralPath 再避免 [ ] 被当成通配符，路径内容不参与命令字符串求值
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
    const cmd =
      "$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive" +
      " -LiteralPath " +
      quote(winZipPath) +
      " -DestinationPath " +
      quote(winDestDir) +
      " -Force"
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
