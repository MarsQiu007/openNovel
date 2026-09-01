#!/usr/bin/env bun

import { rm } from "fs/promises"
import path from "path"
import { parseArgs } from "util"

import { $ } from "bun"

const root = path.resolve(import.meta.dir, "..")
const file = path.join(root, "UPCOMING_CHANGELOG.md")
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t" },
    variant: { type: "string", default: "low" },
    quiet: { type: "boolean", default: false },
    print: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
})
const args = [...positionals]

if (values.from) args.push("--from", values.from)
if (values.to) args.push("--to", values.to)

if (values.help) {
  console.log(`
Usage: bun script/changelog.ts [options]

Generates UPCOMING_CHANGELOG.md by running the opennovel changelog command.

Options:
  -f, --from <version>   Starting version (default: latest non-draft GitHub release)
  -t, --to <ref>         Ending ref (default: HEAD)
      --variant <name>   Thinking variant for opennovel run (default: low)
      --quiet            Suppress opennovel command output unless it fails
      --print            Print the generated UPCOMING_CHANGELOG.md after success
  -h, --help             Show this help message

Examples:
  bun script/changelog.ts
  bun script/changelog.ts --from 1.0.200
  bun script/changelog.ts -f 1.0.200 -t 1.0.205
`)
  process.exit(0)
}

await rm(file, { force: true })

const quiet = values.quiet
// opennovel 是 private workspace 包，没有发布 npm 平台二进制，bin/opennovel 启动器在 CI 上不可用；
// 统一从源码以 bun 调用。cwd 保持仓库根：opennovel 以 cwd 为实例目录。
const cmd = [
  "bun",
  "run",
  "--conditions=browser",
  path.join(root, "packages/opennovel/src/index.ts"),
  "run",
]
// CI 等无头环境没有 TUI 审批权限，不自动放行会导致工具调用被 auto-reject
cmd.push("--auto")
// 服务端 500 只返回错误引用号，把日志直接打到 stderr 才能在 CI 上看到真实原因
cmd.push("--print-logs")
cmd.push("--variant", values.variant)
cmd.push("--command", "changelog", "--", ...args)

const proc = Bun.spawn(cmd, {
  cwd: root,
  env: {
    ...process.env,
    // opennovel 的配置目录发现只扫 .opennovel/（config/paths.ts 的 targets），而本仓库的
    // 命令仍放在 .opencode/（opencode 模板遗留目录名）。用 OPENNOVEL_CONFIG_DIR 把
    // .opencode 追加进本次运行的配置目录列表，changelog 命令才能被发现；
    // 只作用于这个子进程，不影响桌面端等其它实例。
    OPENNOVEL_CONFIG_DIR: path.join(root, ".opencode"),
  },
  stdin: "inherit",
  stdout: quiet ? "pipe" : "inherit",
  stderr: quiet ? "pipe" : "inherit",
})

const [out, err] = quiet
  ? await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  : ["", ""]
const code = await proc.exited

if (code !== 0) {
  // AI 生成失败（如缺少模型 key）不应阻断发版流程：降级为 raw-changelog 的机械输出
  console.error(`[changelog] opennovel changelog command failed (exit ${code}); falling back to raw changelog`)
  // raw-changelog 用 git log 按路径过滤 commit，本地 tag 过期会导致 bad revision，先同步
  await $`git fetch --tags --force --quiet`.nothrow().cwd(root)
  const raw = Bun.spawn(["bun", "run", path.join(root, "script/raw-changelog.ts"), ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  })
  const text = await new Response(raw.stdout).text()
  const rawCode = await raw.exited
  if (rawCode !== 0) {
    if (quiet) {
      if (out) process.stdout.write(out)
      if (err) process.stderr.write(err)
    }
    process.exit(rawCode)
  }
  await Bun.write(file, text)
  if (values.print) process.stdout.write(text)
  process.exit(0)
}

if (values.print) process.stdout.write(await Bun.file(file).text())
process.exit(0)
