#!/usr/bin/env bun

// 一条命令同时启动后端（opennovel serve，端口 4096）和前端（vite，端口 4444）。
// 任一进程退出或收到 Ctrl+C / SIGTERM 时，统一关闭两个进程。
// 端口可用环境变量覆盖：OPENNOVEL_SERVER_PORT / OPENNOVEL_WEB_PORT。

import { spawn } from "bun"

const serverPort = process.env.OPENNOVEL_SERVER_PORT ?? "4096"
const webPort = process.env.OPENNOVEL_WEB_PORT ?? "4444"

const BACKEND = [
  process.execPath,
  "run",
  "--cwd",
  "packages/opennovel",
  "--conditions=browser",
  "src/index.ts",
  "serve",
  "--port",
  serverPort,
]
const FRONTEND = [process.execPath, "--cwd", "packages/app", "dev", "--", "--port", webPort]

const children: Bun.Subprocess[] = []
let stopping = false

function start(name: string, command: string[]) {
  const proc = spawn(command, { stdio: ["inherit", "inherit", "inherit"] })
  children.push(proc)
  proc.exited.then((code) => {
    console.error(`[dev:all] ${name} exited (code=${code}); shutting down`)
    stop(code === 0 ? 0 : 1)
  })
  return proc
}

function stop(code: number) {
  if (stopping) return
  stopping = true
  for (const proc of children) {
    try {
      proc.kill()
    } catch {
      // process already exited
    }
  }
  setTimeout(() => process.exit(code), 250).unref()
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.error(`[dev:all] received ${signal}; shutting down`)
    stop(0)
  })
}

start("backend", BACKEND)
start("frontend", FRONTEND)
console.error(`[dev:all] backend: http://localhost:${serverPort}  frontend: http://localhost:${webPort}`)
