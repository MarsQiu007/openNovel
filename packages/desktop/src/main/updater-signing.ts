import { execFileSync } from "node:child_process"

type CodeSignProbe = (executablePath: string) => boolean

const codesignProbe: CodeSignProbe = (executablePath) => {
  try {
    execFileSync("codesign", ["--display", "--verbose=2", executablePath], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

// 未签名的 mac 包无法自动更新（Squirrel 要求更新包与宿主同一签名身份），
// 未签名时整体禁用更新，避免更新必然失败后的反复报错；其它平台不受影响。
export function gateAutoUpdate(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  probe: CodeSignProbe = codesignProbe,
): { allowed: boolean; reason?: string } {
  if (platform !== "darwin" || !isPackaged) return { allowed: true }
  if (probe(process.execPath)) return { allowed: true }
  return { allowed: false, reason: "unsigned macOS build cannot auto-update" }
}
